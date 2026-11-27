/**
 * Zig WebSocket TCP Listener Adapter.
 * Drop-in replacement for the IWA Direct Sockets TcpListener, allowing
 * ProxyDispatcher, Socks5Parser, HttpProxyParser, and BrookTunnel to run
 * completely unchanged inside a standard browser Web Worker.
 */

// Native OS sockets via Zig have no Chrome restricted port blocklist.
export const CHROME_RESTRICTED_PORTS = new Set();

let activeBridge = null;
let listenerSeq = 0;

export class TcpListener {
  static setBridge(bridge) {
    activeBridge = bridge;
  }

  static getBridge() {
    return activeBridge;
  }

  constructor({ localAddress = '127.0.0.1', localPort = 0, maxConnections = 512, onConnection, onError, onClose, onFallback }) {
    this.localAddress = localAddress || '127.0.0.1';
    this.localPort = localPort;
    this.maxConnections = maxConnections;
    this.onConnection = onConnection;
    this.onError = onError;
    this.onClose = onClose;
    this.onFallback = onFallback;

    this.listenerId = `tcp-${++listenerSeq}`;
    this.isListening = false;
    this.connectionsAccepted = 0;
    this.activeSockets = new Set();
  }

  async start() {
    const bridge = TcpListener.getBridge();
    if (!bridge) {
      throw new Error('Zig WebSocket TCP bridge is not initialized.');
    }

    const requestedPort = this.localPort;
    const onAccept = (acceptedSocket) => this._handleAccepted(acceptedSocket);

    try {
      const bound = await bridge.listen({
        id: this.listenerId,
        host: this.localAddress,
        port: requestedPort,
        onAccept
      });
      this.localAddress = bound.host || this.localAddress;
      this.localPort = bound.port;
      this.isListening = true;
      return;
    } catch (firstErr) {
      // If requested specific port failed (e.g. already in use), fall back to OS dynamic port 0
      if (requestedPort > 0) {
        try {
          const bound = await bridge.listen({
            id: this.listenerId,
            host: this.localAddress,
            port: 0,
            onAccept
          });
          this.localAddress = bound.host || this.localAddress;
          this.localPort = bound.port;
          this.isListening = true;
          if (this.onFallback) {
            this.onFallback(requestedPort, bound.port);
          }
          return;
        } catch (fallbackErr) {
          if (this.onError) this.onError(fallbackErr);
          throw fallbackErr;
        }
      }
      if (this.onError) this.onError(firstErr);
      throw firstErr;
    }
  }

  _handleAccepted(acceptedSocket) {
    if (!this.isListening) {
      try { acceptedSocket.close().catch(() => {}); } catch (e) {}
      return;
    }

    if (this.activeSockets.size >= this.maxConnections) {
      try { acceptedSocket.close().catch(() => {}); } catch (e) {}
      return;
    }

    this.activeSockets.add(acceptedSocket);
    this.connectionsAccepted++;

    const wrappedOnComplete = () => {
      this.activeSockets.delete(acceptedSocket);
    };

    if (this.onConnection) {
      try {
        this.onConnection(acceptedSocket, wrappedOnComplete);
      } catch (connErr) {
        wrappedOnComplete();
        if (this.onError) this.onError(connErr);
      }
    }
  }

  /**
   * Stop accepting new TCP connections without closing already-accepted sockets.
   */
  async stopListening() {
    return this.stop({ closeActiveSockets: false });
  }

  async stop({ closeActiveSockets = true } = {}) {
    if (!this.isListening && (!closeActiveSockets || this.activeSockets.size === 0)) return;
    const wasListening = this.isListening;
    this.isListening = false;

    const bridge = TcpListener.getBridge();
    if (bridge) {
      try {
        await bridge.unlisten({ id: this.listenerId, closeActive: closeActiveSockets });
      } catch (e) {}
    }

    if (closeActiveSockets) {
      const sockets = Array.from(this.activeSockets);
      this.activeSockets.clear();
      await Promise.allSettled(sockets.map(s => s.close().catch(() => {})));
    }

    if (wasListening && this.onClose) {
      this.onClose();
    }
  }
}
