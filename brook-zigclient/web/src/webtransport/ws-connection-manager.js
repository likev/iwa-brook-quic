/**
 * Multiplexed WebSocket Fallback Connection Manager (TCP/TLS /brook-ws).
 * Provides transparent stream-multiplexed TCP fallback when UDP/QUIC is blocked or severely throttled.
 *
 * Binary Frame Wire Format (matches brook-quicserver.go/websocket.go):
 *   [1B frameType][4B streamId (uint32 BE)][payload...]
 *   0x01 = OPEN (client -> server, optional initial payload)
 *   0x02 = DATA (bidirectional stream payload)
 *   0x03 = FIN  (bidirectional graceful write-half close)
 *   0x04 = RST  (bidirectional stream abort/cancel)
 *   0x05 = PING (keepalive ping, streamId = 0)
 *   0x06 = PONG (keepalive pong, streamId = 0)
 */

export const WS_FRAME_OPEN = 0x01;
export const WS_FRAME_DATA = 0x02;
export const WS_FRAME_FIN  = 0x03;
export const WS_FRAME_RST  = 0x04;
export const WS_FRAME_PING = 0x05;
export const WS_FRAME_PONG = 0x06;

const WS_HEADER_LEN = 5;
const WS_MAX_CHUNK = 32 * 1024;
const WS_MAX_PENDING_BYTES = 4 * 1024 * 1024;
const WS_MAX_BUFFERED_AMOUNT = 2 * 1024 * 1024;

function encodeWsFrame(frameType, streamId, payload = null) {
  const payloadLen = payload ? payload.byteLength : 0;
  const frame = new Uint8Array(WS_HEADER_LEN + payloadLen);
  frame[0] = frameType;
  frame[1] = (streamId >>> 24) & 0xff;
  frame[2] = (streamId >>> 16) & 0xff;
  frame[3] = (streamId >>> 8) & 0xff;
  frame[4] = streamId & 0xff;
  if (payloadLen > 0) {
    frame.set(payload, WS_HEADER_LEN);
  }
  return frame;
}

export class WsStreamSession {
  constructor({ slot, streamId, onClose = null, onLog = null }) {
    this.slot = slot;
    this.streamId = streamId;
    this.slotId = `ws:${slot.id}`;
    this.transportType = 'websocket';
    this.onCloseCallback = onClose;
    this.onLog = onLog;

    this.streamHandlers = new Map();
    this._pendingChunks = [];
    this._pendingBytes = 0;
    this._opened = false;
    this._sentFin = false;
    this._remoteFin = false;
    this.isClosed = false;
    this.isConnected = true;
  }

  allocateStreamId() {
    return this.streamId;
  }

  registerStream(streamId, handlers) {
    this.streamHandlers.set(streamId, handlers);
    if (this._pendingChunks.length > 0) {
      const pending = this._pendingChunks;
      this._pendingChunks = [];
      this._pendingBytes = 0;
      for (const item of pending) {
        if (handlers.onData) handlers.onData(item.data, item.fin);
        if (item.fin && handlers.onClose) handlers.onClose();
      }
    }
  }

  unregisterStream(streamId) {
    this.streamHandlers.delete(streamId);
  }

  releaseStream(streamId) {
    this.unregisterStream(streamId);
  }

  async ensureConnected() {
    if (this.isClosed || !this.isConnected || !this.slot.ws || this.slot.ws.readyState !== 1) {
      throw new Error('WebSocket stream session is closed');
    }
  }

  async sendStreamData(streamId, data, fin = false) {
    if (this.isClosed) {
      throw new Error('Cannot send stream data: WebSocket stream is closed');
    }
    const ws = this.slot.ws;
    if (!ws || ws.readyState !== 1) {
      throw new Error('Cannot send stream data: WebSocket connection is not open');
    }

    const u8 = data ? (data instanceof Uint8Array ? data : new Uint8Array(data)) : new Uint8Array(0);

    // Wait briefly if WebSocket send buffer is saturated
    if (ws.bufferedAmount > WS_MAX_BUFFERED_AMOUNT) {
      const deadline = Date.now() + 15000;
      while (!this.isClosed && ws.readyState === 1 && ws.bufferedAmount > WS_MAX_BUFFERED_AMOUNT) {
        if (Date.now() > deadline) {
          throw new Error('WebSocket stream write timed out after 15s (backpressure)');
        }
        await new Promise(r => setTimeout(r, 10));
      }
      if (this.isClosed || ws.readyState !== 1) {
        throw new Error('WebSocket closed during write backpressure');
      }
    }

    if (u8.length > 0) {
      for (let offset = 0; offset < u8.length; offset += WS_MAX_CHUNK) {
        const end = Math.min(offset + WS_MAX_CHUNK, u8.length);
        const slice = u8.subarray(offset, end);
        const frameType = !this._opened ? WS_FRAME_OPEN : WS_FRAME_DATA;
        this._opened = true;
        ws.send(encodeWsFrame(frameType, this.streamId, slice));
      }
    } else if (!this._opened && !fin) {
      this._opened = true;
      ws.send(encodeWsFrame(WS_FRAME_OPEN, this.streamId));
    }

    if (fin && !this._sentFin) {
      if (!this._opened) {
        this._opened = true;
        ws.send(encodeWsFrame(WS_FRAME_OPEN, this.streamId));
      }
      this._sentFin = true;
      ws.send(encodeWsFrame(WS_FRAME_FIN, this.streamId));
    }
  }

