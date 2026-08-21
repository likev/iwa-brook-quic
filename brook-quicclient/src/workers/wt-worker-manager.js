/**
 * WebTransport Worker Manager: manages on-demand Web Workers for WebTransport proxy streams.
 */

export class WtWorkerManager {
  constructor({
    serverHost,
    serverPort,
    path = '/brook',
    password,
    withoutBrook = true,
    clockOffsetSec = 0,
    onStateChange = null,
    onLog = null
  }) {
    this.serverHost = serverHost;
    this.serverPort = serverPort;
    this.path = path;
    this.password = password;
    this.withoutBrook = withoutBrook;
    this.clockOffsetSec = clockOffsetSec;
    this.onStateChange = onStateChange;
    this.onLog = onLog;

    this.workers = new Map(); // sessionId -> { worker, resolve, reject }
    this.isClosed = false;
  }

  _log(level, message, meta = null) {
    if (this.onLog) {
      this.onLog(level, message, meta);
    }
  }

  getSnapshot(listenerStats = {}) {
    return {
      warmStandby: 1,
      activeSessions: this.workers.size,
      activeTunnels: this.workers.size,
      handshakes: 0,
      handshakeQueue: 0,
      hostQueueTotal: 0,
      retries: 0
    };
  }

  /**
   * Spawn a new dedicated WebTransport Worker for an incoming client proxy connection.
   */
  async spawnTunnelWorker({ sessionId, dstBytes, targetStr, leftover, dialTimeoutMs, port }) {
    if (this.isClosed) {
      try {
        port.postMessage({ type: 'STREAM_FAILED', errorCode: 0x01 });
        port.close();
      } catch (e) {}
      return;
    }

    const workerUrl = new URL('./wt-session.worker.js', import.meta.url);
    const worker = new Worker(workerUrl, { type: 'module' });

    const entry = {
      worker,
      createdAt: Date.now(),
      targetStr
    };
    this.workers.set(sessionId, entry);

    worker.onmessage = (event) => {
      const msg = event.data;
      if (!msg) return;

      switch (msg.type) {
        case 'LOG':
          this._log(msg.level, msg.message, msg.meta);
          break;
        case 'DONE':
          if (msg.outcome && !msg.outcome.success && msg.outcome.error) {
            this._log('error', `[WT Worker #${sessionId}] Tunnel ended: ${msg.outcome.error}`);
          }
          this._terminateWorker(sessionId);
          break;
      }
    };

    worker.onerror = (err) => {
      this._log('error', `[WT Worker #${sessionId}] Worker exception: ${err.message || err}`);
      this._terminateWorker(sessionId);
    };

    worker.postMessage(
      {
        type: 'START_TUNNEL',
        sessionId,
        targetStr,
        dstBytes,
        leftover,
        dialTimeoutMs: dialTimeoutMs || 8000,
        serverHost: this.serverHost,
        serverPort: this.serverPort,
        path: this.path,
        password: this.password,
        withoutBrook: this.withoutBrook,
        clockOffsetSec: this.clockOffsetSec
      },
      port ? [port] : []
    );
  }

  _terminateWorker(sessionId) {
    const entry = this.workers.get(sessionId);
    if (entry) {
      this.workers.delete(sessionId);
      try {
        entry.worker.postMessage({ type: 'CLOSE' });
        entry.worker.terminate();
      } catch (e) {}
    }
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
  }
}
