/**
 * Listener Worker Client (Main Thread).
 * Controls and supervises the dedicated Proxy Listener Web Worker.
 */

export class ListenerWorkerClient {
  constructor({ wtWorkerManager, quicWorkerManager, onLog, onBoundPorts }) {
    this.wtWorkerManager = wtWorkerManager || quicWorkerManager;
    this.onLog = onLog;
    this.onBoundPorts = onBoundPorts;

    this.worker = null;
    this.stats = { activeClientConnections: 0, totalSessionsServed: 0 };
    this.isStarted = false;
  }

  _log(level, message, meta = null) {
    if (this.onLog) {
      this.onLog(level, message, meta);
    }
  }

  getStats() {
    return this.stats;
  }

  async start(config) {
    await this.stop();

    const workerUrl = new URL('./proxy-listener.worker.js', import.meta.url);
    this.worker = new Worker(workerUrl, { type: 'module' });

    return new Promise((resolve, reject) => {
      let resolved = false;

      this.worker.onmessage = (event) => {
        const msg = event.data;
        if (!msg) return;

        switch (msg.type) {
          case 'LOG':
            this._log(msg.level, msg.message, msg.meta);
            break;
          case 'LISTENERS_BOUND':
            this.isStarted = true;
            if (this.onBoundPorts) this.onBoundPorts(msg.boundPorts);
            if (!resolved) {
              resolved = true;
              resolve(msg.boundPorts);
            }
            break;
          case 'LISTENERS_ERROR':
            if (!resolved) {
              resolved = true;
              reject(new Error(msg.error));
            }
            break;
          case 'STATS':
            this.stats = msg.stats;
            break;
          case 'REQUEST_TUNNEL': {
            const port = event.ports[0];
            if (this.wtWorkerManager) {
              this.wtWorkerManager.spawnTunnelWorker({
                sessionId: msg.sessionId,
                protocol: msg.protocol || 'SOCKS5',
                dstBytes: msg.dstBytes,
                targetStr: msg.targetStr,
                leftover: msg.leftover,
                dialTimeoutMs: msg.dialTimeoutMs,
                port
              });
            }
            break;
          }
        }
      };

      this.worker.onerror = (err) => {
        this._log('error', `[Listener Worker] Fatal worker error: ${err.message}`);
        if (!resolved) {
          resolved = true;
          reject(err);
        }
      };

      this.worker.postMessage({
        type: 'START_LISTENERS',
        config
      });
    });
  }

  async stop() {
    if (this.worker) {
      try {
        this.worker.postMessage({ type: 'STOP_LISTENERS' });
        this.worker.terminate();
      } catch (e) {}
      this.worker = null;
    }
    this.isStarted = false;
    this.stats = { activeClientConnections: 0, totalSessionsServed: 0 };
  }
}
