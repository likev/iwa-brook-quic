/**
 * QUIC Worker Pool Manager (Main Thread).
 * Manages N dedicated QUIC Session Web Workers (1 Worker = 1 QUIC Connection + 1 UDPSocket).
 * Dynamically scales workers (e.g. up to 10 QUIC connections) and routes stream tunnels across them.
 */

export class QuicWorkerPool {
  constructor({
    serverHost,
    serverPort,
    alpn = ['h3'],
    password,
    withoutBrook = false,
    clockOffsetSec = 0,
    maxWorkers = 10,
    minWorkers = 1,
    maxStreamsPerWorker = 8,
    onStateChange,
    onLog
  }) {
    this.serverHost = serverHost;
    this.serverPort = serverPort;
    this.alpn = alpn;
    this.password = password;
    this.withoutBrook = withoutBrook;
    this.clockOffsetSec = clockOffsetSec;
    this.maxWorkers = maxWorkers;
    this.minWorkers = minWorkers;
    this.maxStreamsPerWorker = maxStreamsPerWorker;
    this.onStateChange = onStateChange;
    this.onLog = onLog;

    this.workers = new Map(); // workerId -> { worker, isConnected, isClosed, activeStreams, stats }
    this.nextWorkerId = 1;
    this.isClosed = false;
    this.pendingTunnelRequests = []; // FIFO queue for burst requests when all workers are busy
  }

  _log(level, message, meta = null) {
    if (this.onLog) {
      this.onLog(level, message, meta);
    }
  }

  /**
   * Spawn a new dedicated QUIC Session Worker.
   */
  async spawnWorker() {
    if (this.isClosed || this.workers.size >= this.maxWorkers) return null;

    const workerId = this.nextWorkerId++;
    const workerUrl = new URL('./quic-session.worker.js', import.meta.url);
    const worker = new Worker(workerUrl, { type: 'module' });

    const workerEntry = {
      id: workerId,
      worker,
      isConnected: false,
      isClosed: false,
      activeStreams: 0,
      totalStreamsServed: 0,
      stats: {}
    };

    this.workers.set(workerId, workerEntry);

    worker.onmessage = (event) => {
      const msg = event.data;
      if (!msg) return;

      switch (msg.type) {
        case 'LOG':
          this._log(msg.level, msg.message, msg.meta);
          break;
        case 'STATE_CHANGE':
          if (msg.state === 'connected') {
            workerEntry.isConnected = true;
            this._notifyState();
            this._processPendingRequests();
          } else if (msg.state === 'disconnected') {
            workerEntry.isConnected = false;
            this._notifyState();
          }
          break;
        case 'STATS':
          workerEntry.stats = msg.stats;
          workerEntry.activeStreams = msg.stats.activeStreams || 0;
          workerEntry.totalStreamsServed = msg.stats.totalStreamsServed || 0;
          break;
        case 'TUNNEL_OUTCOME':
          this._processPendingRequests();
          break;
      }
    };

    worker.onerror = (err) => {
      this._log('error', `[QUIC Worker #${workerId}] Worker error: ${err.message}`);
      workerEntry.isConnected = false;
      workerEntry.isClosed = true;
      this.workers.delete(workerId);
      this._notifyState();
    };

    // Initialize worker connection
    worker.postMessage({
      type: 'INIT',
      config: {
        workerId,
        serverHost: this.serverHost,
        serverPort: this.serverPort,
        alpn: this.alpn,
        password: this.password,
        withoutBrook: this.withoutBrook,
        clockOffsetSec: this.clockOffsetSec
      }
    });

    return workerEntry;
  }

  _notifyState() {
    const connectedCount = Array.from(this.workers.values()).filter(w => w.isConnected).length;
    const totalWorkers = this.workers.size;

    if (connectedCount > 0) {
      if (this.onStateChange) {
        this.onStateChange('connected', `QUIC Pool: ${connectedCount}/${totalWorkers} workers connected`);
      }
    } else if (totalWorkers > 0) {
      if (this.onStateChange) {
        this.onStateChange('connecting', `QUIC Pool: ${totalWorkers} workers connecting...`);
      }
    } else {
      if (this.onStateChange) {
        this.onStateChange('disconnected', 'QUIC Pool: no active workers');
      }
    }
  }

  /**
   * Start the initial worker pool.
   */
  async start() {
    this.isClosed = false;
    const initialWorkers = Math.max(1, this.minWorkers);
    const promises = [];
    for (let i = 0; i < initialWorkers; i++) {
      promises.push(this.spawnWorker());
    }
    await Promise.all(promises);
  }

