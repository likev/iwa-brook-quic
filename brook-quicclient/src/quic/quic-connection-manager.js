/**
 * QUIC Connection Manager & High-Performance Session Pool.
 * Uses a single shared UDPSocket with exact O(1) Connection ID routing,
 * keep-alive PINGs, active pool hygiene, and pre-connected warm session pooling.
 */

import { QUICConnection } from '../../vendor/quic-engine.bundle.js';
import { UdpSocketAdapter } from './udp-socket-adapter.js';

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
 * Dedicated QUIC Session for a single Brook proxy tunnel.
 */
export class QuicSession {
  constructor({ manager, serverHost, serverPort, alpn = ['h3'], onLog }) {
    this.manager = manager;
    this.serverHost = serverHost;
    this.serverPort = serverPort;
    this.alpn = Array.isArray(alpn) ? alpn : [alpn];
    this.onLog = onLog;

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
        if (!this.isClosed && this.manager) {
          this.manager.sendDatagram(data);
        }
      });

      this.quic.on('connect', () => {
        clearTimeout(timer);
        if (!isResolved) {
          isResolved = true;
          this.isConnected = true;
          this.lastActivity = Date.now();
          this.lastPacketReceivedTime = Date.now();
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

      // Register Connection IDs with Manager
      if (this.quic.context) {
        if (this.quic.context.my_cids && this.quic.context.my_cids[0]) {
          this.scidHex = Array.from(this.quic.context.my_cids[0]).map(b => b.toString(16).padStart(2, '0')).join('');
          if (this.manager) this.manager.registerCid(this.scidHex, this);
        }
        if (this.quic.context.original_dcid) {
          this.dcidHex = Array.from(this.quic.context.original_dcid).map(b => b.toString(16).padStart(2, '0')).join('');
          if (this.manager) this.manager.registerCid(this.dcidHex, this);
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
      if (this.scidHex) this.manager.unregisterCid(this.scidHex);
      if (this.dcidHex) this.manager.unregisterCid(this.dcidHex);
    }

    for (const [id, handler] of this.streamHandlers.entries()) {
      if (handler.onClose) handler.onClose();
    }
    this.streamHandlers.clear();

    if (this.quic) {
      try { this.quic.close(0, 'close'); } catch (e) {}
      this.quic = null;
    }
  }
}

/**
 * Top-level Manager for Brook QUIC Client.
 */
export class QuicConnectionManager {
  constructor({ serverHost, serverPort, alpn = ['h3'], onStateChange, onLog }) {
    this.serverHost = serverHost;
    this.serverPort = serverPort;
    this.alpn = Array.isArray(alpn) ? alpn : [alpn];
    this.onStateChange = onStateChange;
    this.onLog = onLog;

    this.state = ConnectionState.DISCONNECTED;
    this.udpAdapter = null;
    this.sessionsByCid = new Map(); // cidHex -> QuicSession
    this.activeSessions = []; // Live persistent QUIC connections serving multiplexed streams
    this.warmPool = []; // Standby connected sessions ready to handle burst traffic
    this.targetActiveSessions = 12; // 12 persistent QUIC connections * 8 streams = 96 concurrent streams capacity
    this.targetPoolSize = 35; // Standby warm sessions
    this.activeHandshakes = 0;
    this.maxConcurrentHandshakes = 12;
    this.handshakeQueue = [];
    this._isRefilling = false;
    this._hygieneTimer = null;
    this.isClosed = false;
  }

  unregisterSession(session) {
    this.activeSessions = this.activeSessions.filter(s => s !== session);
    this.warmPool = this.warmPool.filter(s => s !== session);
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

  registerCid(cidHex, session) {
    this.sessionsByCid.set(cidHex, session);
  }

  unregisterCid(cidHex) {
    this.sessionsByCid.delete(cidHex);
  }

  sendDatagram(data) {
    if (this.udpAdapter && !this.isClosed) {
      this.udpAdapter.send(data).catch(() => {});
    }
  }

  _closeAllSessions(reason = 'transport_closed') {
    for (const session of this.warmPool) {
      try { session.close(); } catch (e) {}
    }
    this.warmPool = [];

    for (const session of this.activeSessions) {
      try { session.close(); } catch (e) {}
    }
    this.activeSessions = [];

    const activeSessions = Array.from(this.sessionsByCid.values());
    for (const session of activeSessions) {
      try { session.close(); } catch (e) {}
    }
    this.sessionsByCid.clear();
  }

  /**
   * Initial pre-flight connection verification and shared transport initialization.
   */
  async connect() {
    this._setState(ConnectionState.CONNECTING, `Connecting to ${this.serverHost}:${this.serverPort}`);
    this._log('info', `Initializing shared UDP transport with ${this.serverHost}:${this.serverPort}...`);

    try {
      this.udpAdapter = new UdpSocketAdapter({
        remoteAddress: this.serverHost,
        remotePort: this.serverPort,
        onDatagram: (data, fromAddr, fromPort) => {
          const dcidHex = getDcidHex(data);
          if (dcidHex && this.sessionsByCid.has(dcidHex)) {
            const session = this.sessionsByCid.get(dcidHex);
            if (session && !session.isClosed) {
              session.feedDatagram(data, fromAddr, fromPort);
            }
          }
        },
        onError: (err) => {
          this._log('error', `UDP transport error: ${err.message}`);
          this._closeAllSessions('UDP transport error');
        },
        onClose: () => {
          this._setState(ConnectionState.DISCONNECTED, 'UDP transport closed');
          this._closeAllSessions('UDP transport closed');
        }
      });

      await this.udpAdapter.open();

      // Pre-warm initial session
      const preflight = new QuicSession({
        manager: this,
        serverHost: this.serverHost,
        serverPort: this.serverPort,
        alpn: this.alpn,
        onLog: this.onLog
      });

      await preflight.connect(15000);
      this.activeSessions.push(preflight);

      this._setState(ConnectionState.CONNECTED, `Ready (${this.serverHost}:${this.serverPort})`);
      this._log('success', `✅ QUIC transport connected & persistent pool active (ALPN: ${this.alpn.join(',')})`);

      // Refill warm pool in background
      this._refillPool().catch(() => {});

      // Start periodic pool hygiene timer
      this._startPoolHygiene();
    } catch (err) {
      this._setState(ConnectionState.ERROR, `Failed: ${err.message}`);
      this._log('error', `Failed to reach QUIC server: ${err.message}`);
      throw err;
    }
  }

  _startPoolHygiene() {
    if (this._hygieneTimer) clearInterval(this._hygieneTimer);
    let hygieneCycles = 0;
    this._hygieneTimer = setInterval(() => {
      if (this.isClosed) return;
      hygieneCycles++;

      // Filter out dead active sessions (45s idle threshold)
      const liveActive = [];
      for (const s of this.activeSessions) {
        if (s && s.isAlive(45000)) {
          liveActive.push(s);
        } else if (s) {
          s.close();
        }
      }
      this.activeSessions = liveActive;

      // Filter out dead standby sessions (45s idle threshold)
      const liveWarm = [];
      for (const s of this.warmPool) {
        if (s && s.isAlive(45000)) {
          liveWarm.push(s);
        } else if (s) {
          s.close();
        }
      }
      this.warmPool = liveWarm;

      // Heartbeat event log every ~10s (every 4 cycles) to confirm keep-alive activity
      if (hygieneCycles % 4 === 0 && (this.activeSessions.length > 0 || this.warmPool.length > 0)) {
        let newestAckAgeSec = 999;
        for (const s of [...this.activeSessions, ...this.warmPool]) {
          if (s.lastKeepAliveAckRecv) {
            const ageSec = (Date.now() - s.lastKeepAliveAckRecv) / 1000;
            if (ageSec < newestAckAgeSec) newestAckAgeSec = ageSec;
          }
        }
        const ackInfo = newestAckAgeSec < 900 ? `latest ACK ${newestAckAgeSec.toFixed(1)}s ago` : 'awaiting ACK';
        this._log('info', `💓 [QUIC Pool] Keep-alive active: ${this.activeSessions.length} persistent + ${this.warmPool.length} standby sessions healthy (${ackInfo}).`);
      }

      // Refill if total live sessions fell below target
      const totalLive = this.activeSessions.length + this.warmPool.length;
      const targetTotal = this.targetActiveSessions + this.targetPoolSize;
      if (totalLive < targetTotal) {
        this._refillPool().catch(() => {});
      }
    }, 2500);
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

  async _refillPool() {
    if (this.isClosed || this._isRefilling) return;
    this._isRefilling = true;

    try {
      const targetTotal = this.targetActiveSessions + this.targetPoolSize;
      while ((this.activeSessions.length + this.warmPool.length) < targetTotal && !this.isClosed) {
        const needed = Math.min(6, targetTotal - (this.activeSessions.length + this.warmPool.length));
        if (needed <= 0) break;

        const refillTasks = Array.from({ length: needed }).map(async () => {
          try {
            await this._acquireHandshakePermit(false);
          } catch (permErr) {
            return;
          }
          const session = new QuicSession({
            manager: this,
            serverHost: this.serverHost,
            serverPort: this.serverPort,
            alpn: this.alpn,
            onLog: this.onLog
          });
          try {
            await session.connect(10000);
            if (!this.isClosed) {
              if (this.activeSessions.length < this.targetActiveSessions) {
                this.activeSessions.push(session);
              } else {
                this.warmPool.push(session);
              }
            } else {
              session.close();
            }
          } catch (e) {
            session.close();
          } finally {
            this._releaseHandshakePermit();
          }
        });

        await Promise.allSettled(refillTasks);
        if ((this.activeSessions.length + this.warmPool.length) >= targetTotal) break;
      }
    } finally {
      this._isRefilling = false;
    }
  }

  /**
   * Acquire a validated, connected QUIC session (reused from active pool, promoted from warm pool, or created on demand).
   * @param {Object} options
   * @param {boolean} options.forceFresh - When true (e.g. dial retry), bypasses active pooled sessions and grabs a guaranteed fresh session.
   * @returns {Promise<QuicSession>}
   */
  async createSession({ forceFresh = false } = {}) {
    if (this.isClosed) throw new Error('QuicConnectionManager is closed');

    // 1. Clean up and reuse an existing active persistent session with capacity (unless forceFresh is requested)
    if (!forceFresh) {
      this.activeSessions = this.activeSessions.filter(s => s && s.isAlive(45000));
      let bestActive = null;
      for (const s of this.activeSessions) {
        if (s.canAcceptStream()) {
          if (!bestActive || s.activeStreams < bestActive.activeStreams) {
            bestActive = s;
          }
        }
      }
      if (bestActive) {
        return bestActive;
      }
    }

    // 2. Check warm standby pool for 0ms latency with strict liveness verification
    while (this.warmPool.length > 0) {
      const session = this.warmPool.shift();
      if (session && session.isAlive(45000)) {
        this.activeSessions.push(session);
        this._refillPool().catch(() => {});
        return session;
      } else if (session) {
        session.close(); // Clean up stale corpse
      }
    }

    // 3. Fallback to rate-limited on-demand session creation over shared UDP socket
    await this._acquireHandshakePermit(true);
    const session = new QuicSession({
      manager: this,
      serverHost: this.serverHost,
      serverPort: this.serverPort,
      alpn: this.alpn,
      onLog: this.onLog
    });

    try {
      await session.connect(8000);
      this.activeSessions.push(session);
      this._refillPool().catch(() => {});
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
   * Uses AbortController with 2.5s timeout to prevent startup stalls.
   * @returns {Promise<number>}
   */
  static async measureClockDrift() {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2500);
      const start = Date.now();
      const resp = await fetch('https://httpbin.org/ip', { cache: 'no-store', signal: controller.signal });
      clearTimeout(timer);
      const dateHeader = resp.headers.get('date');
      if (dateHeader) {
        const serverTime = new Date(dateHeader).getTime();
        const rtt = Date.now() - start;
        const estimatedServerNow = serverTime + Math.round(rtt / 2);
        const offsetSec = Math.round((estimatedServerNow - Date.now()) / 1000);
        return offsetSec;
      }
    } catch (e) {}
    return 0;
  }

  async close() {
    this.isClosed = true;
    if (this._hygieneTimer) {
      clearInterval(this._hygieneTimer);
      this._hygieneTimer = null;
    }
    this._setState(ConnectionState.DISCONNECTED, 'Stopped by user');

    // Drain and reject all pending handshake permits
    while (this.handshakeQueue.length > 0) {
      const next = this.handshakeQueue.shift();
      if (next && next.reject) {
        next.reject(new Error('QuicConnectionManager is closed'));
      }
    }

    for (const session of this.warmPool) {
      session.close();
    }
    this.warmPool = [];

    for (const session of this.sessionsByCid.values()) {
      session.close();
    }
    this.sessionsByCid.clear();

    if (this.udpAdapter) {
      await this.udpAdapter.close().catch(() => {});
      this.udpAdapter = null;
    }
  }
}
