/**
 * QUIC Connection Manager & High-Performance Session Pool.
 * Uses a single shared UDPSocket with exact O(1) Connection ID routing,
 * keep-alive PINGs, active pool hygiene, and pre-connected warm session pooling.
 */

import { QUICConnection } from '../../vendor/quic-engine.bundle.js';
import { UdpSocketAdapter } from './udp-socket-adapter.js';
import { BrookTunnel } from '../core/brook-tunnel.js';

export const ConnectionState = {
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  ERROR: 'error'
};

/**
 * Extract Destination Connection ID (DCID) hex string from raw QUIC datagram.
 * @param {Uint8Array} data
 * @returns {string|null}
 */
export function getDcidHex(data) {
  if (!data || data.length < 6) return null;
  const firstByte = data[0];
  if ((firstByte & 0x80) !== 0) {
    // Long Header: byte 5 is DCID Length
    const dcidLen = data[5];
    if (data.length < 6 + dcidLen) return null;
    return Array.from(data.subarray(6, 6 + dcidLen)).map(b => b.toString(16).padStart(2, '0')).join('');
  } else {
    // Short Header (1-RTT): 8-byte DCID
    if (data.length < 9) return null;
    return Array.from(data.subarray(1, 9)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
}

/**
 * Dedicated QUIC Session for a single Brook proxy tunnel with its own dedicated UDPSocket.
 * Strictly matches original Brook quicclient.go architecture (per-UDPSocket per-connect).
 */
export class QuicSession {
  constructor({ manager, serverHost, serverPort, alpn = ['h3'], onLog }) {
    this.manager = manager;
    this.serverHost = serverHost;
    this.serverPort = serverPort;
    this.alpn = Array.isArray(alpn) ? alpn : [alpn];
    this.onLog = onLog;

    this.udpAdapter = null;
    this.quic = null;
    this.streamHandlers = new Map();
    this.isClosed = false;
    this.isConnected = false;
    this.createdAt = Date.now();
    this.lastActivity = Date.now();
    this.lastPacketReceivedTime = Date.now();
    this.scidHex = null;
    this.dcidHex = null;

    // Multi-stream multiplexing support (RFC 9000 Client-Initiated Bidirectional Streams)
    this.nextStreamId = 0;
    this.activeStreams = 0;
    this.maxConcurrentStreams = 8;
    this.totalStreamsServed = 0;

    // Keep-alive telemetry tracking
    this.keepAlivePingCount = 0;
    this.keepAliveAckCount = 0;
    this.lastKeepAliveAckRecv = Date.now();
  }

  canAcceptStream() {
    return this.isAlive() && this.activeStreams < this.maxConcurrentStreams;
  }

  allocateStreamId() {
    const id = this.nextStreamId;
    this.nextStreamId += 4; // Client-initiated bidi stream IDs: 0, 4, 8, 12, 16...
    this.activeStreams++;
    this.totalStreamsServed++;
    return id;
  }

  releaseStream(streamId) {
    this.unregisterStream(streamId);
    this.activeStreams = Math.max(0, this.activeStreams - 1);
  }

  isAlive(maxIdleMs = 45000) {
    if (this.isClosed || !this.isConnected || !this.quic) return false;
    if (this.quic.state === 'closed' || this.quic.state === 'draining' || this.quic.state === 'closing') return false;
    return (Date.now() - this.lastPacketReceivedTime) < maxIdleMs;
  }

  feedDatagram(data, fromAddr, fromPort) {
    if (this.isClosed || !this.quic) return;
    this.lastActivity = Date.now();
    this.lastPacketReceivedTime = Date.now();
    this.lastKeepAliveAckRecv = Date.now();
    this.keepAliveAckCount++;
    this.quic.feedDatagram(fromAddr, fromPort, data);
  }

  async connect(timeoutMs = 25000) {
    if (this.isClosed) throw new Error('Session is closed');

    // 1. Open dedicated Direct Sockets UDPSocket for this connection (matching original quicclient.go)
    this.udpAdapter = new UdpSocketAdapter({
      remoteAddress: this.serverHost,
      remotePort: this.serverPort,
      onDatagram: (data, fromAddr, fromPort) => {
        this.feedDatagram(data, fromAddr, fromPort);
      },
      onError: (err) => {
        if (!this.isClosed && this.onLog) {
          this.onLog('warning', `[QUIC Session] Dedicated UDP socket error: ${err.message}`);
        }
      },
      onClose: () => {
        if (!this.isClosed) {
          this.close();
        }
      }
    });

    await this.udpAdapter.open();

    return new Promise((resolve, reject) => {
      let isResolved = false;
      const timer = setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          this.close();
          reject(new Error(`QUIC handshake timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);

      this.quic = new QUICConnection({
        isServer: false,
        hostname: this.serverHost,
        alpn: this.alpn,
        keepAlive: 2000, // Send keep-alive PING every 2s to detect dead paths fast on mobile/unstable networks
        idleTimeout: 45000,
        handshakeTimeout: 25000,
        rejectUnauthorized: false
      });

      this.quic.on('packet', (data) => {
        this.lastActivity = Date.now();
        if (!this.isClosed && this.udpAdapter) {
          this.udpAdapter.send(data).catch(() => {});
        }
      });

      this.quic.on('connect', () => {
        clearTimeout(timer);
        if (!isResolved) {
          isResolved = true;
          this.isConnected = true;
          this.lastActivity = Date.now();
          this.lastPacketReceivedTime = Date.now();
          if (this.manager) this.manager.registerSession(this);
          resolve(this);
        }
      });

      this.quic.on('stream', (streamId, data, fin) => {
        this.lastActivity = Date.now();
        this.lastPacketReceivedTime = Date.now();
        const handler = this.streamHandlers.get(streamId);
        if (handler && handler.onData) {
          handler.onData(data, fin);
        }
      });

      this.quic.on('error', (err) => {
        clearTimeout(timer);
        if (!isResolved) {
          isResolved = true;
          this.close();
          reject(err);
        }
      });

      this.quic.on('close', () => {
        clearTimeout(timer);
        if (!isResolved) {
          isResolved = true;
          reject(new Error('QUIC connection closed unexpectedly'));
        }
        this.close();
      });

      this.quic.connect();

      // Record Connection IDs if present
      if (this.quic.context) {
        if (this.quic.context.my_cids && this.quic.context.my_cids[0]) {
          this.scidHex = Array.from(this.quic.context.my_cids[0]).map(b => b.toString(16).padStart(2, '0')).join('');
        }
        if (this.quic.context.original_dcid) {
          this.dcidHex = Array.from(this.quic.context.original_dcid).map(b => b.toString(16).padStart(2, '0')).join('');
        }
      }
    });
  }

  registerStream(streamId, handlers) {
    this.streamHandlers.set(streamId, handlers);
  }

  unregisterStream(streamId) {
    this.streamHandlers.delete(streamId);
  }

  async sendStreamData(streamId, data, fin = false) {
    if (this.isClosed || !this.quic) {
      throw new Error('Cannot send stream data: QUIC session is closed');
    }
    this.lastActivity = Date.now();
    const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
    this.quic.sendStream(streamId, u8, fin);
  }

  async ensureConnected() {
    if (this.isClosed || !this.quic || !this.isConnected) {
      throw new Error('QUIC session is closed');
    }
  }

  close() {
    if (this.isClosed) return;
    this.isClosed = true;

    if (this.manager) {
      this.manager.unregisterSession(this);
    }

    for (const [id, handler] of this.streamHandlers.entries()) {
      if (handler.onClose) handler.onClose();
    }
    this.streamHandlers.clear();

    if (this.quic) {
      try { this.quic.close(0, 'close'); } catch (e) {}
      this.quic = null;
    }

    if (this.udpAdapter) {
      try { this.udpAdapter.close(); } catch (e) {}
      this.udpAdapter = null;
    }
  }
}

/**
 * Top-level Manager for Brook QUIC Client (On-Demand Per-UDPSocket Architecture).
 * Strictly matches original Brook quicclient.go: each proxy connection creates its
 * own dedicated QUIC session with an independent Direct Sockets UDPSocket, and destroys
 * it upon connection completion. No warm pool, no lingering idle connections.
 */
export class QuicConnectionManager {
  constructor({ serverHost, serverPort, alpn = ['h3'], onStateChange, onLog }) {
    this.serverHost = serverHost;
    this.serverPort = serverPort;
    this.alpn = Array.isArray(alpn) ? alpn : [alpn];
    this.onStateChange = onStateChange;
    this.state = ConnectionState.DISCONNECTED;
    this.activeSessions = new Set(); // Active connected sessions currently serving tunnels
    this.activeHandshakes = 0;
    this.maxConcurrentHandshakes = 16;
    this.handshakeQueue = [];
    this.isClosed = false;
  }

  getSnapshot(dispatcher = null) {
    let totalUdpQueue = 0;
    let maxUdpQueue = 0;
    let maxUdpOldestMs = 0;
    let writeDurations = [];
    let totalPacketEvictions = 0;

    // Aggregate stats across all live active sessions
    for (const session of this.activeSessions) {
      if (session.udpAdapter) {
        const stats = session.udpAdapter.getStats();
        totalUdpQueue += stats.udpQueue || 0;
        if (stats.udpQueueMax > maxUdpQueue) maxUdpQueue = stats.udpQueueMax;
        if (stats.udpOldestMs > maxUdpOldestMs) maxUdpOldestMs = stats.udpOldestMs;
        totalPacketEvictions += stats.packetEvictions || 0;
        if (session.udpAdapter.writeDurations) {
          writeDurations = writeDurations.concat(session.udpAdapter.writeDurations);
        }
      }
    }

    let udpWriteMsP95 = 0;
    if (writeDurations.length > 0) {
      const sorted = writeDurations.sort((a, b) => a - b);
      const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
      udpWriteMsP95 = Math.round(sorted[idx] * 10) / 10;
    }

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
      warmStandby: 0,
      activeSessions: this.activeSessions.size,
      handshakes: this.activeHandshakes,
      handshakeQueue: this.handshakeQueue.length,
      hostQueueTotal: dispStats.hostQueueTotal,
      udpQueue: totalUdpQueue,
      udpQueueMax: maxUdpQueue,
      udpOldestMs: maxUdpOldestMs,
      udpWriteMsP95,
      uploadPendingBytes: tunnelStats.uploadPendingBytes,
      rxQueuedBytes: tunnelStats.rxQueuedBytes,
      writerWaitMs: tunnelStats.writerWaitMs,
      activeTunnels: dispStats.activeTunnels,
      retries: dispStats.retries,
      packetEvictions: totalPacketEvictions,
      refillsStarted: 0,
      refillsCompleted: 0,
      refillsFailed: 0
    };
  }

  registerSession(session) {
    this.activeSessions.add(session);
  }

  unregisterSession(session) {
    this.activeSessions.delete(session);
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

  _handleTransportFailure(err) {
    if (this.isClosed) return;
    this.isClosed = true;
    while (this.handshakeQueue.length > 0) {
      const next = this.handshakeQueue.shift();
      if (next && next.reject) {
        next.reject(err || new Error('Transport failed'));
      }
    }
    this._closeAllSessions('transport_failed');
  }

  _closeAllSessions(reason = 'transport_closed') {
    const liveSessions = Array.from(this.activeSessions);
    for (const session of liveSessions) {
      try { session.close(); } catch (e) {}
    }
    this.activeSessions.clear();
  }

  /**
   * Initial pre-flight connection verification with QUIC server.
   */
  async connect() {
    if (this.isClosed) throw new Error('QuicConnectionManager is closed');
    this._setState(ConnectionState.CONNECTING, 'Verifying QUIC server...');
    this._log('info', `Connecting to Brook QUIC server ${this.serverHost}:${this.serverPort} (on-demand per-UDPSocket mode)...`);

    try {
      // Preflight Handshake verification: test reachability to QUIC server
      const preflight = new QuicSession({
        manager: null,
        serverHost: this.serverHost,
        serverPort: this.serverPort,
        alpn: this.alpn,
        onLog: this.onLog
      });

      await preflight.connect(15000);
      preflight.close(); // Clean up preflight probe immediately

      this._setState(ConnectionState.CONNECTED);
      this._log('success', `✅ QUIC server reached & ready (ALPN: ${this.alpn.join(',')}, on-demand per-UDPSocket mode)`);
    } catch (err) {
      this._setState(ConnectionState.ERROR, `Failed: ${err.message}`);
      this._log('error', `Failed to reach QUIC server: ${err.message}`);
      throw err;
    }
  }

  async _acquireHandshakePermit(priority = false) {
    if (this.isClosed) {
      throw new Error('QuicConnectionManager is closed');
    }
    if (this.activeHandshakes < this.maxConcurrentHandshakes) {
      this.activeHandshakes++;
      return;
    }
    const MAX_HANDSHAKE_QUEUE = 64;
    if (this.handshakeQueue.length >= MAX_HANDSHAKE_QUEUE) {
      throw new Error('QUIC handshake queue is full');
    }
    return new Promise((resolve, reject) => {
      const entry = { resolve, reject };
      if (priority) {
        this.handshakeQueue.unshift(entry);
      } else {
        this.handshakeQueue.push(entry);
      }
    });
  }

  _releaseHandshakePermit() {
    if (this.handshakeQueue.length > 0) {
      const next = this.handshakeQueue.shift();
      if (next && next.resolve) {
        next.resolve();
      } else if (typeof next === 'function') {
        next();
      }
    } else {
      this.activeHandshakes = Math.max(0, this.activeHandshakes - 1);
    }
  }

  /**
   * Create an on-demand, dedicated QUIC session for a proxy tunnel.
   * Matches original Brook quicclient.go: fresh UDPSocket per connect.
   * @param {Object} [options]
   * @returns {Promise<QuicSession>}
   */
  async createSession(options = {}) {
    if (this.isClosed) throw new Error('QuicConnectionManager is closed');

    const startHs = Date.now();
    await this._acquireHandshakePermit(true);
    const session = new QuicSession({
      manager: this,
      serverHost: this.serverHost,
      serverPort: this.serverPort,
      alpn: this.alpn,
      onLog: this.onLog
    });

    try {
      await session.connect(10000);
      const hsDuration = Date.now() - startHs;
      if (this.onLog) {
        this.onLog('info', `⚡ [QUIC] Dedicated 1-RTT session established in ${hsDuration}ms (active handshakes: ${this.activeHandshakes})`);
      }
      return session;
    } catch (err) {
      session.close();
      throw err;
    } finally {
      this._releaseHandshakePermit();
    }
  }

  /**
   * Measure network clock drift (in seconds) between local machine and standard UTC server.
   * Probes multiple fast Anycast UTC endpoints in parallel, returning the fastest valid response.
   * @returns {Promise<number>}
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
      // 1. Cloudflare Anycast Trace (ultra-fast)
      fetchWithTimeout('https://cloudflare.com/cdn-cgi/trace', async (resp, rtt, start) => {
        const text = await resp.text();
        const m = text.match(/ts=([0-9.]+)/);
        if (m && m[1]) {
          const serverSec = parseFloat(m[1]);
          const localSec = (start + Math.round(rtt / 2)) / 1000;
          return Math.round(serverSec - localSec);
        }
        return null;
      }),
      // 2. WorldTimeAPI UTC
      fetchWithTimeout('https://worldtimeapi.org/api/timezone/Etc/UTC', async (resp, rtt, start) => {
        const json = await resp.json();
        if (json && json.unixtime) {
          const serverSec = json.unixtime;
          const localSec = (start + Math.round(rtt / 2)) / 1000;
          return Math.round(serverSec - localSec);
        }
        return null;
      }),
      // 3. HTTP Date header fallback
      fetchWithTimeout('https://httpbin.org/ip', async (resp, rtt, start) => {
        const dateHeader = resp.headers.get('date');
        if (dateHeader) {
          const serverTime = new Date(dateHeader).getTime();
          const localTime = start + Math.round(rtt / 2);
          return Math.round((serverTime - localTime) / 1000);
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

    // Drain and reject all pending handshake permits
    while (this.handshakeQueue.length > 0) {
      const next = this.handshakeQueue.shift();
      if (next && next.reject) {
        next.reject(new Error('QuicConnectionManager is closed'));
      }
    }

    this._closeAllSessions('manager_closed');
  }
}
