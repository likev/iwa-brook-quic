/**
 * Direct Sockets TCPServerSocket Listener Wrapper.
 * Tracks active accepted sockets, enforces global connection limit,
 * and provides clean transactional start/stop semantics.
 */

// Ports restricted by Chromium's network security baseline (net/base/port_util.cc)
export const CHROME_RESTRICTED_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102,
  103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 139, 143, 179, 389, 465, 512, 513, 514,
  515, 526, 530, 531, 532, 540, 548, 556, 563, 587, 601, 636, 993, 995, 1080, 2049, 3659, 4045,
  6000, 6665, 6666, 6667, 6668, 6669, 6697
]);

export class TcpListener {
  constructor({ localAddress = '127.0.0.1', localPort = 0, maxConnections = 512, onConnection, onError, onClose, onFallback }) {
    this.localAddress = localAddress;
    this.localPort = localPort;
    this.maxConnections = maxConnections;
    this.onConnection = onConnection;
    this.onError = onError;
    this.onClose = onClose;
    this.onFallback = onFallback;

    this.serverSocket = null;
    this.serverReader = null;
    this.isListening = false;
    this.connectionsAccepted = 0;
    this.activeSockets = new Set();
  }

  async start() {
    if (typeof globalThis.TCPServerSocket === 'undefined') {
      throw new Error('Direct Sockets TCPServerSocket API is not available. Please run inside an Isolated Web App (IWA).');
    }

    const requestedPort = this.localPort;
    const bindAddresses = [];
    if (this.localAddress) bindAddresses.push(this.localAddress);
    if (!bindAddresses.includes('127.0.0.1')) bindAddresses.push('127.0.0.1');
    if (!bindAddresses.includes('::1')) bindAddresses.push('::1');
    if (!bindAddresses.includes('0.0.0.0')) bindAddresses.push('0.0.0.0');

    let lastError = null;

    // 1. Try binding with requested port if valid and not restricted
    if (requestedPort > 0 && !CHROME_RESTRICTED_PORTS.has(requestedPort) && requestedPort >= 1024) {
      for (const bindAddr of bindAddresses) {
        try {
          const options = { backlog: 100, localPort: requestedPort };
          this.serverSocket = new globalThis.TCPServerSocket(bindAddr, options);
          const { readable, localAddress, localPort } = await this.serverSocket.opened;

          this.localAddress = localAddress || bindAddr;
          this.localPort = localPort;
          this.serverReader = readable.getReader();
          this.isListening = true;

          this._acceptLoop();
          return;
        } catch (err) {
          lastError = err;
          try { if (this.serverSocket) await this.serverSocket.close().catch(() => {}); } catch (e) {}
          this.serverSocket = null;
        }
      }
    }

    // 2. If requested port failed or was 0 / blocked, fall back to OS dynamic port (omit localPort)
    for (const bindAddr of bindAddresses) {
      try {
        const options = { backlog: 100 }; // No localPort -> OS assigns dynamic non-restricted port
        this.serverSocket = new globalThis.TCPServerSocket(bindAddr, options);
        const { readable, localAddress, localPort } = await this.serverSocket.opened;

        this.localAddress = localAddress || bindAddr;
        this.localPort = localPort;
        this.serverReader = readable.getReader();
        this.isListening = true;

        if (requestedPort > 0 && requestedPort !== localPort && this.onFallback) {
          this.onFallback(requestedPort, localPort);
        }

        this._acceptLoop();
        return;
      } catch (err) {
        lastError = err;
        try { if (this.serverSocket) await this.serverSocket.close().catch(() => {}); } catch (e) {}
        this.serverSocket = null;
      }
    }

    if (lastError) {
      if (this.onError) this.onError(lastError);
      throw lastError;
    }
  }

  async _acceptLoop() {
    try {
      while (this.isListening && this.serverReader) {
        const { value: acceptedSocket, done } = await this.serverReader.read();
        if (done) break;

        if (acceptedSocket) {
          if (this.activeSockets.size >= this.maxConnections) {
            try { await acceptedSocket.close().catch(() => {}); } catch (e) {}
            continue;
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
      }
    } catch (err) {
      if (this.isListening && this.onError) {
        this.onError(err);
      }
    } finally {
      this.stop();
    }
  }

  async stop() {
    if (!this.isListening && this.activeSockets.size === 0) return;
    this.isListening = false;

    // 1. Stop accepting new connections
    try {
      if (this.serverReader) {
        await this.serverReader.cancel().catch(() => {});
        this.serverReader.releaseLock();
      }
    } catch (e) {}

    try {
      if (this.serverSocket) {
        await this.serverSocket.close().catch(() => {});
      }
    } catch (e) {}

    this.serverReader = null;
    this.serverSocket = null;

    // 2. Force close all active client sockets
    const sockets = Array.from(this.activeSockets);
    this.activeSockets.clear();
    await Promise.allSettled(sockets.map(s => s.close().catch(() => {})));

    if (this.onClose) {
      this.onClose();
    }
  }
}
