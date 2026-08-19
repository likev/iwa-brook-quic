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
  }

  isAlive(maxIdleMs = 5000) {
    if (this.isClosed || !this.isConnected || !this.quic) return false;
    if (this.quic.state === 'closed' || this.quic.state === 'draining' || this.quic.state === 'closing') return false;
    return (Date.now() - this.lastPacketReceivedTime) < maxIdleMs;
  }

  feedDatagram(data, fromAddr, fromPort) {
    if (this.isClosed || !this.quic) return;
    this.lastActivity = Date.now();
    this.lastPacketReceivedTime = Date.now();
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

  allocateStreamId() {
    return 0; // Brook sessions always start at stream 0
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
    this.warmPool = [];
    this.targetPoolSize = 20;
    this.activeHandshakes = 0;
    this.maxConcurrentHandshakes = 8;
    this.handshakeQueue = [];
    this._isRefilling = false;
    this._hygieneTimer = null;
    this.isClosed = false;
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
      this.warmPool.push(preflight);

      this._setState(ConnectionState.CONNECTED, `Ready (${this.serverHost}:${this.serverPort})`);
      this._log('success', `✅ QUIC transport connected & pool active (ALPN: ${this.alpn.join(',')})`);

      // Refill warm pool in background to target size (4)
      this._refillPool(this.targetPoolSize).catch(() => {});

      // Start periodic pool hygiene timer (every 2 seconds for fast dead-session detection)
      this._startPoolHygiene();
    } catch (err) {
      this._setState(ConnectionState.ERROR, `Failed: ${err.message}`);
      this._log('error', `Failed to reach QUIC server: ${err.message}`);
      throw err;
    }
  }

  _startPoolHygiene() {
    if (this._hygieneTimer) clearInterval(this._hygieneTimer);
    this._hygieneTimer = setInterval(() => {
      if (this.isClosed) return;
      // Filter out dead or stale sessions (> 5s without inbound packet)
      const valid = [];
      for (const s of this.warmPool) {
        if (s && s.isAlive(5000)) {
          valid.push(s);
        } else if (s) {
          s.close();
        }
      }
      this.warmPool = valid;
      // Refill if pool fell below target
      if (this.warmPool.length < this.targetPoolSize) {
        this._refillPool(this.targetPoolSize).catch(() => {});
      }
    }, 2000);
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

  async _refillPool(targetSize = this.targetPoolSize) {
    if (this.isClosed || this._isRefilling) return;
    this._isRefilling = true;

    try {
      while (this.warmPool.length < targetSize && !this.isClosed) {
        const needed = Math.min(6, targetSize - this.warmPool.length); // Refill up to 6 parallel sessions
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
              this.warmPool.push(session);
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
        if (this.warmPool.length >= targetSize) break;
      }
    } finally {
      this._isRefilling = false;
    }
  }

  /**
   * Acquire a validated, connected QUIC session (from warm pool or created on demand).
   * @returns {Promise<QuicSession>}
   */
  async createSession() {
    if (this.isClosed) throw new Error('QuicConnectionManager is closed');

    // 1. Check warm pool first for 0ms latency with strict liveness verification
    while (this.warmPool.length > 0) {
      const session = this.warmPool.shift();
      if (session && session.isAlive()) {
        this._refillPool(this.targetPoolSize).catch(() => {});
        return session;
      } else if (session) {
        session.close(); // Clean up stale corpse
      }
    }

    // 2. Fallback to rate-limited on-demand session creation over shared UDP socket
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
      this._refillPool(this.targetPoolSize).catch(() => {});
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
