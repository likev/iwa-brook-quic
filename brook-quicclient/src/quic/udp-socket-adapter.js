/**
 * Direct Sockets UDPSocket transport adapter for browser QUIC engine.
 * Includes FIFO send queue with coalesced backpressure handling,
 * hard bounded queues, and control packet prioritization.
 */

export class UdpSocketAdapter {
  constructor({ remoteAddress, remotePort, onDatagram, onError, onClose, onLog }) {
    this.remoteAddress = remoteAddress;
    this.remotePort = remotePort;
    this.onDatagram = onDatagram;
    this.onError = onError;
    this.onClose = onClose;
    this.onLog = onLog;

    this.socket = null;
    this.writer = null;
    this.reader = null;
    this.isClosed = false;

    this.sendQueue = [];
    this.isDraining = false;
    this.drainWaiters = new Map(); // targetWatermark -> Array<resolve>

    this.bytesSent = 0;
    this.bytesReceived = 0;
    this.packetsSent = 0;
    this.packetsReceived = 0;
    this.maxQueueLength = 0;
    this.packetEvictions = 0;
    this.writeDurations = []; // Rolling window of writer.write() durations in ms
  }

  getStats() {
    const oldestItem = this.sendQueue[0];
    const oldestEnqueuedAt = oldestItem ? (oldestItem.enqueuedAt || Date.now()) : Date.now();
    const udpOldestMs = this.sendQueue.length > 0 ? Math.max(0, Date.now() - oldestEnqueuedAt) : 0;

    let udpWriteMsP95 = 0;
    if (this.writeDurations.length > 0) {
      const sorted = [...this.writeDurations].sort((a, b) => a - b);
      const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
      udpWriteMsP95 = Math.round(sorted[idx] * 10) / 10;
    }

    return {
      udpQueue: this.sendQueue.length,
      udpQueueMax: this.maxQueueLength,
      udpOldestMs,
      udpWriteMsP95,
      packetEvictions: this.packetEvictions,
      sendQueueLength: this.sendQueue.length,
      isDraining: this.isDraining,
      bytesSent: this.bytesSent,
      bytesReceived: this.bytesReceived,
      packetsSent: this.packetsSent,
      packetsReceived: this.packetsReceived
    };
  }

  async open() {
    if (typeof globalThis.UDPSocket === 'undefined') {
      throw new Error('Direct Sockets UDPSocket API is not available. Please run inside an Isolated Web App (IWA).');
    }

    try {
      this.socket = new globalThis.UDPSocket({
        remoteAddress: this.remoteAddress,
        remotePort: this.remotePort
      });

      const { readable, writable } = await this.socket.opened;
      this.writer = writable.getWriter();
      this.reader = readable.getReader();
      this.isClosed = false;

      // Start asynchronous read loop
      this._startReadLoop();
    } catch (err) {
      if (this.onError) this.onError(err);
      throw err;
    }
  }

  async _startReadLoop() {
    try {
      while (!this.isClosed && this.reader) {
        const { value, done } = await this.reader.read();
        if (done) break;

        if (value && value.data) {
          const dataU8 = value.data instanceof Uint8Array ? value.data : new Uint8Array(value.data);
          this.bytesReceived += dataU8.length;
          this.packetsReceived++;
          if (this.onDatagram) {
            this.onDatagram(dataU8, value.remoteAddress || this.remoteAddress, value.remotePort || this.remotePort);
          }
        }
      }
    } catch (err) {
      if (!this.isClosed && this.onError) {
        this.onError(err);
      }
    } finally {
      this.close();
    }
  }

  _waitForDrain(targetWatermark = 1024, timeoutMs = 5000) {
    if (this.isClosed || this.sendQueue.length <= targetWatermark) {
      return Promise.resolve();
    }
    return new Promise(resolve => {
      let list = this.drainWaiters.get(targetWatermark);
      if (!list) {
        list = [];
        this.drainWaiters.set(targetWatermark, list);
      }

      let timer = null;
      const resolver = () => {
        if (timer) clearTimeout(timer);
        resolve();
      };

      timer = setTimeout(() => {
        const idx = list.indexOf(resolver);
        if (idx >= 0) list.splice(idx, 1);
        if (list.length === 0) this.drainWaiters.delete(targetWatermark);
        resolve();
      }, timeoutMs);

      list.push(resolver);
    });
  }

  _notifyDrain() {
    const qLen = this.sendQueue.length;
    for (const [watermark, list] of this.drainWaiters.entries()) {
      if (this.isClosed || qLen <= watermark) {
        this.drainWaiters.delete(watermark);
        for (const resolve of list) {
          resolve();
        }
      }
    }
  }

