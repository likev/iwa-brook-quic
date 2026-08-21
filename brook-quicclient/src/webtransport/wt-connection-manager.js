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
    poolSize = 5,
    onStateChange = null,
    onLog = null
  }) {
    this.serverHost = serverHost;
    this.serverPort = serverPort;
    this.path = path.startsWith('/') ? path : `/${path}`;
    this.serverCertificateHashes = serverCertificateHashes;
    this.poolSize = poolSize || 5;
    this.onStateChange = onStateChange;
    this.onLog = onLog;

    this.isClosed = false;
    this.totalStreamsServed = 0;
    this.lastActivity = Date.now();
    this.state = ConnectionState.DISCONNECTED;

    // Initialize pool of independent WebTransport session slots
    this.slots = Array.from({ length: this.poolSize }, (_, index) => ({
      id: index,
      transport: null,
      state: ConnectionState.DISCONNECTED,
      connectPromise: null,
      activeStreams: new Set(),
      totalStreamsServed: 0,
      nextStreamSeq: index * 2
    }));
  }

  get serverUrl() {
    return `https://${this.serverHost}:${this.serverPort}${this.path}`;
  }

  get transport() {
    const active = this.slots.find(s => s.state === ConnectionState.CONNECTED && s.transport !== null);
    return active ? active.transport : (this.slots[0] ? this.slots[0].transport : null);
  }

  set transport(val) {
    if (this.slots && this.slots[0]) {
      this.slots[0].transport = val;
    }
  }

  get activeStreams() {
    const combined = new Set();
    for (const slot of this.slots) {
      for (const st of slot.activeStreams) {
        combined.add(st);
      }
    }
    return combined;
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

  _updateAggregateState() {
    const connectedCount = this.slots.filter(s => s.state === ConnectionState.CONNECTED && s.transport !== null).length;
    const connectingCount = this.slots.filter(s => s.state === ConnectionState.CONNECTING).length;

    if (connectedCount > 0) {
      this._setState(ConnectionState.CONNECTED, `Pool: ${connectedCount}/${this.poolSize} active`);
    } else if (connectingCount > 0) {
      this._setState(ConnectionState.CONNECTING, `Connecting pool (${connectingCount}/${this.poolSize})...`);
    } else {
      this._setState(ConnectionState.DISCONNECTED, 'Pool disconnected');
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

    const connectedCount = this.slots.filter(s => s.state === ConnectionState.CONNECTED && s.transport !== null).length;

    return {
      warmStandby: connectedCount,
      activeSessions: connectedCount,
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
      packetEvictions: 0,
      poolSize: this.poolSize,
      connectedPoolSessions: connectedCount
    };
  }

  isConnected() {
    return this.slots.some(s => s.state === ConnectionState.CONNECTED && s.transport !== null);
  }

  /**
   * Reset all active WebTransport sessions and clear all hanging streams.
   */
  resetSession(reason = 'network_offline') {
    for (const slot of this.slots) {
      if (slot.state === ConnectionState.CONNECTED && slot.transport) {
        try { slot.transport.close(); } catch (e) {}
        slot.transport = null;
      }
      for (const stream of slot.activeStreams) {
        try { stream.close(); } catch (e) {}
      }
      slot.activeStreams.clear();
      if (slot.state !== ConnectionState.CONNECTING) {
        slot.state = ConnectionState.DISCONNECTED;
      }
    }
    this._updateAggregateState();
  }

  /**
   * Connect a specific pool slot with single-flight deduplication.
   */
  async _connectSlot(slot, options = {}) {
    if (this.isClosed) throw new Error('WebTransportConnectionManager is closed');
    if (slot.state === ConnectionState.CONNECTED && slot.transport) return slot;
    if (slot.connectPromise) return slot.connectPromise;

    slot.state = ConnectionState.CONNECTING;

    slot.connectPromise = (async () => {
      const WTClass = await WebTransportConnectionManager.getWebTransportClass();
      const url = `https://${this.serverHost}:${this.serverPort}${this.path}`;
      this._log('info', `Connecting WebTransport pool session #${slot.id + 1}/${this.poolSize} to ${url}...`);

      const wtOptions = {};
      if (this.serverCertificateHashes && this.serverCertificateHashes.length > 0) {
        wtOptions.serverCertificateHashes = this.serverCertificateHashes;
      }

      let localTransport = null;
      let timer = null;

      try {
        localTransport = new WTClass(url, wtOptions);
        slot.transport = localTransport;

        // Handle close event
        localTransport.closed
          .then(() => {
            if (slot.transport === localTransport) {
              slot.transport = null;
              slot.state = ConnectionState.DISCONNECTED;
              if (!this.isClosed) {
                this._log('warning', `WebTransport pool session #${slot.id + 1} closed`);
                this._updateAggregateState();
              }
            }
          })
          .catch((err) => {
            if (slot.transport === localTransport) {
              slot.transport = null;
              slot.state = ConnectionState.DISCONNECTED;
              if (!this.isClosed) {
                this._log('warning', `WebTransport pool session #${slot.id + 1} error: ${err.message}`);
                this._updateAggregateState();
              }
            }
          });

        // Strict connect timeout (default 5s)
        const connectTimeoutMs = options.connectTimeoutMs || 5000;
        const timeoutPromise = new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`WebTransport pool #${slot.id + 1} timed out after ${connectTimeoutMs}ms`)), connectTimeoutMs);
        });

        await Promise.race([localTransport.ready, timeoutPromise]);
        if (timer) clearTimeout(timer);

        slot.transport = localTransport;
        slot.state = ConnectionState.CONNECTED;
        this._log('success', `✅ WebTransport pool session #${slot.id + 1}/${this.poolSize} established`);
        this._updateAggregateState();
        return slot;
      } catch (err) {
        if (timer) clearTimeout(timer);
        if (localTransport) {
          try { localTransport.close(); } catch (e) {}
        }
        if (slot.transport === localTransport) {
          slot.transport = null;
        }
        slot.state = ConnectionState.DISCONNECTED;
        this._updateAggregateState();
        throw err;
      } finally {
        slot.connectPromise = null;
      }
    })();

    return slot.connectPromise;
  }

  /**
   * Establish WebTransport connection pool across all slots in parallel.
   */
  async connect(options = {}) {
    if (this.isClosed) throw new Error('WebTransportConnectionManager is closed');
    this._setState(ConnectionState.CONNECTING, `Connecting WebTransport pool (${this.poolSize} sessions)...`);

    const results = await Promise.allSettled(this.slots.map(s => this._connectSlot(s, options)));
    const connectedCount = this.slots.filter(s => s.state === ConnectionState.CONNECTED && s.transport !== null).length;

    if (connectedCount === 0) {
      const firstError = results.find(r => r.status === 'rejected')?.reason;
      this._setState(ConnectionState.DISCONNECTED, `All ${this.poolSize} pool connections failed`);
      throw firstError || new Error(`Failed to connect WebTransport pool (${this.poolSize} sessions)`);
    }

    this._updateAggregateState();
    return this;
  }

  /**
   * Create an on-demand bidirectional stream session.
   * Dispatches request to the least-loaded active WebTransport connection in the pool.
   */
  async createSession(options = {}) {
    if (this.isClosed) throw new Error('WebTransportConnectionManager is closed');

    // 1. Find all active connected slots
    let connectedSlots = this.slots.filter(s => s.state === ConnectionState.CONNECTED && s.transport !== null);

    // 2. If no slots are connected, connect pool now
    if (connectedSlots.length === 0) {
      await this.connect(options);
      connectedSlots = this.slots.filter(s => s.state === ConnectionState.CONNECTED && s.transport !== null);
    }

    if (connectedSlots.length === 0) {
      throw new Error('No active WebTransport connections available in pool');
    }

    // 3. Proactively background-reconnect any disconnected slots to keep pool full
    for (const slot of this.slots) {
      if (slot.state === ConnectionState.DISCONNECTED && !slot.connectPromise) {
        this._connectSlot(slot, options).catch(() => {});
      }
    }

    // 4. Select least-loaded slot (fewest active streams)
    connectedSlots.sort((a, b) => a.activeStreams.size - b.activeStreams.size);
    const chosenSlot = connectedSlots[0];

    const streamId = (chosenSlot.nextStreamSeq += 4);

    // Strict stream creation timeout (default 5s)
    const streamTimeoutMs = options.streamTimeoutMs || 5000;
    let streamTimer = null;
    const timeoutPromise = new Promise((_, reject) => {
      streamTimer = setTimeout(() => reject(new Error(`WebTransport stream allocation on pool #${chosenSlot.id + 1} timed out after ${streamTimeoutMs}ms`)), streamTimeoutMs);
    });

    let bidiStream;
    try {
      bidiStream = await Promise.race([
        chosenSlot.transport.createBidirectionalStream(),
        timeoutPromise
      ]);
    } catch (err) {
      if (chosenSlot.transport) {
        chosenSlot.state = ConnectionState.DISCONNECTED;
        try { chosenSlot.transport.close(); } catch (e) {}
        chosenSlot.transport = null;
        this._updateAggregateState();
      }
      throw err;
    } finally {
      if (streamTimer) clearTimeout(streamTimer);
    }

    const streamSession = new WtStreamSession({
      bidiStream,
      streamId,
      onClose: () => {
        chosenSlot.activeStreams.delete(streamSession);
      },
      onLog: this.onLog
    });

    chosenSlot.activeStreams.add(streamSession);
    chosenSlot.totalStreamsServed++;
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

    for (const slot of this.slots) {
      for (const streamSession of Array.from(slot.activeStreams)) {
        try { streamSession.close(); } catch (e) {}
      }
      slot.activeStreams.clear();

      if (slot.transport) {
        try {
          slot.transport.close();
        } catch (e) {}
        slot.transport = null;
      }
      slot.state = ConnectionState.DISCONNECTED;
    }
  }
}
