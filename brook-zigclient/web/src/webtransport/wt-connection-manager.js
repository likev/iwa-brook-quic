/**
 * WebTransport Connection Manager & High-Performance Stream Multiplexer.
 * Manages native browser WebTransport sessions to the Brook server.
 * Handles auto-reconnect, bidirectional stream allocation, and telemetry.
 */

import { WtStreamSession } from './wt-stream-adapter.js';
import { WebSocketConnectionManager } from './ws-connection-manager.js';
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
    wsPath = '/brook-ws',
    serverCertificateHashes = [],
    poolSize = 5,
    baseWarmSlots = 2,
    scaleUpStreamsPerSlot = 16,
    warmStaggerMs = 600,
    keepaliveIntervalMs = 20000,
    keepaliveIdleThresholdMs = 15000,
    zombieFailureThreshold = 2,
    enableWsFallback = true,
    wsFallbackFailureThreshold = 2,
    quicRecoveryProbeIntervalMs = 60000,
    wsPoolSize = 2,
    WebSocketClass = null,
    networkMonitor = null,
    onStateChange = null,
    onLog = null
  }) {
    this.serverHost = serverHost;
    this.serverPort = serverPort;
    this.path = path.startsWith('/') ? path : `/${path}`;
    this.wsPath = wsPath.startsWith('/') ? wsPath : `/${wsPath}`;
    this.serverCertificateHashes = serverCertificateHashes;
    this.poolSize = poolSize || 5;
    this.baseWarmSlots = Math.max(1, Math.min(this.poolSize, baseWarmSlots || 2));
    this.scaleUpStreamsPerSlot = Math.max(1, scaleUpStreamsPerSlot || 16);
    this.warmStaggerMs = Math.max(0, warmStaggerMs ?? 600);
    this.keepaliveIntervalMs = Math.max(0, keepaliveIntervalMs ?? 20000);
    this.keepaliveIdleThresholdMs = Math.max(1000, keepaliveIdleThresholdMs ?? 15000);
    this.zombieFailureThreshold = Math.max(1, zombieFailureThreshold || 2);
    // Browser WebSocket cannot use serverCertificateHashes pinning; disable fallback only when custom pinned hashes are set unless explicitly enabled
    this.enableWsFallback = Boolean(enableWsFallback) && !(serverCertificateHashes && serverCertificateHashes.length > 0);
    this.wsFallbackFailureThreshold = Math.max(1, wsFallbackFailureThreshold || 2);
    this.quicRecoveryProbeIntervalMs = Math.max(0, quicRecoveryProbeIntervalMs ?? 60000);
    this.wsPoolSize = Math.max(1, wsPoolSize || 2);
    this.WebSocketClass = WebSocketClass;
    this.networkMonitor = networkMonitor;
    this.onStateChange = onStateChange;
    this.onLog = onLog;

    this.isClosed = false;
    this.totalStreamsServed = 0;
    this.lastActivity = Date.now();
    this.lastDataActivityAt = 0;
    this.state = ConnectionState.DISCONNECTED;
    this._nextConnectSlotIdx = 0;
    this._lastBackgroundWarmAt = 0;
    this._keepaliveTimer = null;

    // Tier 3 automatic WebTransport <-> WebSocket fallback state
    this.transportMode = 'webtransport'; // 'webtransport' | 'websocket'
    this.consecutiveQuicConnectFailures = 0;
    this.wsManager = null;
    this._quicRecoveryTimer = null;
    this._probingQuicRecovery = false;

    // Initialize pool of independent WebTransport session slots with per-slot health metrics
    this.slots = Array.from({ length: this.poolSize }, (_, index) => ({
      id: index,
      transport: null,
      state: ConnectionState.DISCONNECTED,
      connectPromise: null,
      activeStreams: new Set(),
      totalStreamsServed: 0,
      nextStreamSeq: index * 2,
      consecutiveFailures: 0,
      ewmaDialMs: 0,
      lastSuccessAt: 0,
      lastFailedAt: 0,
      lastActivityAt: 0,
      lastKeepaliveAt: 0
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
    if (this.wsManager) {
      for (const st of this.wsManager.activeStreams) {
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

    if (this.transportMode === 'websocket' && this.wsManager) {
      const wsConnected = this.wsManager.getConnectedSlotCount();
      if (wsConnected > 0) {
        this._setState(ConnectionState.CONNECTED, `WS Fallback (TCP): ${wsConnected}/${this.wsManager.poolSize} active`);
        return;
      }
    }

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
    const wsConnectedCount = this.wsManager ? this.wsManager.getConnectedSlotCount() : 0;
    const effectiveConnected = this.transportMode === 'websocket' ? wsConnectedCount : connectedCount;

    return {
      warmStandby: effectiveConnected,
      activeSessions: effectiveConnected,
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
      totalStreamsServed: this.totalStreamsServed + (this.wsManager ? this.wsManager.totalStreamsServed : 0),
      retries: dispStats.retries || 0,
      packetEvictions: 0,
      poolSize: this.poolSize,
      connectedPoolSessions: connectedCount,
      transportMode: this.transportMode,
      wsFallbackSessions: wsConnectedCount
    };
  }

  isConnected() {
    if (this.slots.some(s => s.state === ConnectionState.CONNECTED && s.transport !== null)) {
      return true;
    }
    return this.transportMode === 'websocket' && Boolean(this.wsManager && this.wsManager.isConnected());
  }

  getConnectedSlotCount() {
    if (this.transportMode === 'websocket' && this.wsManager) {
      return this.wsManager.getConnectedSlotCount();
    }
    return this.slots.filter(s => s.state === ConnectionState.CONNECTED && s.transport !== null).length;
  }

  /**
   * Returns true if active Brook traffic flowed on a live QUIC or WebSocket fallback session within windowMs.
   * Used by NetworkMonitor to avoid false-offline transitions when public probe APIs hiccup.
   */
  hasRecentActivity(windowMs = 10000) {
    const quicActive = this.slots.some(s => s.state === ConnectionState.CONNECTED && s.transport !== null) &&
      this.lastDataActivityAt > 0 && (Date.now() - this.lastDataActivityAt) < windowMs;
    if (quicActive) return true;
    return Boolean(this.wsManager && this.wsManager.hasRecentActivity(windowMs));
  }

  markActivity(slotId = null) {
    const now = Date.now();
    this.lastActivity = now;
    this.lastDataActivityAt = now;
    if (typeof slotId === 'string' && slotId.startsWith('ws:')) {
      if (this.wsManager) this.wsManager.markActivity(slotId);
      return;
    }
    if (slotId !== null && slotId !== undefined && this.slots[slotId]) {
      this.slots[slotId].lastActivityAt = now;
    }
  }

  /**
   * Report a successful Brook dial on a pool slot to improve its health score.
   */
  reportSlotSuccess(slotId, dialMs = 0) {
    if (typeof slotId === 'string' && slotId.startsWith('ws:')) {
      const now = Date.now();
      this.lastActivity = now;
      this.lastDataActivityAt = now;
      if (this.wsManager) this.wsManager.reportSlotSuccess(slotId, dialMs);
      return;
    }
    const slot = (slotId !== null && slotId !== undefined) ? this.slots[slotId] : null;
    const now = Date.now();
    this.lastActivity = now;
    this.lastDataActivityAt = now;
    this.consecutiveQuicConnectFailures = 0;
    if (!slot) return;
    slot.consecutiveFailures = 0;
    slot.lastSuccessAt = now;
    slot.lastActivityAt = now;
    if (dialMs > 0) {
      slot.ewmaDialMs = slot.ewmaDialMs > 0 ? Math.round(slot.ewmaDialMs * 0.7 + dialMs * 0.3) : Math.round(dialMs);
    }
  }

  /**
   * Report a pre-handshake / transport failure on a pool slot.
   * Deprioritizes the slot immediately and evicts zombie sessions after zombieFailureThreshold failures.
   */
  reportSlotFailure(slotId, reason = 'handshake_failed') {
    if (typeof slotId === 'string' && slotId.startsWith('ws:')) {
      if (this.wsManager) this.wsManager.reportSlotFailure(slotId, reason);
      return;
    }
    const slot = (slotId !== null && slotId !== undefined) ? this.slots[slotId] : null;
    if (!slot) return;
    slot.consecutiveFailures++;
    slot.lastFailedAt = Date.now();

    if (slot.consecutiveFailures >= this.zombieFailureThreshold && slot.transport) {
      const deadTransport = slot.transport;
      slot.transport = null;
      slot.state = ConnectionState.DISCONNECTED;
      slot.consecutiveFailures = 0;
      try { deadTransport.close(); } catch (e) {}
      for (const st of Array.from(slot.activeStreams)) {
        try { st.close(); } catch (e) {}
      }
      slot.activeStreams.clear();
      this._log('warning', `🧹 Evicted zombie WebTransport pool session #${slot.id + 1} (${reason})`);
      this._updateAggregateState();

      // Proactively replace evicted slot if online and below baseWarmSlots
      if (!this.isClosed && (!this.networkMonitor || this.networkMonitor.isOnline)) {
        const aliveOrConnecting = this.slots.filter(
          s => (s.state === ConnectionState.CONNECTED && s.transport !== null) || s.connectPromise
        ).length;
        if (aliveOrConnecting < this.baseWarmSlots) {
          this._connectSlot(slot).catch(() => {});
        }
      }
    }
  }

  _ensureKeepaliveLoop() {
    if (this._keepaliveTimer || this.keepaliveIntervalMs <= 0 || this.isClosed) return;
    this._keepaliveTimer = setInterval(() => {
      this._runKeepaliveTick().catch(() => {});
    }, this.keepaliveIntervalMs);
    if (typeof this._keepaliveTimer.unref === 'function') {
      this._keepaliveTimer.unref();
    }
  }

  _stopKeepaliveLoop() {
    if (this._keepaliveTimer) {
      clearInterval(this._keepaliveTimer);
      this._keepaliveTimer = null;
    }
  }

  async _sendSlotKeepalive(slot) {
    const transport = slot.transport;
    if (!transport || slot.state !== ConnectionState.CONNECTED) return false;
    const writable = transport.datagrams?.writable;
    if (!writable || typeof writable.getWriter !== 'function') return false;

    let writer = null;
    let timer = null;
    try {
      writer = writable.getWriter();
      const writePromise = writer.write(new Uint8Array([0x00]));
      writePromise.catch(() => {});
      const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('keepalive datagram timeout')), 1500);
      });
      await Promise.race([writePromise, timeoutPromise]);
      const now = Date.now();
      slot.lastKeepaliveAt = now;
      slot.lastActivityAt = now;
      return true;
    } catch (err) {
      if (slot.transport === transport) {
        this.reportSlotFailure(slot.id, `keepalive_failed: ${err.message || err}`);
      }
      return false;
    } finally {
      if (timer) clearTimeout(timer);
      if (writer) {
        try { writer.releaseLock(); } catch (e) {}
      }
    }
  }

  /**
   * Lightweight client-side NAT keepalive on up to baseWarmSlots idle connected sessions.
   */
  async _runKeepaliveTick() {
    if (this.isClosed) {
      this._stopKeepaliveLoop();
      return;
    }
    if (this.networkMonitor && !this.networkMonitor.isOnline) return;

    const connectedSlots = this.slots
      .filter(s => s.state === ConnectionState.CONNECTED && s.transport !== null)
      .sort((a, b) => a.consecutiveFailures - b.consecutiveFailures || b.lastSuccessAt - a.lastSuccessAt);

    if (connectedSlots.length === 0) return;

    const now = Date.now();
    const targets = connectedSlots.slice(0, this.baseWarmSlots);
    for (const slot of targets) {
      if (now - slot.lastActivityAt >= this.keepaliveIdleThresholdMs) {
        await this._sendSlotKeepalive(slot);
      }
    }
  }

  _getOrCreateWsManager() {
    if (!this.wsManager) {
      this.wsManager = new WebSocketConnectionManager({
        serverHost: this.serverHost,
        serverPort: this.serverPort,
        path: this.wsPath,
        poolSize: this.wsPoolSize,
        keepaliveIntervalMs: this.keepaliveIntervalMs,
        keepaliveIdleThresholdMs: this.keepaliveIdleThresholdMs,
        zombieFailureThreshold: this.zombieFailureThreshold,
        networkMonitor: this.networkMonitor,
        WebSocketClass: this.WebSocketClass,
        onStateChange: () => this._updateAggregateState(),
        onLog: this.onLog
      });
    }
    return this.wsManager;
  }

  _ensureQuicRecoveryLoop() {
    if (this._quicRecoveryTimer || this.quicRecoveryProbeIntervalMs <= 0 || this.isClosed) return;
    this._quicRecoveryTimer = setInterval(() => {
      this._probeQuicRecovery().catch(() => {});
    }, this.quicRecoveryProbeIntervalMs);
    if (typeof this._quicRecoveryTimer.unref === 'function') {
      this._quicRecoveryTimer.unref();
    }
  }

  _stopQuicRecoveryLoop() {
    if (this._quicRecoveryTimer) {
      clearInterval(this._quicRecoveryTimer);
      this._quicRecoveryTimer = null;
    }
  }

  async _activateWsFallback(reason = 'quic_failed', options = {}) {
    if (!this.enableWsFallback || this.isClosed) {
      throw new Error(`WebSocket fallback disabled (${reason})`);
    }
    const wasWs = this.transportMode === 'websocket';
    const wsMgr = this._getOrCreateWsManager();
    if (!wasWs) {
      this._log('warning', `🔄 WebTransport/UDP failed (${reason}). Falling back to WebSocket over TCP (${wsMgr.serverUrl})...`);
    }
    await wsMgr.connect(options);
    this.transportMode = 'websocket';
    this._ensureQuicRecoveryLoop();
    this._updateAggregateState();
    return wsMgr;
  }

  /**
   * Background QUIC probe while running in WebSocket fallback mode.
   * Switches new streams back to HTTP/3 QUIC as soon as UDP path recovers.
   */
  async _probeQuicRecovery() {
    if (this.isClosed || this.transportMode !== 'websocket' || this._probingQuicRecovery) return false;
    if (this.networkMonitor && !this.networkMonitor.isOnline) return false;

    this._probingQuicRecovery = true;
    try {
      await this._connectSlot(this.slots[0], { connectTimeoutMs: 6000 });
      if (this.isClosed) return false;
      this.transportMode = 'webtransport';
      this.consecutiveQuicConnectFailures = 0;
      this._stopQuicRecoveryLoop();
      this._log('success', '⚡ WebTransport/UDP recovered! Switching new streams back from WebSocket TCP fallback to HTTP/3 QUIC.');
      this._updateAggregateState();
      if (this.wsManager) {
        this.wsManager.drainAndClose();
      }
      return true;
    } catch (e) {
      return false;
    } finally {
      this._probingQuicRecovery = false;
    }
  }

  /**
   * Reset all active WebTransport sessions and clear all hanging streams.
   */
  resetSession(reason = 'network_offline') {
    this._stopKeepaliveLoop();
    this._stopQuicRecoveryLoop();
    for (const slot of this.slots) {
      if (slot.connectAbortController) {
        try { slot.connectAbortController.abort(); } catch (e) {}
        slot.connectAbortController = null;
      }
      slot.connectPromise = null;
      if (slot.transport) {
        try { slot.transport.close(); } catch (e) {}
        slot.transport = null;
      }
      for (const stream of slot.activeStreams) {
        try { stream.close(); } catch (e) {}
      }
      slot.activeStreams.clear();
      slot.state = ConnectionState.DISCONNECTED;
      slot.consecutiveFailures = 0;
    }
    if (this.wsManager) {
      this.wsManager.resetSession(reason);
    }
    this._updateAggregateState();
  }

  /**
   * Connect a specific pool slot with single-flight deduplication.
   */
  async _connectSlot(slot, options = {}) {
    if (this.isClosed) throw new Error('WebTransportConnectionManager is closed');
    if (slot.state === ConnectionState.CONNECTED && slot.transport) return slot;
    if (this.networkMonitor && !this.networkMonitor.isOnline) {
      throw new Error('Cannot connect WebTransport slot: Network is offline');
    }
    if (slot.connectPromise) return slot.connectPromise;

    slot.state = ConnectionState.CONNECTING;
    const abortController = new AbortController();
    slot.connectAbortController = abortController;

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
        // Prevent unhandled rejection if timeout/close settles before ready
        if (localTransport.ready && typeof localTransport.ready.catch === 'function') {
          localTransport.ready.catch(() => {});
        }

        // Strict connect timeout (default 10s to tolerate high-RTT / lossy UDP handshakes)
        const connectTimeoutMs = options.connectTimeoutMs || 10000;
        const timeoutPromise = new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`WebTransport pool #${slot.id + 1} timed out after ${connectTimeoutMs}ms`)), connectTimeoutMs);
        });

        await Promise.race([localTransport.ready, timeoutPromise]);
        if (timer) clearTimeout(timer);

        if (abortController.signal.aborted) {
          try { localTransport.close(); } catch (e) {}
          throw new Error('Connection aborted by resetSession');
        }

        slot.transport = localTransport;
        slot.state = ConnectionState.CONNECTED;
        slot.consecutiveFailures = 0;
        slot.lastActivityAt = Date.now();
        this.consecutiveQuicConnectFailures = 0;
        this._ensureKeepaliveLoop();

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
        slot.connectAbortController = null;
      }
    })();

    return slot.connectPromise;
  }

  /**
   * Establish WebTransport connection pool adaptively (baseWarmSlots by default, staggered to avoid UDP bursts).
   */
  async connect(options = {}) {
    if (this.isClosed) throw new Error('WebTransportConnectionManager is closed');
    if (this.networkMonitor && !this.networkMonitor.isOnline) {
      if (!this.isConnected()) {
        this._setState(ConnectionState.DISCONNECTED, 'Network is offline');
      } else {
        this._updateAggregateState();
      }
      throw new Error('Cannot connect WebTransport pool: Network is offline');
    }
    if (this.transportMode === 'websocket' && this.enableWsFallback) {
      const wsMgr = this._getOrCreateWsManager();
      await wsMgr.connect(options);
      this._ensureQuicRecoveryLoop();
      this._updateAggregateState();
      // Opportunistically probe QUIC recovery in background without delaying TCP fallback
      this._probeQuicRecovery().catch(() => {});
      return this;
    }

    const targetCount = options.connectAll ? this.slots.length : Math.min(this.baseWarmSlots, this.slots.length);
    if (!this.isConnected()) {
      this._setState(ConnectionState.CONNECTING, `Connecting WebTransport pool (${targetCount}/${this.poolSize} warm sessions)...`);
    }

    const slotsToConnect = this.slots.slice(0, targetCount);
    const staggerMs = options.staggerMs !== undefined ? options.staggerMs : 200;
    const connectPromises = slotsToConnect.map((slot, idx) => (async () => {
      if (idx > 0 && staggerMs > 0 && slot.state === ConnectionState.DISCONNECTED && !slot.connectPromise) {
        await new Promise(r => setTimeout(r, idx * staggerMs));
      }
      return this._connectSlot(slot, options);
    })());

    const results = await Promise.allSettled(connectPromises);
    const connectedCount = this.slots.filter(s => s.state === ConnectionState.CONNECTED && s.transport !== null).length;

    if (connectedCount === 0) {
      const rejectedCount = results.filter(r => r.status === 'rejected').length;
      this.consecutiveQuicConnectFailures += Math.max(1, rejectedCount);
      const firstError = results.find(r => r.status === 'rejected')?.reason;

      if (this.enableWsFallback && this.consecutiveQuicConnectFailures >= this.wsFallbackFailureThreshold) {
        try {
          await this._activateWsFallback(firstError?.message || 'QUIC pool connect failed', options);
          return this;
        } catch (wsErr) {
          this._log('warning', `WebSocket TCP fallback also failed: ${wsErr.message}`);
        }
      }

      this._setState(ConnectionState.DISCONNECTED, `All ${targetCount} pool connections failed`);
      throw firstError || new Error(`Failed to connect WebTransport pool (${targetCount} sessions)`);
    }

    this.consecutiveQuicConnectFailures = 0;
    this._updateAggregateState();
    return this;
  }

  /**
   * Race / fallback across up to 2 pool slots (rotating round-robin) so a single
   * stalled slot never blocks all waiting proxy requests on pool #1.
   */
  async _connectAnySlot(options = {}) {
    if (this.slots.length <= 1) {
      await this.connect(options);
      return;
    }

    const raceWidth = Math.min(options.raceWidth || 2, this.slots.length);
    const candidates = [];

    // 1. Reuse any slots that are already connecting in flight
    for (const slot of this.slots) {
      if (slot.connectPromise) {
        candidates.push(slot);
      }
    }

    // 2. Fill remaining race slots round-robin across disconnected slots
    if (candidates.length < raceWidth) {
      const startIdx = this._nextConnectSlotIdx % this.slots.length;
      let started = 0;
      for (let offset = 0; offset < this.slots.length && candidates.length < raceWidth; offset++) {
        const idx = (startIdx + offset) % this.slots.length;
        const slot = this.slots[idx];
        if (slot.state === ConnectionState.DISCONNECTED && !slot.connectPromise) {
          candidates.push(slot);
          started++;
        }
      }
      if (started > 0) {
        this._nextConnectSlotIdx = (startIdx + started) % this.slots.length;
      }
    }

    if (candidates.length === 0) {
      return;
    }

    const racePromises = candidates.map((slot) => {
      const p = this._connectSlot(slot, options);
      // Losing/background slot failures must not surface as unhandled rejections
      p.catch(() => {});
      return p;
    });

    try {
      await Promise.any(racePromises);
    } catch (aggErr) {
      const errors = (aggErr && Array.isArray(aggErr.errors)) ? aggErr.errors : [aggErr];
      const firstErr = errors.find(Boolean) || new Error('Failed to connect any WebTransport pool slot');
      throw firstErr;
    }

    this._updateAggregateState();
  }

  /**
   * Create an on-demand bidirectional stream session.
   * Dispatches request to the least-loaded active WebTransport connection in the pool.
   */
  async createSession(options = {}) {
    if (this.isClosed) throw new Error('WebTransportConnectionManager is closed');

    // If running in WebSocket TCP fallback mode, serve directly via WS pool
    if (this.transportMode === 'websocket' && this.enableWsFallback) {
      const wsMgr = this._getOrCreateWsManager();
      return wsMgr.createSession(options);
    }

    // 1. Find all active connected slots (never disrupt or reject already-working QUIC sessions)
    let connectedSlots = this.slots.filter(s => s.state === ConnectionState.CONNECTED && s.transport !== null);

    // 2. If no slots are connected, only attempt new QUIC connect/retry when network is online
    if (connectedSlots.length === 0) {
      if (this.networkMonitor && !this.networkMonitor.isOnline) {
        throw new Error('Cannot create WebTransport stream: Network is offline');
      }
      try {
        await this._connectAnySlot(options);
        this.consecutiveQuicConnectFailures = 0;
      } catch (quicErr) {
        this.consecutiveQuicConnectFailures++;
        if (this.enableWsFallback && this.consecutiveQuicConnectFailures >= this.wsFallbackFailureThreshold) {
          try {
            const wsMgr = await this._activateWsFallback(quicErr?.message || 'QUIC connect failed', options);
            return wsMgr.createSession(options);
          } catch (wsErr) {
            this._log('warning', `WebSocket TCP fallback also failed: ${wsErr.message}`);
          }
        }
        throw quicErr;
      }
      connectedSlots = this.slots.filter(s => s.state === ConnectionState.CONNECTED && s.transport !== null);
    }

    if (connectedSlots.length === 0) {
      throw new Error('No active WebTransport connections available in pool');
    }

    // 3. Adaptive, staggered background warming only when online (pause QUIC retries while offline)
    if (!this.networkMonitor || this.networkMonitor.isOnline) {
      let totalActiveStreams = 0;
      let aliveOrConnecting = 0;
      for (const s of this.slots) {
        totalActiveStreams += s.activeStreams.size;
        if ((s.state === ConnectionState.CONNECTED && s.transport !== null) || s.connectPromise) {
          aliveOrConnecting++;
        }
      }
      const desiredSlots = Math.min(
        this.poolSize,
        Math.max(this.baseWarmSlots, Math.ceil((totalActiveStreams + 1) / this.scaleUpStreamsPerSlot))
      );
      const now = Date.now();
      if (aliveOrConnecting < desiredSlots && (now - this._lastBackgroundWarmAt) >= this.warmStaggerMs) {
        const startIdx = this._nextConnectSlotIdx % this.slots.length;
        for (let offset = 0; offset < this.slots.length; offset++) {
          const idx = (startIdx + offset) % this.slots.length;
          const slot = this.slots[idx];
          if (slot.state === ConnectionState.DISCONNECTED && !slot.connectPromise) {
            this._lastBackgroundWarmAt = now;
            this._nextConnectSlotIdx = (idx + 1) % this.slots.length;
            this._connectSlot(slot, options).catch(() => {});
            break;
          }
        }
      }
    }

    // 4. Health-scored slot selection (deprioritize excluded & failing slots, then least-loaded & lowest RTT)
    const excludeSlotIds = options.excludeSlotIds instanceof Set ? options.excludeSlotIds : null;
    connectedSlots.sort((a, b) => {
      const aExcl = excludeSlotIds && excludeSlotIds.has(a.id) ? 1 : 0;
      const bExcl = excludeSlotIds && excludeSlotIds.has(b.id) ? 1 : 0;
      if (aExcl !== bExcl) return aExcl - bExcl;
      if (a.consecutiveFailures !== b.consecutiveFailures) {
        return a.consecutiveFailures - b.consecutiveFailures;
      }
      if (a.activeStreams.size !== b.activeStreams.size) {
        return a.activeStreams.size - b.activeStreams.size;
      }
      if (a.ewmaDialMs > 0 && b.ewmaDialMs > 0 && a.ewmaDialMs !== b.ewmaDialMs) {
        return a.ewmaDialMs - b.ewmaDialMs;
      }
      return a.id - b.id;
    });
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
      const isFatal = err && (err.name === 'WebTransportError' || /closed|network|abort/i.test(err.message));
      if (isFatal && chosenSlot.transport) {
        chosenSlot.state = ConnectionState.DISCONNECTED;
        try { chosenSlot.transport.close(); } catch (e) {}
        chosenSlot.transport = null;
        chosenSlot.consecutiveFailures = 0;
        this._updateAggregateState();
      } else {
        this.reportSlotFailure(chosenSlot.id, 'stream_alloc_timeout');
      }
      throw err;
    } finally {
      if (streamTimer) clearTimeout(streamTimer);
    }

    const streamSession = new WtStreamSession({
      bidiStream,
      streamId,
      slotId: chosenSlot.id,
      onClose: () => {
        chosenSlot.activeStreams.delete(streamSession);
      },
      onLog: this.onLog
    });

    chosenSlot.activeStreams.add(streamSession);
    chosenSlot.totalStreamsServed++;
    const now = Date.now();
    chosenSlot.lastActivityAt = now;
    this.totalStreamsServed++;
    this.lastActivity = now;

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
        const resp = await fetch(url, { mode: 'cors', cache: 'no-store', signal: controller.signal });
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
    this._stopKeepaliveLoop();
    this._stopQuicRecoveryLoop();
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

    if (this.wsManager) {
      try { await this.wsManager.close(); } catch (e) {}
      this.wsManager = null;
    }
  }
}
