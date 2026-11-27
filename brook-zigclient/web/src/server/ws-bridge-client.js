/**
 * Local WebSocket TCP Bridge Client (runs inside Proxy Engine Web Worker).
 * Communicates with the Zig host process over ws://127.0.0.1:<port>/ws?token=<hex>.
 *
 * Binary Frame Protocol: [1B type][4B connId BE][payload...]
 *   0x01 ACCEPT (Zig -> Worker): [1B listenerIdLen][listenerId][1B addrLen][addr][2B port BE]
 *   0x02 DATA   (Bidirectional): raw TCP stream bytes
 *   0x03 FIN    (Bidirectional): graceful half-close (write side closed)
 *   0x04 RST    (Bidirectional): immediate close / abort
 *   0x05 WINDOW (Worker -> Zig): [4B creditDelta BE] flow-control credit replenish
 *
 * Text Frame Protocol (JSON):
 *   Worker -> Zig: listen, unlisten, ping
 *   Zig -> Worker: ready, listening, listen_error, unlistened, pong, log
 */

export const BRIDGE_FRAME_ACCEPT = 0x01;
export const BRIDGE_FRAME_DATA   = 0x02;
export const BRIDGE_FRAME_FIN    = 0x03;
export const BRIDGE_FRAME_RST    = 0x04;
export const BRIDGE_FRAME_WINDOW = 0x05;

const HEADER_LEN = 5;
const MAX_WS_CHUNK = 32 * 1024;
const MAX_RX_QUEUE_BYTES = 4 * 1024 * 1024;
const WINDOW_ACK_THRESHOLD = 256 * 1024;
const WS_MAX_BUFFERED_AMOUNT = 4 * 1024 * 1024;

function encodeBinaryFrame(type, connId, payload = null) {
  const payloadLen = payload ? payload.byteLength : 0;
  const buf = new Uint8Array(HEADER_LEN + payloadLen);
  buf[0] = type;
  buf[1] = (connId >>> 24) & 0xff;
  buf[2] = (connId >>> 16) & 0xff;
  buf[3] = (connId >>> 8) & 0xff;
  buf[4] = connId & 0xff;
  if (payloadLen > 0) {
    buf.set(payload, HEADER_LEN);
  }
  return buf;
}

function encodeWindowFrame(connId, delta) {
  const payload = new Uint8Array(4);
  payload[0] = (delta >>> 24) & 0xff;
  payload[1] = (delta >>> 16) & 0xff;
  payload[2] = (delta >>> 8) & 0xff;
  payload[3] = delta & 0xff;
  return encodeBinaryFrame(BRIDGE_FRAME_WINDOW, connId, payload);
}

/**
 * Direct Sockets TCPSocket-compatible accepted socket backed by the Zig WS bridge.
 */