  async send(packetData, meta = {}) {
    if (this.isClosed || !this.writer) {
      throw new Error('UDPSocket is not open');
    }
    const u8 = packetData instanceof Uint8Array ? packetData : new Uint8Array(packetData);
    const isLongHeader = u8.length > 0 && (u8[0] & 0x80) !== 0; // Long header: Initial / Handshake / Retry
    const isControl = Boolean(meta.isControl || isLongHeader);

    const MAX_QUEUE_SIZE = 2048;
    const HIGH_WATERMARK = 1024;

    if (this.sendQueue.length >= MAX_QUEUE_SIZE) {
      let nonControlIndex = -1;
      for (let i = 0; i < this.sendQueue.length; i++) {
        if (!this.sendQueue[i].isControl) {
          nonControlIndex = i;
          break;
        }
      }

      if (nonControlIndex >= 0) {
        // Evict oldest non-control 1-RTT data packet; NEVER evict control frames
        this.packetEvictions++;
        const dropped = this.sendQueue.splice(nonControlIndex, 1)[0];
        const droppedLen = dropped?.data?.length || 0;
        if (this.onLog) {
          this.onLog('warning', `⚠️ [UDP Transport] Local packet drop: send queue saturated (${MAX_QUEUE_SIZE} pkts). Evicted 1-RTT data packet (${droppedLen}B)${isControl ? ' to prioritize control frame' : ''}. Total drops: ${this.packetEvictions}`);
        }
      } else {
        // If queue is 100% control packets, apply backpressure rather than dropping control
        if (this.onLog) {
          this.onLog('warning', `⚠️ [UDP Transport] High queue pressure: queue has ${this.sendQueue.length} control frames.`);
        }
        await this._waitForDrain(HIGH_WATERMARK);
      }
    }

    this.sendQueue.push({
      data: u8,
      isControl,
      space: meta.space || (isLongHeader ? 'long_header' : '1rtt'),
      enqueuedAt: Date.now()
    });

    const currentLen = this.sendQueue.length;
    if (currentLen > this.maxQueueLength) {
      this.maxQueueLength = currentLen;
    }
    this._drainSendQueue();

    // Apply asynchronous backpressure when queue exceeds high watermark
    if (currentLen > HIGH_WATERMARK) {
      await this._waitForDrain(HIGH_WATERMARK);
    }
  }

  async _drainSendQueue() {
    if (this.isDraining || this.isClosed || !this.writer) return;
    this.isDraining = true;
    const inFlight = new Set();
    const MAX_IN_FLIGHT = 4;

    try {
      while (this.sendQueue.length > 0 && !this.isClosed && this.writer) {
        while (inFlight.size < MAX_IN_FLIGHT && this.sendQueue.length > 0 && !this.isClosed && this.writer) {
          // Prioritize control packets: if any control frame is in queue, take the first one
          let itemIndex = 0;
          if (!this.sendQueue[0].isControl) {
            for (let i = 1; i < this.sendQueue.length; i++) {
              if (this.sendQueue[i].isControl) {
                itemIndex = i;
                break;
              }
            }
          }
          const item = (itemIndex === 0) ? this.sendQueue.shift() : this.sendQueue.splice(itemIndex, 1)[0];
          const chunk = item.data || item;
          this.bytesSent += chunk.length;
          this.packetsSent++;
          const t0 = (typeof performance !== 'undefined') ? performance.now() : Date.now();

          const writePromise = this.writer.write({ data: chunk }).then(() => {
            const dur = ((typeof performance !== 'undefined') ? performance.now() : Date.now()) - t0;
            this.writeDurations.push(dur);
            if (this.writeDurations.length > 100) this.writeDurations.shift();
          }).catch((err) => {
            if (!this.isClosed && this.onError) this.onError(err);
          }).finally(() => {
            inFlight.delete(writePromise);
            this._notifyDrain();
          });

          inFlight.add(writePromise);
        }

        if (inFlight.size >= MAX_IN_FLIGHT) {
          await Promise.race(inFlight);
        }
      }

      if (inFlight.size > 0) {
        await Promise.allSettled(Array.from(inFlight));
      }
    } catch (e) {
      if (!this.isClosed && this.onError) {
        this.onError(e);
      }
      this.close();
    } finally {
      this.isDraining = false;
      this._notifyDrain();
    }
  }

  close() {
    if (this.isClosed) return;
    this.isClosed = true;
    this.sendQueue = [];
    this._notifyDrain();

    const r = this.reader;
    const w = this.writer;
    const s = this.socket;
    this.reader = null;
    this.writer = null;
    this.socket = null;

    if (r) {
      try { r.cancel().catch(() => {}); } catch (e) {}
      try { r.releaseLock(); } catch (e) {}
    }

    if (w) {
      try { w.abort().catch(() => {}); } catch (e) {}
      try { w.releaseLock(); } catch (e) {}
    }

    if (s && typeof s.close === 'function') {
      try { s.close().catch(() => {}); } catch (e) {}
    }

    if (this.onClose) {
      try { this.onClose(); } catch (e) {}
    }
  }
}
