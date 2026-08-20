/**
 * WebTransport Connection Manager & High-Performance Stream Multiplexer.
 * Manages native browser WebTransport sessions to the Brook server.
 * Handles auto-reconnect, bidirectional stream allocation, and telemetry.
 */

import { WtStreamSession } from './wt-stream-adapter.js';
import { BrookTunnel } from '../core/brook-tunnel.js';

export const ConnectionState = {
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  ERROR: 'error'
};

export class WebTransportConnectionManager {
  constructor({
    serverHost,
    serverPort,
    path = '/brook',
    serverCertificateHashes = [],
    onStateChange = null,
    onLog = null
  }) {
    this.serverHost = serverHost;
    this.serverPort = serverPort;
    this.path = path.startsWith('/') ? path : `/${path}`;
    this.serverCertificateHashes = serverCertificateHashes;
    this.onStateChange = onStateChange;
    this.onLog = onLog;

    this.transport = null;
    this.state = ConnectionState.DISCONNECTED;
    this.activeStreams = new Set();
    this.totalStreamsServed = 0;
    this.isClosed = false;
    this.nextStreamSeq = 0;
    this.lastActivity = Date.now();
  }

  get serverUrl() {
    return `https://${this.serverHost}:${this.serverPort}${this.path}`;
  }

  static async getWebTransportClass() {
    if (typeof window !== 'undefined' && typeof window.WebTransport !== 'undefined') {
      return window.WebTransport;
    }
    if (typeof globalThis !== 'undefined' && typeof globalThis.WebTransport !== 'undefined') {
      return globalThis.WebTransport;
    }
    // Node.js fallback for tests
    try {
      const mod = await import('@fails-components/webtransport');
      return mod.WebTransport || mod.default?.WebTransport;
    } catch (e) {
      throw new Error('WebTransport is not supported in this environment');
    }
  }

  _setState(newState, details = '') {
    this.state = newState;
    if (this.onStateChange) {
      this.onStateChange(newState, details);
    }
  }

  _log(level, message, meta = null) {
    if (this.onLog) {
      this.onLog(level, message, meta);
    }
  }

  getSnapshot(dispatcher = null) {
    const tunnelStats = (BrookTunnel && BrookTunnel.globalMetrics) ? BrookTunnel.globalMetrics.getStats() : {
      rxQueuedBytes: 0,
      uploadPendingBytes: 0,
      writerWaitMs: 0
    };
    const dispStats = (dispatcher && dispatcher.getStats) ? dispatcher.getStats() : {
      hostQueueTotal: 0,
      activeTunnels: 0,
      retries: 0
    };

    return {
      warmStandby: this.isConnected() ? 1 : 0,
      activeSessions: this.isConnected() ? 1 : 0,
      handshakes: 0,
      handshakeQueue: 0,
      hostQueueTotal: dispStats.hostQueueTotal || 0,
      udpQueue: 0,
      udpQueueMax: 0,
      udpOldestMs: 0,
      udpWriteMsP95: 0,
      uploadPendingBytes: tunnelStats.uploadPendingBytes,
      rxQueuedBytes: tunnelStats.rxQueuedBytes,
      writerWaitMs: tunnelStats.writerWaitMs,
      activeTunnels: this.activeStreams.size,
      totalStreamsServed: this.totalStreamsServed,
      retries: dispStats.retries || 0,
      packetEvictions: 0
    };
  }

  isConnected() {
    return this.state === ConnectionState.CONNECTED && this.transport !== null;
  }

  /**
   * Establish initial WebTransport connection to server.
   */
  async connect() {
    if (this.isClosed) throw new Error('WebTransportConnectionManager is closed');
    this._setState(ConnectionState.CONNECTING, 'Connecting WebTransport session...');

    const WTClass = await WebTransportConnectionManager.getWebTransportClass();
    const url = `https://${this.serverHost}:${this.serverPort}${this.path}`;
    this._log('info', `Connecting WebTransport to ${url}...`);

    const options = {};
    if (this.serverCertificateHashes && this.serverCertificateHashes.length > 0) {
      options.serverCertificateHashes = this.serverCertificateHashes;
    }

    try {
      this.transport = new WTClass(url, options);

      // Handle close event
      this.transport.closed
        .then(() => {
          if (!this.isClosed) {
            this._setState(ConnectionState.DISCONNECTED, 'Server closed session');
            this._log('warning', 'WebTransport session closed by remote server');
          }
        })
        .catch((err) => {
          if (!this.isClosed) {
            this._setState(ConnectionState.ERROR, `Session error: ${err.message}`);
            this._log('error', `WebTransport session error: ${err.message}`);
          }
        });

      await this.transport.ready;
      this._setState(ConnectionState.CONNECTED);
      this._log('success', `✅ WebTransport session established to ${url}`);
      return this;
    } catch (err) {
      this._setState(ConnectionState.ERROR, `Failed: ${err.message}`);
      this._log('error', `❌ Failed to connect WebTransport: ${err.message}`);
      throw err;
    }
  }

  /**
   * Create an on-demand bidirectional stream session for a proxy tunnel.
   * Auto-connects WebTransport session if disconnected.
   */
  async createSession(options = {}) {
    if (this.isClosed) throw new Error('WebTransportConnectionManager is closed');

    // Ensure underlying WebTransport session is active
    if (!this.isConnected() || options.forceFresh) {
      if (options.forceFresh && this.transport) {
        try { this.transport.close(); } catch (e) {}
        this.transport = null;
      }
      await this.connect();
    }

    const streamId = (this.nextStreamSeq += 4);
    const bidiStream = await this.transport.createBidirectionalStream();

    const streamSession = new WtStreamSession({
      bidiStream,
      streamId,
      onClose: () => {
        this.activeStreams.delete(streamSession);
      },
      onLog: this.onLog
    });

    this.activeStreams.add(streamSession);
    this.totalStreamsServed++;
    this.lastActivity = Date.now();

    return streamSession;
  }

  /**
   * Measure network clock drift (in seconds) between local machine and standard UTC server.
   */
  static async measureClockDrift() {
    const fetchWithTimeout = async (url, parseFn) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2000);
      try {
        const start = Date.now();
        const resp = await fetch(url, { cache: 'no-store', signal: controller.signal });
        clearTimeout(timer);
        const rtt = Date.now() - start;
        const result = await parseFn(resp, rtt, start);
        if (typeof result === 'number' && !isNaN(result)) {
          return result;
        }
        throw new Error('Invalid clock parse');
      } catch (e) {
        clearTimeout(timer);
        throw e;
      }
    };

    const tasks = [
      fetchWithTimeout('https://cloudflare.com/cdn-cgi/trace', async (resp, rtt, start) => {
        const text = await resp.text();
        const m = text.match(/ts=([0-9.]+)/);
        if (m && m[1]) {
          const serverSec = parseFloat(m[1]);
          const localSec = (start + Math.round(rtt / 2)) / 1000;
          return Math.round(serverSec - localSec);
        }
        return null;
      })
    ];

    try {
      const fastResult = await Promise.any(tasks);
      if (typeof fastResult === 'number' && !isNaN(fastResult)) {
        return fastResult;
      }
    } catch (e) {}

    return 0;
  }

  async close() {
    this.isClosed = true;
    this._setState(ConnectionState.DISCONNECTED, 'Stopped by user');

    for (const streamSession of Array.from(this.activeStreams)) {
      try { streamSession.close(); } catch (e) {}
    }
    this.activeStreams.clear();

    if (this.transport) {
      try {
        this.transport.close();
      } catch (e) {}
      this.transport = null;
    }
  }
}