export class WsAcceptedSocket {
  constructor({ connId, listenerId, remoteAddress, remotePort, bridge }) {
    this.connId = connId;
    this.listenerId = listenerId;
    this.remoteAddress = remoteAddress || '127.0.0.1';
    this.remotePort = remotePort || 0;
    this.bridge = bridge;

    this._rxQueue = [];
    this._rxQueueBytes = 0;
    this._unackedBytes = 0;
    this._remoteFin = false;
    this._closed = false;
    this._sentFin = false;
    this._sentRst = false;
    this._readController = null;
    this._pullRequested = false;

    const self = this;

    this.readable = new ReadableStream({
      start(controller) {
        self._readController = controller;
      },
      pull(controller) {
        self._pullRequested = true;
        self._drainRxQueue(controller);
      },
      cancel() {
        self._rxQueue.length = 0;
        self._rxQueueBytes = 0;
        self._sendRstOnce();
        self._markClosed();
      }
    });

    this.writable = new WritableStream({
      async write(chunk) {
        if (self._closed || self._sentFin || self._sentRst) {
          throw new Error('TCP bridge socket is closed');
        }
        const u8 = chunk instanceof Uint8Array
          ? chunk
          : (chunk instanceof ArrayBuffer ? new Uint8Array(chunk) : new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
        if (u8.byteLength === 0) return;

        for (let offset = 0; offset < u8.byteLength; offset += MAX_WS_CHUNK) {
          if (self._closed || self._sentFin || self._sentRst) {
            throw new Error('TCP bridge socket closed during write');
          }
          const end = Math.min(offset + MAX_WS_CHUNK, u8.byteLength);
          await self.bridge.sendData(self.connId, u8.subarray(offset, end));
        }
      },
      close() {
        self._sendFinOnce();
        if (self._remoteFin) {
          self._markClosed();
        }
      },
      abort() {
        self._sendRstOnce();
        self._markClosed();
      }
    });

    this.opened = Promise.resolve({
      readable: this.readable,
      writable: this.writable,
      remoteAddress: this.remoteAddress,
      remotePort: this.remotePort
    });
  }

  _drainRxQueue(controller) {
    if (!controller) return;
    while (this._rxQueue.length > 0 && this._pullRequested) {
      const chunk = this._rxQueue.shift();
      this._rxQueueBytes = Math.max(0, this._rxQueueBytes - chunk.byteLength);
      this._unackedBytes += chunk.byteLength;
      this._pullRequested = false;
      try {
        controller.enqueue(chunk);
      } catch (e) {
        return;
      }
      if (this._unackedBytes >= WINDOW_ACK_THRESHOLD) {
        const delta = this._unackedBytes;
        this._unackedBytes = 0;
        this.bridge.sendWindow(this.connId, delta);
      }
      if ((controller.desiredSize ?? 0) > 0) {
        this._pullRequested = true;
      }
    }

    if (this._rxQueue.length === 0 && this._remoteFin) {
      try {
        controller.close();
      } catch (e) {}
      if (this._sentFin || this._sentRst) {
        this._markClosed();
      }
    }
  }

  onRemoteData(chunk) {
    if (this._closed || this._remoteFin) return;
    if (!chunk || chunk.byteLength === 0) return;

    if (this._rxQueueBytes + chunk.byteLength > MAX_RX_QUEUE_BYTES) {
      this._sendRstOnce();
      this.onRemoteRst('Local TCP bridge receive buffer overflow');
      return;
    }

    if (this._readController && this._pullRequested && this._rxQueue.length === 0) {
      this._pullRequested = false;
      this._unackedBytes += chunk.byteLength;
      try {
        this._readController.enqueue(chunk);
      } catch (e) {
        return;
      }
      if (this._unackedBytes >= WINDOW_ACK_THRESHOLD) {
        const delta = this._unackedBytes;
        this._unackedBytes = 0;
        this.bridge.sendWindow(this.connId, delta);
      }
      if ((this._readController.desiredSize ?? 0) > 0) {
        this._pullRequested = true;
      }
    } else {
      this._rxQueue.push(chunk);
      this._rxQueueBytes += chunk.byteLength;
    }
  }

  onRemoteFin() {
    if (this._remoteFin) return;
    this._remoteFin = true;
    if (this._rxQueue.length === 0 && this._readController) {
      try {
        this._readController.close();
      } catch (e) {}
      if (this._sentFin || this._sentRst) {
        this._markClosed();
      }
    }
  }

  onRemoteRst(reason = 'Peer reset local TCP connection') {
    if (this._closed) return;
    this._closed = true;
    this._remoteFin = true;
    this._rxQueue.length = 0;
    this._rxQueueBytes = 0;
    if (this._readController) {
      try {
        this._readController.error(new Error(reason));
      } catch (e) {}
    }
    this.bridge._removeConnection(this.connId);
  }

  _sendFinOnce() {
    if (this._sentFin || this._sentRst) return;
    this._sentFin = true;
    this.bridge.sendFin(this.connId);
  }

  _sendRstOnce() {
    if (this._sentRst) return;
    this._sentRst = true;
    this.bridge.sendRst(this.connId);
  }

  _markClosed() {
    if (this._closed) return;
    this._closed = true;
    this._rxQueue.length = 0;
    this._rxQueueBytes = 0;
    this.bridge._removeConnection(this.connId);
  }

  async close() {
    if (!this._sentFin && !this._sentRst) {
      this._sendRstOnce();
    }
    if (!this._closed) {
      this._closed = true;
      this._rxQueue.length = 0;
      this._rxQueueBytes = 0;
      if (this._readController) {
        try {
          this._readController.close();
        } catch (e) {}
      }
      this.bridge._removeConnection(this.connId);
    }
  }
}

/**
 * Multiplexed WebSocket bridge client connecting the Worker to the Zig process.
 */
export class WsBridgeClient {
  constructor({ wsUrl, onLog = null, onStateChange = null, onReady = null }) {
    this.wsUrl = wsUrl;
    this.onLog = onLog;
    this.onStateChange = onStateChange;
    this.onReady = onReady;

    this.ws = null;
    this.isConnected = false;
    this.isClosed = false;
    this.listeners = new Map();       // listenerId -> { onAccept }
    this.connections = new Map();     // connId -> WsAcceptedSocket
    this.pendingControl = new Map();  // listenerId -> { resolve, reject, timer }
    this._pingTimer = null;
    this._reconnectTimer = null;
    this._connectPromise = null;
    this._textDecoder = new TextDecoder();
  }

  _log(level, msg) {
    if (this.onLog) this.onLog(level, msg);
  }

  _emitState(state, detail = '') {
    if (this.onStateChange) this.onStateChange(state, detail);
  }