  /**
   * Select an optimal QUIC Session Worker for a new tunnel stream.
   */
  async getOptimalWorker() {
    if (this.isClosed) throw new Error('Worker pool is closed');

    // 1. Find connected worker with available stream capacity
    const connectedWorkers = Array.from(this.workers.values()).filter(w => w.isConnected && !w.isClosed);
    let bestWorker = null;
    let minStreams = Infinity;

    for (const w of connectedWorkers) {
      if (w.activeStreams < this.maxStreamsPerWorker && w.activeStreams < minStreams) {
        minStreams = w.activeStreams;
        bestWorker = w;
      }
    }

    if (bestWorker) return bestWorker;

    // 2. If all connected workers are full, spawn a new worker up to maxWorkers
    if (this.workers.size < this.maxWorkers) {
      this._log('info', `🚀 Scaling QUIC Worker Pool: spawning Worker #${this.nextWorkerId} (Current: ${this.workers.size}/${this.maxWorkers} workers)`);
      const newWorker = await this.spawnWorker();
      if (newWorker) return newWorker;
    }

    // 3. Fallback to least loaded connected worker
    if (connectedWorkers.length > 0) {
      return connectedWorkers.reduce((prev, curr) => (prev.activeStreams < curr.activeStreams ? prev : curr));
    }

    return null;
  }

  /**
   * Allocate a tunnel stream to a QUIC Worker, passing the stream MessagePort.
   */
  async allocateTunnel({ sessionId, dstBytes, targetStr, leftover, dialTimeoutMs, port }) {
    if (this.isClosed) {
      try {
        port.postMessage({ type: 'STREAM_FAILED', errorCode: 0x01 });
        port.close();
      } catch (e) {}
      return;
    }

    const workerEntry = await this.getOptimalWorker();
    if (!workerEntry) {
      // Queue request if no worker is ready yet
      this.pendingTunnelRequests.push({ sessionId, dstBytes, targetStr, leftover, dialTimeoutMs, port });
      return;
    }

    workerEntry.activeStreams++;
    workerEntry.totalStreamsServed++;

    workerEntry.worker.postMessage({
      type: 'ALLOCATE_TUNNEL',
      sessionId,
      dstBytes,
      targetStr,
      leftover,
      dialTimeoutMs
    }, [port]); // Transfer MessagePort directly to chosen worker
  }

  _processPendingRequests() {
    if (this.pendingTunnelRequests.length === 0) return;
    const req = this.pendingTunnelRequests.shift();
    if (req) {
      this.allocateTunnel(req);
    }
  }

  getSnapshot(listenerStats = {}) {
    let totalBytesSent = 0;
    let totalBytesRecv = 0;
    let totalPacketsSent = 0;
    let totalPacketsRecv = 0;
    let totalActiveStreams = 0;
    let totalUdpQueue = 0;
    let totalEvictions = 0;
    let avgRtt = 0;
    let maxCwnd = 0;

    const workersList = Array.from(this.workers.values());
    const connectedList = workersList.filter(w => w.isConnected);

    for (const w of workersList) {
      const s = w.stats || {};
      totalBytesSent += s.bytesSent || 0;
      totalBytesRecv += s.bytesReceived || 0;
      totalPacketsSent += s.packetsSent || 0;
      totalPacketsRecv += s.packetsReceived || 0;
      totalActiveStreams += s.activeStreams || 0;
      totalUdpQueue += s.udpQueue || 0;
      totalEvictions += s.packetEvictions || 0;
      if (s.rtt) avgRtt += s.rtt;
      if (s.cwnd > maxCwnd) maxCwnd = s.cwnd;
    }

    if (connectedList.length > 0) {
      avgRtt = Math.round(avgRtt / connectedList.length);
    }

    return {
      connected: connectedList.length > 0,
      activeWorkers: connectedList.length,
      totalWorkers: workersList.length,
      maxWorkers: this.maxWorkers,
      activeSessions: listenerStats.activeClientConnections || totalActiveStreams,
      activeStreams: totalActiveStreams,
      bytesSent: totalBytesSent,
      bytesReceived: totalBytesRecv,
      packetsSent: totalPacketsSent,
      packetsReceived: totalPacketsRecv,
      rtt: avgRtt,
      cwnd: maxCwnd,
      udpQueue: totalUdpQueue,
      packetEvictions: totalEvictions,
      hostQueueTotal: 0,
      activeTunnels: totalActiveStreams,
      retries: 0
    };
  }

  async close() {
    this.isClosed = true;
    for (const [id, entry] of this.workers.entries()) {
      try {
        entry.worker.postMessage({ type: 'CLOSE' });
        entry.worker.terminate();
      } catch (e) {}
    }
    this.workers.clear();
    this.pendingTunnelRequests = [];
    this._notifyState();
  }
}
