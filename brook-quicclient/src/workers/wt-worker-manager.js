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
    sessionTracker = null,
    onStateChange = null,
    onLog = null
  }) {
    this.serverHost = serverHost;
    this.serverPort = serverPort;
    this.path = path;
    this.password = password;
    this.withoutBrook = withoutBrook;
    this.clockOffsetSec = clockOffsetSec;
    this.sessionTracker = sessionTracker;
    this.onStateChange = onStateChange;
    this.onLog = onLog;

    this.workers = new Map(); // sessionId -> { worker, createdAt, lastActivity, targetStr }
    this.isClosed = false;

    // Periodic background reaper for dead / hung workers when network drops silently
    this.reaperInterval = setInterval(() => {
      if (this.isClosed) return;
      const now = Date.now();
      for (const [id, entry] of this.workers.entries()) {
        const ageMs = now - (entry.lastActivity || entry.createdAt);
        // If a worker has been around with zero activity for > 30s, force terminate it
        if (ageMs > 30000) {
          this._log('warning', `[WT Worker #${id}] Reaping stalled worker for ${entry.targetStr} (inactive for ${Math.round(ageMs / 1000)}s)`);
          this._terminateWorker(id);
        }
      }
    }, 5000);
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
   * Instantly flush all active worker sessions (e.g. on Wi-Fi drop / network offline event).
   * Resets active session counts and prepares the client for immediate, clean recovery.
   */
  flushStalledSessions(reason = 'network_offline') {
    if (this.workers.size === 0) return;
    this._log('warning', `⚡ Flushing ${this.workers.size} active worker session(s) due to ${reason}`);
    for (const [id, entry] of this.workers.entries()) {
      if (this.sessionTracker) {
        this.sessionTracker.closeSession(id);
      }
      try {
        entry.worker.postMessage({ type: 'CLOSE' });
        entry.worker.terminate();
      } catch (e) {}
    }
    this.workers.clear();
  }

  /**
   * Spawn a new dedicated WebTransport Worker for an incoming client proxy connection.
   */
  async spawnTunnelWorker({ sessionId, protocol, dstBytes, targetStr, leftover, dialTimeoutMs, port }) {
    if (this.isClosed) {
      try {
        port.postMessage({ type: 'STREAM_FAILED', errorCode: 0x01 });
        port.close();
      } catch (e) {}
      return;
    }

    if (this.sessionTracker) {
      this.sessionTracker.createSession({
        id: sessionId,
        protocol: protocol || 'SOCKS5',
        target: targetStr
      });
    }

    const workerUrl = new URL('./wt-session.worker.js', import.meta.url);
    const worker = new Worker(workerUrl, { type: 'module' });

    const entry = {
      worker,
      createdAt: Date.now(),
      lastActivity: Date.now(),
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
        case 'BYTES':
          entry.lastActivity = Date.now();
          if (this.sessionTracker) {
            this.sessionTracker.recordBytes(msg.sessionId, msg.sent || 0, msg.recv || 0);
          }
          break;
        case 'DONE':
          if (msg.outcome && !msg.outcome.success && msg.outcome.error) {
            this._log('error', `[WT Worker #${sessionId}] Tunnel ended: ${msg.outcome.error}`);
          }
          if (this.sessionTracker) {
            this.sessionTracker.closeSession(sessionId);
          }
          this._terminateWorker(sessionId);
          break;
      }
    };

    worker.onerror = (err) => {
      this._log('error', `[WT Worker #${sessionId}] Worker exception: ${err.message || err}`);
      if (this.sessionTracker) {
        this.sessionTracker.closeSession(sessionId);
      }
      this._terminateWorker(sessionId);
    };

    worker.postMessage(
      {
        type: 'START_TUNNEL',
        sessionId,
        targetStr,
        dstBytes,
        leftover,
        dialTimeoutMs: dialTimeoutMs || 6000,
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
      if (this.sessionTracker) {
        this.sessionTracker.closeSession(sessionId);
      }
      try {
        entry.worker.postMessage({ type: 'CLOSE' });
        entry.worker.terminate();
      } catch (e) {}
    }
  }

  async close() {
    this.isClosed = true;
    if (this.reaperInterval) {
      clearInterval(this.reaperInterval);
      this.reaperInterval = null;
    }
    for (const [id, entry] of this.workers.entries()) {
      if (this.sessionTracker) {
        this.sessionTracker.closeSession(id);
      }
      try {
        entry.worker.postMessage({ type: 'CLOSE' });
        entry.worker.terminate();
      } catch (e) {}
    }
    this.workers.clear();
  }
}