  _deliverData(data, fin = false) {
    if (this.isClosed) return;
    if (fin) {
      this._remoteFin = true;
    }
    const handler = this.streamHandlers.get(this.streamId);
    if (handler) {
      if (handler.onData) handler.onData(data, fin);
      if (fin && handler.onClose) handler.onClose();
    } else {
      if (this._pendingBytes + data.length > WS_MAX_PENDING_BYTES) {
        if (this.onLog) {
          try { this.onLog('error', `WS stream ${this.streamId} pending buffer overflow. Closing stream.`); } catch (e) {}
        }
        this.close();
        return;
      }
      this._pendingChunks.push({ data, fin });
      this._pendingBytes += data.length;
    }
    if (fin) {
      this._finalizeLocal();
    }
  }

  _deliverReset(err) {
    if (this.isClosed) return;
    const handler = this.streamHandlers.get(this.streamId);
    if (handler && handler.onError) {
      try { handler.onError(err || new Error('Received RESET_STREAM')); } catch (e) {}
    }
    this._finalizeLocal();
  }

  _finalizeLocal() {
    if (this.isClosed) return;
    this.isClosed = true;
    this.isConnected = false;

    for (const handler of this.streamHandlers.values()) {
      if (handler.onClose) {
        try { handler.onClose(); } catch (e) {}
      }
    }
    this.streamHandlers.clear();
    this._pendingChunks = [];
    this._pendingBytes = 0;

    if (this.onCloseCallback) {
      try { this.onCloseCallback(); } catch (e) {}
      this.onCloseCallback = null;
    }
  }

  close() {
    if (this.isClosed) return;
    const ws = this.slot.ws;
    if (ws && ws.readyState === 1 && this._opened) {
      try {
        if (!this._sentFin && this._remoteFin) {
          this._sentFin = true;
          ws.send(encodeWsFrame(WS_FRAME_FIN, this.streamId));
        } else if (!this._remoteFin) {
          ws.send(encodeWsFrame(WS_FRAME_RST, this.streamId));
        }
      } catch (e) {}
    }
    this._finalizeLocal();
  }
}

export class WebSocketConnectionManager {
  constructor({
    serverHost,
    serverPort,
    path = '/brook-ws',
    poolSize = 2,
    connectTimeoutMs = 10000,
    keepaliveIntervalMs = 20000,
    keepaliveIdleThresholdMs = 15000,
    zombieFailureThreshold = 2,
    networkMonitor = null,
    WebSocketClass = null,
    onStateChange = null,
    onLog = null
  }) {
    this.serverHost = serverHost;
    this.serverPort = serverPort;
    this.path = path.startsWith('/') ? path : `/${path}`;
    this.poolSize = Math.max(1, poolSize || 2);
    this.connectTimeoutMs = connectTimeoutMs || 10000;
    this.keepaliveIntervalMs = Math.max(0, keepaliveIntervalMs ?? 20000);
    this.keepaliveIdleThresholdMs = Math.max(1000, keepaliveIdleThresholdMs ?? 15000);
    this.zombieFailureThreshold = Math.max(1, zombieFailureThreshold || 2);
    this.networkMonitor = networkMonitor;
    this.WebSocketClass = WebSocketClass;
    this.onStateChange = onStateChange;
    this.onLog = onLog;

    this.isClosed = false;
    this.totalStreamsServed = 0;
    this.lastActivity = Date.now();
    this.lastDataActivityAt = 0;
    this._keepaliveTimer = null;
    this._drainCloseRequested = false;

    this.slots = Array.from({ length: this.poolSize }, (_, index) => ({
      id: index,
      ws: null,
      state: 'disconnected',
      connectPromise: null,
      streams: new Map(), // streamId -> WsStreamSession
      totalStreamsServed: 0,
      nextStreamSeq: index + 1,
      consecutiveFailures: 0,
      ewmaDialMs: 0,
      lastSuccessAt: 0,
      lastFailedAt: 0,
      lastActivityAt: 0,
      lastPongAt: 0
    }));
  }