  async connect(timeoutMs = 10000) {
    if (this.isClosed) throw new Error('WsBridgeClient is closed');
    if (this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN) {
      return;
    }
    if (this._connectPromise) return this._connectPromise;

    this._emitState('connecting', 'Connecting to Zig TCP bridge...');
    this._connectPromise = new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          this._connectPromise = null;
          try { if (ws) ws.close(); } catch (e) {}
          reject(new Error(`Timed out connecting to Zig WS bridge (${this.wsUrl})`));
        }
      }, timeoutMs);

      const ws = new WebSocket(this.wsUrl);
      ws.binaryType = 'arraybuffer';
      this.ws = ws;

      ws.onopen = () => {
        // Wait for the server's {"type":"ready"} message before resolving
      };

      ws.onmessage = (event) => {
        if (typeof event.data === 'string') {
          let msg = null;
          try {
            msg = JSON.parse(event.data);
          } catch (e) {
            return;
          }
          if (msg.type === 'ready') {
            this.isConnected = true;
            this._startPing();
            this._emitState('connected', `Zig bridge ready (HTTP :${msg.httpPort || '?'})`);
            if (this.onReady) this.onReady(msg);
            if (!settled) {
              settled = true;
              clearTimeout(timer);
              this._connectPromise = null;
              resolve(msg);
            }
          } else {
            this._handleControlMessage(msg);
          }
        } else if (event.data instanceof ArrayBuffer) {
          this._handleBinaryFrame(new Uint8Array(event.data));
        }
      };

      ws.onerror = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          this._connectPromise = null;
          reject(new Error('Failed to connect to local Zig WebSocket bridge'));
        }
      };

      ws.onclose = (ev) => {
        const wasConnected = this.isConnected;
        this.isConnected = false;
        this._stopPing();
        this._failAllPendingControl('Zig WebSocket bridge disconnected');
        this._resetAllConnections('Zig WebSocket bridge disconnected');

        if (!settled) {
          settled = true;
          clearTimeout(timer);
          this._connectPromise = null;
          reject(new Error(`Zig WS bridge closed before ready (code=${ev.code})`));
        }

        if (!this.isClosed) {
          if (wasConnected) {
            this._log('warning', `⚠️ Zig TCP bridge WebSocket disconnected (code=${ev.code}). Reconnecting...`);
          }
          this._emitState('reconnecting', 'Reconnecting to Zig bridge...');
          this._scheduleReconnect();
        }
      };
    });

    return this._connectPromise;
  }

  _scheduleReconnect() {
    if (this.isClosed || this._reconnectTimer) return;
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      if (this.isClosed || this.isConnected) return;
      this.connect().catch(() => {});
    }, 1500);
  }

  _startPing() {
    this._stopPing();
    this._pingTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify({ type: 'ping' }));
        } catch (e) {}
      }
    }, 15000);
  }

  _stopPing() {
    if (this._pingTimer) {
      clearInterval(this._pingTimer);
      this._pingTimer = null;
    }
  }

  _failAllPendingControl(reason) {
    for (const [key, pending] of this.pendingControl.entries()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
      this.pendingControl.delete(key);
    }
  }

  _resetAllConnections(reason) {
    for (const sock of Array.from(this.connections.values())) {
      sock.onRemoteRst(reason);
    }
    this.connections.clear();
  }

  _removeConnection(connId) {
    this.connections.delete(connId);
  }

  _handleControlMessage(msg) {
    switch (msg.type) {
      case 'listening': {
        const pending = this.pendingControl.get(`listen:${msg.id}`);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingControl.delete(`listen:${msg.id}`);
          pending.resolve({ host: msg.host || '127.0.0.1', port: msg.port });
        }
        break;
      }
      case 'listen_error': {
        const pending = this.pendingControl.get(`listen:${msg.id}`);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingControl.delete(`listen:${msg.id}`);
          pending.reject(new Error(msg.error || `Failed to bind listener ${msg.id}`));
        }
        break;
      }
      case 'unlistened': {
        const pending = this.pendingControl.get(`unlisten:${msg.id}`);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingControl.delete(`unlisten:${msg.id}`);
          pending.resolve();
        }
        break;
      }
      case 'log': {
        this._log(msg.level || 'info', `[Zig] ${msg.message || ''}`);
        break;
      }
      case 'pong':
      default:
        break;
    }
  }

  _handleBinaryFrame(frame) {
    if (frame.byteLength < HEADER_LEN) return;
    const frameType = frame[0];
    const connId = ((frame[1] << 24) >>> 0) | (frame[2] << 16) | (frame[3] << 8) | frame[4];
    const payload = frame.subarray(HEADER_LEN);

    switch (frameType) {
      case BRIDGE_FRAME_ACCEPT: {
        // [1B listenerIdLen][listenerId][1B addrLen][addr][2B port BE]
        if (payload.byteLength < 4) return;
        let off = 0;
        const idLen = payload[off++];
        if (off + idLen + 1 > payload.byteLength) return;
        const listenerId = this._textDecoder.decode(payload.subarray(off, off + idLen));
        off += idLen;
        const addrLen = payload[off++];
        if (off + addrLen + 2 > payload.byteLength) return;
        const remoteAddress = this._textDecoder.decode(payload.subarray(off, off + addrLen));
        off += addrLen;
        const remotePort = (payload[off] << 8) | payload[off + 1];

        const entry = this.listeners.get(listenerId);
        if (!entry) {
          this.sendRst(connId);
          return;
        }
        const socket = new WsAcceptedSocket({
          connId,
          listenerId,
          remoteAddress,
          remotePort,
          bridge: this
        });
        this.connections.set(connId, socket);
        entry.onAccept(socket);
        break;
      }
      case BRIDGE_FRAME_DATA: {
        const sock = this.connections.get(connId);
        if (sock) {
          // Copy payload so each enqueued chunk owns a compact standalone Uint8Array
          sock.onRemoteData(new Uint8Array(payload));
        } else {
          this.sendRst(connId);
        }
        break;
      }
      case BRIDGE_FRAME_FIN: {
        const sock = this.connections.get(connId);
        if (sock) sock.onRemoteFin();
        break;
      }
      case BRIDGE_FRAME_RST: {
        const sock = this.connections.get(connId);
        if (sock) sock.onRemoteRst('Local TCP client reset connection');
        break;
      }
      default:
        break;
    }
  }

  async listen({ id, host = '127.0.0.1', port = 0, onAccept }) {
    if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      await this.connect();
    }
    this.listeners.set(id, { onAccept });

    return new Promise((resolve, reject) => {
      const key = `listen:${id}`;
      const timer = setTimeout(() => {
        this.pendingControl.delete(key);
        this.listeners.delete(id);
        reject(new Error(`Timed out binding local TCP port ${port}`));
      }, 8000);

      this.pendingControl.set(key, { resolve, reject, timer });
      try {
        this.ws.send(JSON.stringify({ type: 'listen', id, host, port }));
      } catch (err) {
        clearTimeout(timer);
        this.pendingControl.delete(key);
        this.listeners.delete(id);
        reject(err);
      }
    });
  }

  async unlisten({ id, closeActive = true }) {
    this.listeners.delete(id);
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    return new Promise((resolve) => {
      const key = `unlisten:${id}`;
      const timer = setTimeout(() => {
        this.pendingControl.delete(key);
        resolve();
      }, 3000);

      this.pendingControl.set(key, {
        resolve,
        reject: () => resolve(),
        timer
      });

      try {
        this.ws.send(JSON.stringify({ type: 'unlisten', id, closeActive: Boolean(closeActive) }));
      } catch (e) {
        clearTimeout(timer);
        this.pendingControl.delete(key);
        resolve();
      }
    });
  }

  async sendData(connId, data) {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error('Zig WebSocket bridge is not connected');
    }

    // Apply backpressure if browser WS outbound buffer is saturated
    if (ws.bufferedAmount > WS_MAX_BUFFERED_AMOUNT) {
      const deadline = Date.now() + 15000;
      while (!this.isClosed && ws.readyState === WebSocket.OPEN && ws.bufferedAmount > WS_MAX_BUFFERED_AMOUNT) {
        if (Date.now() > deadline) {
          throw new Error('Local WS bridge write backpressure timeout');
        }
        await new Promise(r => setTimeout(r, 5));
      }
      if (this.isClosed || ws.readyState !== WebSocket.OPEN) {
        throw new Error('Zig WebSocket bridge closed during write');
      }
    }

    ws.send(encodeBinaryFrame(BRIDGE_FRAME_DATA, connId, data));
  }

  sendFin(connId) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(encodeBinaryFrame(BRIDGE_FRAME_FIN, connId));
      } catch (e) {}
    }
  }

  sendRst(connId) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(encodeBinaryFrame(BRIDGE_FRAME_RST, connId));
      } catch (e) {}
    }
  }

  sendWindow(connId, delta) {
    if (delta <= 0) return;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(encodeWindowFrame(connId, delta));
      } catch (e) {}
    }
  }

  close() {
    this.isClosed = true;
    this._stopPing();
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    this._failAllPendingControl('Bridge closed');
    this._resetAllConnections('Bridge closed');
    this.listeners.clear();
    if (this.ws) {
      try { this.ws.close(); } catch (e) {}
      this.ws = null;
    }
  }
}
