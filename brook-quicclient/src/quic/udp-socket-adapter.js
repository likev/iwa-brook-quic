/**
 * Direct Sockets UDPSocket transport adapter for browser QUIC engine.
 * Includes FIFO send queue with true streaming backpressure handling and control packet priority.
 */

export class UdpSocketAdapter {
  constructor({ remoteAddress, remotePort, onDatagram, onError, onClose }) {
    this.remoteAddress = remoteAddress;
    this.remotePort = remotePort;
    this.onDatagram = onDatagram;
    this.onError = onError;
    this.onClose = onClose;

    this.socket = null;
    this.writer = null;
    this.reader = null;
    this.isClosed = false;

    this.sendQueue = [];
    this.isDraining = false;
    this.drainWaiters = [];

    this.bytesSent = 0;
    this.bytesReceived = 0;
    this.packetsSent = 0;
    this.packetsReceived = 0;
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

  _waitForDrain(targetWatermark = 512, timeoutMs = 5000) {
    if (this.isClosed || this.sendQueue.length <= targetWatermark) {
      return Promise.resolve();
    }
    return new Promise(resolve => {
      let timer = null;
      const waiter = {
        targetWatermark,
        resolve: () => {
          if (timer) clearTimeout(timer);
          resolve();
        }
      };
      timer = setTimeout(() => {
        const idx = this.drainWaiters.indexOf(waiter);
        if (idx >= 0) this.drainWaiters.splice(idx, 1);
        resolve();
      }, timeoutMs);
      this.drainWaiters.push(waiter);
    });
  }

  _notifyDrain() {
    if (this.drainWaiters && this.drainWaiters.length > 0) {
      const remaining = [];
      for (const waiter of this.drainWaiters) {
        if (this.isClosed || this.sendQueue.length <= waiter.targetWatermark) {
          waiter.resolve();
        } else {
          remaining.push(waiter);
        }
      }
      this.drainWaiters = remaining;
    }
  }

  async send(packetData) {
    if (this.isClosed || !this.writer) {
      throw new Error('UDPSocket is not open');
    }
    const u8 = packetData instanceof Uint8Array ? packetData : new Uint8Array(packetData);
    const isControlPacket = u8.length > 0 && (u8[0] & 0x80) !== 0; // Long header: Initial / Handshake / Retry

    const MAX_QUEUE_SIZE = 1024;
    const HIGH_WATERMARK = 512;

    if (this.sendQueue.length >= MAX_QUEUE_SIZE) {
      if (isControlPacket) {
        // Evict an expendable short-header packet (1-RTT data/ACK) to prioritize handshake/control
        const nonControlIndex = this.sendQueue.findIndex(pkt => pkt.length > 0 && (pkt[0] & 0x80) === 0);
        if (nonControlIndex >= 0) {
          this.sendQueue.splice(nonControlIndex, 1);
        }
      } else {
        // For non-control data packets, evict oldest short-header packet; never evict long-header control packets
        const nonControlIndex = this.sendQueue.findIndex(pkt => pkt.length > 0 && (pkt[0] & 0x80) === 0);
        if (nonControlIndex >= 0) {
          this.sendQueue.splice(nonControlIndex, 1);
        } else {
          // If queue is completely filled with control packets, do not queue extra non-control packet
          return;
        }
      }
    }

    this.sendQueue.push(u8);
    this._drainSendQueue();

    // Apply true asynchronous backpressure when queue exceeds high watermark
    if (this.sendQueue.length > HIGH_WATERMARK) {
      await this._waitForDrain(HIGH_WATERMARK);
    }
  }

  async _drainSendQueue() {
    if (this.isDraining || this.isClosed || !this.writer) return;
    this.isDraining = true;
    try {
      while (this.sendQueue.length > 0 && !this.isClosed && this.writer) {
        const chunk = this.sendQueue.shift();
        this.bytesSent += chunk.length;
        this.packetsSent++;
        await this.writer.write({ data: chunk });
        this._notifyDrain();
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

  async close() {
    if (this.isClosed) return;
    this.isClosed = true;
    this.sendQueue = [];
    this._notifyDrain();

    try {
      if (this.reader) {
        await this.reader.cancel().catch(() => {});
        this.reader.releaseLock();
      }
    } catch (e) {}

    try {
      if (this.writer) {
        await this.writer.close().catch(() => {});
        this.writer.releaseLock();
      }
    } catch (e) {}

    try {
      if (this.socket) {
        await this.socket.close().catch(() => {});
      }
    } catch (e) {}

    this.reader = null;
    this.writer = null;
    this.socket = null;

    if (this.onClose) {
      this.onClose();
    }
  }
}