  get serverUrl() {
    return `wss://${this.serverHost}:${this.serverPort}${this.path}`;
  }

  _getWebSocketClass() {
    if (this.WebSocketClass) return this.WebSocketClass;
    if (typeof window !== 'undefined' && typeof window.WebSocket !== 'undefined') {
      return window.WebSocket;
    }
    if (typeof globalThis !== 'undefined' && typeof globalThis.WebSocket !== 'undefined') {
      return globalThis.WebSocket;
    }
    throw new Error('WebSocket is not supported in this environment');
  }

  _log(level, message, meta = null) {
    if (this.onLog) {
      this.onLog(level, message, meta);
    }
  }

  get activeStreams() {
    const combined = new Set();
    for (const slot of this.slots) {
      for (const st of slot.streams.values()) {
        combined.add(st);
      }
    }
    return combined;
  }

  isConnected() {
    return this.slots.some(s => s.state === 'connected' && s.ws && s.ws.readyState === 1);
  }

  getConnectedSlotCount() {
    return this.slots.filter(s => s.state === 'connected' && s.ws && s.ws.readyState === 1).length;
  }

  hasRecentActivity(windowMs = 10000) {
    return this.isConnected() && this.lastDataActivityAt > 0 && (Date.now() - this.lastDataActivityAt) < windowMs;
  }

  _parseSlotId(slotId) {
    if (typeof slotId === 'string' && slotId.startsWith('ws:')) {
      const idx = parseInt(slotId.slice(3), 10);
      return Number.isNaN(idx) ? null : idx;
    }
    if (typeof slotId === 'number') return slotId;
    return null;
  }

  markActivity(slotId = null) {
    const now = Date.now();
    this.lastActivity = now;
    this.lastDataActivityAt = now;
    const idx = this._parseSlotId(slotId);
    if (idx !== null && this.slots[idx]) {
      this.slots[idx].lastActivityAt = now;
    }
  }

  reportSlotSuccess(slotId, dialMs = 0) {
    const now = Date.now();
    this.lastActivity = now;
    this.lastDataActivityAt = now;
    const idx = this._parseSlotId(slotId);
    const slot = idx !== null ? this.slots[idx] : null;
    if (!slot) return;
    slot.consecutiveFailures = 0;
    slot.lastSuccessAt = now;
    slot.lastActivityAt = now;
    if (dialMs > 0) {
      slot.ewmaDialMs = slot.ewmaDialMs > 0 ? Math.round(slot.ewmaDialMs * 0.7 + dialMs * 0.3) : Math.round(dialMs);
    }
  }

  reportSlotFailure(slotId, reason = 'handshake_failed') {
    const idx = this._parseSlotId(slotId);
    const slot = idx !== null ? this.slots[idx] : null;
    if (!slot) return;
    slot.consecutiveFailures++;
    slot.lastFailedAt = Date.now();

    if (slot.consecutiveFailures >= this.zombieFailureThreshold && slot.ws) {
      const deadWs = slot.ws;
      slot.ws = null;
      slot.state = 'disconnected';
      slot.consecutiveFailures = 0;
      for (const st of Array.from(slot.streams.values())) {
        st._deliverReset(new Error(`WebSocket slot evicted (${reason})`));
      }
      slot.streams.clear();
      try { deadWs.close(); } catch (e) {}
      this._log('warning', `🧹 Evicted unhealthy WebSocket fallback session #${slot.id + 1} (${reason})`);
      if (this.onStateChange) this.onStateChange();
    }
  }

