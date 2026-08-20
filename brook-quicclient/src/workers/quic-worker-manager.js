/**
 * Per-Connection QUIC Worker Manager (Main Thread).
 * Spawns 1 dedicated Web Worker per QUIC Connection (with 1 dedicated UDPSocket).
 * No static pool, no worker limits: scales dynamically to 1 Worker per active connection.
 */

export class QuicWorkerManager {
  constructor({
    serverHost,
    serverPort,
    alpn = ['h3'],
    password,
    withoutBrook = false,
    clockOffsetSec = 0,
    onStateChange,
    onLog
  }) {
    this.serverHost = serverHost;
    this.serverPort = serverPort;
    this.alpn = alpn;
    this.password = password;
    this.withoutBrook = withoutBrook;
    this.clockOffsetSec = clockOffsetSec;
    this.onStateChange = onStateChange;
    this.onLog = onLog;

    this.activeWorkers = new Map(); // sessionId -> { worker, createdAt, targetStr, stats }
    this.totalConnectionsServed = 0;
    this.isClosed = false;
  }

  _log(level, message, meta = null) {
    if (this.onLog) {
      this.onLog(level, message, meta);
    }
  }

  _notifyState() {
    const activeCount = this.activeWorkers.size;
    if (this.onStateChange) {
      if (activeCount > 0) {
        this.onStateChange('connected', `${activeCount} active QUIC connection worker${activeCount > 1 ? 's' : ''}`);
      } else {
        this.onStateChange('connected', 'Proxy ready (0 active QUIC connection workers)');
      }
    }
  }

  /**
   * Spawn a new dedicated QUIC Worker for an incoming client proxy connection.
   */
  async spawnTunnelWorker({ sessionId, dstBytes, targetStr, leftover, dialTimeoutMs, port }) {
    if (this.isClosed) {
      try {
        port.postMessage({ type: 'STREAM_FAILED', errorCode: 0x01 });
        port.close();
      } catch (e) {}
      return;
    }

    this.totalConnectionsServed++;
    const workerUrl = new URL('./quic-session.worker.js', import.meta.url);
    const worker = new Worker(workerUrl, { type: 'module' });

    const entry = {
      worker,
      createdAt: Date.now(),
      targetStr,
      stats: {}
    };

    this.activeWorkers.set(sessionId, entry);
    this._notifyState();

    worker.onmessage = (event) => {
      const msg = event.data;
      if (!msg) return;

      switch (msg.type) {
        case 'LOG':
          this._log(msg.level, msg.message, msg.meta);
          break;
        case 'STATS':
          entry.stats = msg.stats;
          break;
        case 'DONE':
          if (msg.outcome && !msg.outcome.success && msg.outcome.error) {
            this._log('error', `[QUIC Worker #${sessionId}] Tunnel ended: ${msg.outcome.error}`);
          }
          this._terminateWorker(sessionId);
          break;
      }
    };

    worker.onerror = (err) => {
      this._log('error', `[QUIC Worker #${sessionId}] Worker exception: ${err.message || err}`);
      this._terminateWorker(sessionId);
    };

    // Launch the per-connection QUIC session in the new Web Worker (Direct Sockets handles hostname resolution internally)
    worker.postMessage({
      type: 'START_TUNNEL',
      sessionId,
      targetStr,
      dstBytes,
      leftover,
      dialTimeoutMs: dialTimeoutMs || 8000,
      serverHost: this.serverHost,
      serverPort: this.serverPort,
      alpn: this.alpn,
      password: this.password,
      withoutBrook: this.withoutBrook,
      clockOffsetSec: this.clockOffsetSec
    }, [port]); // Transfer MessagePort directly to worker
  }

  _terminateWorker(sessionId) {
    const entry = this.activeWorkers.get(sessionId);
    if (entry) {
      this.activeWorkers.delete(sessionId);
      try {
        entry.worker.postMessage({ type: 'CLOSE' });
        entry.worker.terminate();
      } catch (e) {}
      this._notifyState();
    }
  }

  getSnapshot(listenerStats = {}) {
    let totalBytesSent = 0;
    let totalBytesRecv = 0;
    let totalPacketsSent = 0;
    let totalPacketsRecv = 0;
    let totalUdpQueue = 0;
    let totalEvictions = 0;
    let avgRtt = 0;
    let maxCwnd = 0;

    const workersList = Array.from(this.activeWorkers.values());
    const connectedList = workersList.filter(w => w.stats && w.stats.isConnected);

    for (const w of workersList) {
      const s = w.stats || {};
      totalBytesSent += s.bytesSent || 0;
      totalBytesRecv += s.bytesReceived || 0;
      totalPacketsSent += s.packetsSent || 0;
      totalPacketsRecv += s.packetsReceived || 0;
      totalUdpQueue += s.udpQueue || 0;
      totalEvictions += s.packetEvictions || 0;
      if (s.rtt) avgRtt += s.rtt;
      if (s.cwnd > maxCwnd) maxCwnd = s.cwnd;
    }

    if (connectedList.length > 0) {
      avgRtt = Math.round(avgRtt / connectedList.length);
    }

    const activeCount = this.activeWorkers.size;

    return {
      connected: true,
      activeWorkers: activeCount,
      totalWorkers: activeCount + (listenerStats.activeClientConnections ? 1 : 0),
      totalConnectionsServed: this.totalConnectionsServed,
      activeSessions: listenerStats.activeClientConnections || activeCount,
      activeStreams: activeCount,
      bytesSent: totalBytesSent,
      bytesReceived: totalBytesRecv,
      packetsSent: totalPacketsSent,
      packetsReceived: totalPacketsRecv,
      rtt: avgRtt,
      cwnd: maxCwnd,
      udpQueue: totalUdpQueue,
      packetEvictions: totalEvictions,
      hostQueueTotal: 0,
      activeTunnels: activeCount,
      retries: 0
    };
  }

  async close() {
    this.isClosed = true;
    for (const [id, entry] of this.activeWorkers.entries()) {
      try {
        entry.worker.postMessage({ type: 'CLOSE' });
        entry.worker.terminate();
      } catch (e) {}
    }
    this.activeWorkers.clear();
    this._notifyState();
  }
}