  _ensureKeepaliveLoop() {
    if (this._keepaliveTimer || this.keepaliveIntervalMs <= 0 || this.isClosed) return;
    this._keepaliveTimer = setInterval(() => {
      this._runKeepaliveTick();
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

  _runKeepaliveTick() {
    if (this.isClosed) {
      this._stopKeepaliveLoop();
      return;
    }
    if (this.networkMonitor && !this.networkMonitor.isOnline) return;

    const now = Date.now();
    for (const slot of this.slots) {
      if (slot.state === 'connected' && slot.ws && slot.ws.readyState === 1) {
        if (now - slot.lastActivityAt >= this.keepaliveIdleThresholdMs) {
          try {
            slot.ws.send(encodeWsFrame(WS_FRAME_PING, 0));
            slot.lastActivityAt = now;
          } catch (err) {
            this.reportSlotFailure(slot.id, `ws_keepalive_failed: ${err.message || err}`);
          }
        }
      }
    }
  }

  async _connectSlot(slot, options = {}) {
    if (this.isClosed) throw new Error('WebSocketConnectionManager is closed');
    if (slot.state === 'connected' && slot.ws && slot.ws.readyState === 1) return slot;
    if (this.networkMonitor && !this.networkMonitor.isOnline) {
      throw new Error('Cannot connect WebSocket slot: Network is offline');
    }
    if (slot.connectPromise) return slot.connectPromise;

    this._drainCloseRequested = false;
    slot.state = 'connecting';
    const WSClass = this._getWebSocketClass();
    const url = this.serverUrl;
    const timeoutMs = options.connectTimeoutMs || this.connectTimeoutMs;

    slot.connectPromise = new Promise((resolve, reject) => {
      this._log('info', `Connecting WebSocket fallback session #${slot.id + 1}/${this.poolSize} to ${url}...`);
      let ws = null;
      let settled = false;
      let timer = null;

      const fail = (err) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        slot.connectPromise = null;
        if (slot.ws === ws) slot.ws = null;
        slot.state = 'disconnected';
        if (ws) {
          try { ws.close(); } catch (e) {}
        }
        if (this.onStateChange) this.onStateChange();
        reject(err);
      };

      try {
        ws = new WSClass(url);
        ws.binaryType = 'arraybuffer';
      } catch (err) {
        fail(err);
        return;
      }

      timer = setTimeout(() => {
        fail(new Error(`WebSocket fallback #${slot.id + 1} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      ws.onopen = () => {
        if (settled) {
          try { ws.close(); } catch (e) {}
          return;
        }
        if (this.isClosed) {
          fail(new Error('WebSocketConnectionManager is closed'));
          return;
        }
        settled = true;
        if (timer) clearTimeout(timer);
        slot.connectPromise = null;
        slot.ws = ws;
        slot.state = 'connected';
        slot.consecutiveFailures = 0;
        slot.lastActivityAt = Date.now();
        this._ensureKeepaliveLoop();
        this._log('success', `✅ WebSocket TCP fallback session #${slot.id + 1}/${this.poolSize} established`);
        if (this.onStateChange) this.onStateChange();
        resolve(slot);
      };

      ws.onmessage = (event) => {
        const now = Date.now();
        slot.lastActivityAt = now;
        this.lastActivity = now;

        let buf = null;
        if (event.data instanceof ArrayBuffer) {
          buf = new Uint8Array(event.data);
        } else if (ArrayBuffer.isView(event.data)) {
          buf = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength);
        } else {
          return;
        }
        if (buf.length < WS_HEADER_LEN) return;

        const frameType = buf[0];
        const streamId = ((buf[1] << 24) | (buf[2] << 16) | (buf[3] << 8) | buf[4]) >>> 0;
        const payload = buf.length > WS_HEADER_LEN ? buf.slice(WS_HEADER_LEN) : new Uint8Array(0);

        if (frameType === WS_FRAME_PONG) {
          slot.lastPongAt = now;
          return;
        }
        if (frameType === WS_FRAME_PING) {
          try {
            if (ws.readyState === 1) ws.send(encodeWsFrame(WS_FRAME_PONG, 0));
          } catch (e) {}
          return;
        }

        const st = slot.streams.get(streamId);
        if (!st) return;

        if (frameType === WS_FRAME_DATA) {
          this.lastDataActivityAt = now;
          st._deliverData(payload, false);
        } else if (frameType === WS_FRAME_FIN) {
          st._deliverData(new Uint8Array(0), true);
        } else if (frameType === WS_FRAME_RST) {
          st._deliverReset(new Error('Received RESET_STREAM'));
        }
      };

      ws.onerror = () => {
        if (!settled) {
          fail(new Error(`WebSocket fallback #${slot.id + 1} connection error`));
        }
      };

      ws.onclose = () => {
        if (!settled) {
          fail(new Error(`WebSocket fallback #${slot.id + 1} closed before open`));
          return;
        }
        if (slot.ws === ws) {
          slot.ws = null;
          slot.state = 'disconnected';
          for (const st of Array.from(slot.streams.values())) {
            st._deliverReset(new Error('WebSocket connection closed'));
          }
          slot.streams.clear();
          if (!this.isClosed && !this._drainCloseRequested) {
            this._log('warning', `WebSocket fallback session #${slot.id + 1} closed`);
          }
          if (this.onStateChange) this.onStateChange();
        }
      };
    });

    return slot.connectPromise;
  }

  async connect(options = {}) {
    if (this.isClosed) throw new Error('WebSocketConnectionManager is closed');
    if (this.networkMonitor && !this.networkMonitor.isOnline) {
      throw new Error('Cannot connect WebSocket fallback pool: Network is offline');
    }
    const staggerMs = options.staggerMs !== undefined ? options.staggerMs : 150;
    const promises = this.slots.map((slot, idx) => (async () => {
      if (idx > 0 && staggerMs > 0 && slot.state === 'disconnected' && !slot.connectPromise) {
        await new Promise(r => setTimeout(r, idx * staggerMs));
      }
      return this._connectSlot(slot, options);
    })());

    const results = await Promise.allSettled(promises);
    if (!this.isConnected()) {
      const firstError = results.find(r => r.status === 'rejected')?.reason;
      throw firstError || new Error('Failed to connect WebSocket fallback pool');
    }
    return this;
  }

  async createSession(options = {}) {
    if (this.isClosed) throw new Error('WebSocketConnectionManager is closed');

    let connectedSlots = this.slots.filter(s => s.state === 'connected' && s.ws && s.ws.readyState === 1);
    if (connectedSlots.length === 0) {
      if (this.networkMonitor && !this.networkMonitor.isOnline) {
        throw new Error('Cannot create WebSocket stream: Network is offline');
      }
      await this.connect(options);
      connectedSlots = this.slots.filter(s => s.state === 'connected' && s.ws && s.ws.readyState === 1);
    }

    if (connectedSlots.length === 0) {
      throw new Error('No active WebSocket fallback connections available');
    }

    // Background-warm any disconnected fallback slot when online
    if (!this.networkMonitor || this.networkMonitor.isOnline) {
      for (const slot of this.slots) {
        if (slot.state === 'disconnected' && !slot.connectPromise) {
          this._connectSlot(slot, options).catch(() => {});
          break;
        }
      }
    }

    const excludeSlotIds = options.excludeSlotIds instanceof Set ? options.excludeSlotIds : null;
    connectedSlots.sort((a, b) => {
      const aExcl = excludeSlotIds && excludeSlotIds.has(`ws:${a.id}`) ? 1 : 0;
      const bExcl = excludeSlotIds && excludeSlotIds.has(`ws:${b.id}`) ? 1 : 0;
      if (aExcl !== bExcl) return aExcl - bExcl;
      if (a.consecutiveFailures !== b.consecutiveFailures) return a.consecutiveFailures - b.consecutiveFailures;
      if (a.streams.size !== b.streams.size) return a.streams.size - b.streams.size;
      if (a.ewmaDialMs > 0 && b.ewmaDialMs > 0 && a.ewmaDialMs !== b.ewmaDialMs) return a.ewmaDialMs - b.ewmaDialMs;
      return a.id - b.id;
    });
    const chosenSlot = connectedSlots[0];

    const streamId = (chosenSlot.nextStreamSeq += this.poolSize) >>> 0;
    const streamSession = new WsStreamSession({
      slot: chosenSlot,
      streamId,
      onClose: () => {
        chosenSlot.streams.delete(streamId);
        if (this._drainCloseRequested && this.activeStreams.size === 0) {
          this.resetSession('quic_recovered');
        }
      },
      onLog: this.onLog
    });

    chosenSlot.streams.set(streamId, streamSession);
    chosenSlot.totalStreamsServed++;
    const now = Date.now();
    chosenSlot.lastActivityAt = now;
    this.totalStreamsServed++;
    this.lastActivity = now;

    return streamSession;
  }

  /**
   * Close idle WebSocket slots once all in-flight streams finish (used when QUIC recovers).
   */
  drainAndClose() {
    this._drainCloseRequested = true;
    this._stopKeepaliveLoop();
    if (this.activeStreams.size === 0) {
      this.resetSession('quic_recovered');
    }
  }

  resetSession(reason = 'reset') {
    this._stopKeepaliveLoop();
    for (const slot of this.slots) {
      slot.connectPromise = null;
      for (const st of Array.from(slot.streams.values())) {
        st._deliverReset(new Error(`WebSocket reset (${reason})`));
      }
      slot.streams.clear();
      if (slot.ws) {
        try { slot.ws.close(); } catch (e) {}
        slot.ws = null;
      }
      slot.state = 'disconnected';
      slot.consecutiveFailures = 0;
    }
  }

  async close() {
    this.isClosed = true;
    this.resetSession('closed');
  }
}
