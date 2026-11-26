/**
 * Proxy Dispatcher: coordinates listeners, protocol detection, and tunnel sessions.
 * Implements admission control, bounded host dial queues, transactional startup/stop,
 * deterministic retry outcomes, and one-shot proxy reply state machines.
 */

import { TcpListener } from './tcp-listener.js';
import { ProtocolDetector, ProtocolType } from '../protocols/protocol-detector.js';
import { Socks5Parser } from '../protocols/socks5-parser.js';
import { HttpProxyParser } from '../protocols/http-proxy-parser.js';
import { BrookTunnel } from '../core/brook-tunnel.js';
import { encodeAddress, parseHostPort } from '../core/byte-utils.js';

export class ProxyDispatcher {
  constructor({
    quicManager,
    sessionTracker,
    password,
    withoutBrook = true,
    clockOffsetSec = 0,
    networkMonitor = null,
    onLog
  }) {
    this.quicManager = quicManager;
    this.sessionTracker = sessionTracker;
    this.password = password;
    this.withoutBrook = withoutBrook;
    this.clockOffsetSec = clockOffsetSec;
    this.networkMonitor = networkMonitor;
    this.onLog = onLog;

    this.listeners = new Map(); // name -> TcpListener
    this.activeHandlers = new Set();
    this.totalRetries = 0;
    this.isRunning = true;
    this._listenConfig = null;
    this.isListeningPaused = false;
    this._listenerOpSeq = 0;
    this._dedupLogs = new Map(); // key -> { lastLoggedAt, suppressedCount }
  }

  getHostQueueTotal() {
    return 0;
  }

  getStats() {
    return {
      hostQueueTotal: 0,
      activeTunnels: this.activeHandlers.size,
      retries: this.totalRetries
    };
  }

  _log(level, message, meta = null) {
    if (this.onLog) {
      this.onLog(level, message, meta);
    }
  }

  /**
   * Deduplicate bursty warnings/errors (e.g., pool-down stalls hitting many
   * concurrent proxy requests at once) within a sliding window.
   */
  _logDeduplicated(level, key, message, windowMs = 5000) {
    const now = Date.now();
    const entry = this._dedupLogs.get(key);
    if (entry && (now - entry.lastLoggedAt) < windowMs) {
      entry.suppressedCount++;
      return false;
    }

    const suppressed = entry ? entry.suppressedCount : 0;
    this._dedupLogs.set(key, { lastLoggedAt: now, suppressedCount: 0 });

    if (this._dedupLogs.size > 64) {
      for (const [k, v] of this._dedupLogs.entries()) {
        if (now - v.lastLoggedAt >= windowMs * 2) {
          this._dedupLogs.delete(k);
        }
      }
    }

    const suffix = suppressed > 0 ? ` (+${suppressed} similar suppressed)` : '';
    this._log(level, `${message}${suffix}`);
    return true;
  }

  /**
   * Bind configured TCP listener(s) with rollback of newly bound listeners on failure.
   */
  async _bindListeners({
    socks5Port = 10808,
    httpPort = 8080,
    enableSocks5 = true,
    enableHttp = true,
    autoDetectMode = false
  }) {
    let boundS5Port = socks5Port;
    let boundHttpPort = httpPort;
    const newlyBound = [];

    try {
      if (autoDetectMode) {
        // Unified Auto-Detect Listener on socks5Port
        const listener = new TcpListener({
          localPort: socks5Port,
          onConnection: (socket, onDone) => this._handleClient(socket, 'auto', onDone),
          onError: (err) => this._log('error', `Unified listener error: ${err.message}`),
          onClose: () => this._log('info', 'Unified listener closed'),
          onFallback: (reqPort, actualPort) => {
            this._log('warning', `⚠️ Chrome blocked fixed port ${reqPort}. Automatically assigned dynamic port ${actualPort}!`);
          }
        });
        await listener.start();
        boundS5Port = listener.localPort;
        boundHttpPort = listener.localPort;
        newlyBound.push(['unified', listener]);
        this.listeners.set('unified', listener);
        this._log('success', `⚡ Unified Auto-Detect Proxy listening on 127.0.0.1:${listener.localPort}`);
      } else {
        // Separate SOCKS5 Listener
        if (enableSocks5) {
          const s5Listener = new TcpListener({
            localPort: socks5Port,
            onConnection: (socket, onDone) => this._handleClient(socket, 'socks5', onDone),
            onError: (err) => this._log('error', `SOCKS5 listener error: ${err.message}`),
            onClose: () => this._log('info', 'SOCKS5 listener closed'),
            onFallback: (reqPort, actualPort) => {
              this._log('warning', `⚠️ Chrome blocked fixed port ${reqPort}. Automatically assigned dynamic port ${actualPort}!`);
            }
          });
          await s5Listener.start();
          boundS5Port = s5Listener.localPort;
          newlyBound.push(['socks5', s5Listener]);
          this.listeners.set('socks5', s5Listener);
          this._log('success', `🧦 SOCKS5 Proxy listening on 127.0.0.1:${s5Listener.localPort}`);
        }

        // Separate HTTP Proxy Listener
        if (enableHttp) {
          const httpListener = new TcpListener({
            localPort: httpPort,
            onConnection: (socket, onDone) => this._handleClient(socket, 'http', onDone),
            onError: (err) => this._log('error', `HTTP Proxy listener error: ${err.message}`),
            onClose: () => this._log('info', 'HTTP Proxy listener closed'),
            onFallback: (reqPort, actualPort) => {
              this._log('warning', `⚠️ Chrome blocked fixed port ${reqPort}. Automatically assigned dynamic port ${actualPort}!`);
            }
          });
          await httpListener.start();
          boundHttpPort = httpListener.localPort;
          newlyBound.push(['http', httpListener]);
          this.listeners.set('http', httpListener);
          this._log('success', `🌐 HTTP/HTTPS Proxy listening on 127.0.0.1:${httpListener.localPort}`);
        }
      }

      return {
        socks5Port: boundS5Port,
        httpPort: boundHttpPort
      };
    } catch (err) {
      for (const [name, listener] of newlyBound) {
        this.listeners.delete(name);
        try { await listener.stopListening(); } catch (e) {}
      }
      throw err;
    }
  }

  /**
   * Start proxy listener(s) with atomic rollback on failure.
   */
  async start({
    socks5Port = 10808,
    httpPort = 8080,
    enableSocks5 = true,
    enableHttp = true,
    autoDetectMode = false
  }) {
    await this.stop();
    this.isRunning = true;
    this.isListeningPaused = false;
    this._listenConfig = { socks5Port, httpPort, enableSocks5, enableHttp, autoDetectMode };

    if (this.networkMonitor && !this.networkMonitor.isOnline) {
      this.isListeningPaused = true;
      this._log('warning', '⏸️ Network probe offline at startup: TCP listening deferred until online.');
      return { socks5Port, httpPort };
    }

    const opSeq = ++this._listenerOpSeq;
    try {
      const bound = await this._bindListeners(this._listenConfig);
      if (opSeq !== this._listenerOpSeq || !this.isRunning || this.isListeningPaused) {
        const staleListeners = Array.from(this.listeners.values());
        this.listeners.clear();
        for (const listener of staleListeners) {
          try { await listener.stopListening(); } catch (e) {}
        }
      }
      return bound;
    } catch (err) {
      // Rollback any successfully bound listeners on failure
      await this.stop();
      throw err;
    }
  }

  /**
   * Pause TCP listening without closing already-accepted client sockets or active QUIC tunnels.
   */
  async pauseListening(reason = 'network_offline') {
    this._listenerOpSeq++;
    if (!this.isRunning || (this.isListeningPaused && this.listeners.size === 0)) return;
    this.isListeningPaused = true;

    const activeListeners = Array.from(this.listeners.values());
    this.listeners.clear();
    for (const listener of activeListeners) {
      try {
        await listener.stopListening();
      } catch (e) {}
    }
    this._log('warning', `⏸️ Paused TCP proxy listening (${reason}); existing connections & QUIC sessions remain active.`);
  }

  /**
   * Resume TCP listening after a previous pauseListening() call.
   */
  async resumeListening(reason = 'network_online') {
    if (!this.isRunning || !this._listenConfig) return null;
    if (!this.isListeningPaused && this.listeners.size > 0) {
      const unified = this.listeners.get('unified');
      if (unified) {
        return { socks5Port: unified.localPort, httpPort: unified.localPort };
      }
      return {
        socks5Port: this.listeners.get('socks5')?.localPort ?? this._listenConfig.socks5Port,
        httpPort: this.listeners.get('http')?.localPort ?? this._listenConfig.httpPort
      };
    }
    if (this.networkMonitor && !this.networkMonitor.isOnline) return null;

    const opSeq = ++this._listenerOpSeq;
    this.isListeningPaused = false;
    const bound = await this._bindListeners(this._listenConfig);

    if (opSeq !== this._listenerOpSeq || !this.isRunning || this.isListeningPaused) {
      const staleListeners = Array.from(this.listeners.values());
      this.listeners.clear();
      for (const listener of staleListeners) {
        try { await listener.stopListening(); } catch (e) {}
      }
      return null;
    }

    this._log('success', `▶️ Resumed TCP proxy listening (${reason}).`);
    return bound;
  }

  /**
   * Drop all active proxy connections immediately (e.g. on network offline).
   */
  dropAllConnections(reason = 'network_offline') {
    this._log('warning', `Dropping all active proxy connections (${reason})...`);
    for (const handler of Array.from(this.activeHandlers)) {
      try {
        if (typeof handler.cancel === 'function') {
          handler.cancel();
        }
      } catch (e) {}
    }
  }

  async _handleClient(acceptedSocket, expectedProtocol = 'auto', onComplete = null) {
    if (this.networkMonitor && !this.networkMonitor.isOnline) {
      this._log('warning', `⚠️ Dropping incoming ${expectedProtocol} connection: Network is offline`);
      try { acceptedSocket.close(); } catch (e) {}
      if (onComplete) onComplete();
      return;
    }

    const handlerEntry = {
      socket: acceptedSocket,
      cancel: () => {
        try { acceptedSocket.close(); } catch (e) {}
      },
      promise: null
    };
    this.activeHandlers.add(handlerEntry);

    const clientPromise = (async () => {
      try {
        await this._processClient(acceptedSocket, expectedProtocol, handlerEntry);
      } finally {
        this.activeHandlers.delete(handlerEntry);
        if (onComplete) onComplete();
      }
    })();
    handlerEntry.promise = clientPromise;
    await clientPromise;
  }

  async _processClient(acceptedSocket, expectedProtocol = 'auto', handlerEntry = null) {
    let reader = null;
    let writer = null;
    let quicSession = null;
    let session = null;

    if (handlerEntry) {
      handlerEntry.cancel = () => {
        try { acceptedSocket.close(); } catch (e) {}
        try { if (reader) reader.cancel().catch(() => {}); } catch (e) {}
        try { if (writer) writer.close().catch(() => {}); } catch (e) {}
        try { if (quicSession) quicSession.close(); } catch (e) {}
      };
    }

    try {
      const { readable, writable, remoteAddress, remotePort } = await acceptedSocket.opened;
      reader = readable.getReader();
      writer = writable.getWriter();

      // Read initial chunk to identify protocol with 10s deadline
      let initialChunk = null;
      let readTimer = null;
      try {
        const readPromise = reader.read();
        // Avoid unhandled rejection if timeout wins and the pending read later rejects.
        readPromise.catch(() => {});
        const timeoutPromise = new Promise((_, reject) => {
          readTimer = setTimeout(() => reject(new Error('Client initial read timed out (idle connection)')), 10000);
        });
        const readResult = await Promise.race([readPromise, timeoutPromise]);
        clearTimeout(readTimer);
        if (readResult.done || !readResult.value || readResult.value.length === 0) {
          await reader.cancel().catch(() => {});
          try { reader.releaseLock(); } catch (e) {}
          await writer.close().catch(() => {});
          try { writer.releaseLock(); } catch (e) {}
          return;
        }
        initialChunk = readResult.value;
      } catch (readErr) {
        if (readTimer) clearTimeout(readTimer);
        await reader.cancel().catch(() => {});
        try { reader.releaseLock(); } catch (e) {}
        await writer.close().catch(() => {});
        try { writer.releaseLock(); } catch (e) {}
        return;
      }

      let proto = expectedProtocol;
      if (proto === 'auto') {
        proto = ProtocolDetector.detect(initialChunk);
      }

      let dstBytes = null;
      let targetStr = '';
      let leftover = new Uint8Array(0);
      let rawSendSuccess = null;
      let rawSendFailure = null;

      if (proto === ProtocolType.SOCKS5 || proto === 'socks5') {
        const res = await Socks5Parser.handleHandshake(initialChunk, reader, writer, 8000);
        dstBytes = res.dstBytes;
        targetStr = res.targetStr;
        leftover = res.leftover;
        rawSendSuccess = res.sendSuccess;
        rawSendFailure = res.sendFailure;
        proto = 'SOCKS5';
      } else if (proto === ProtocolType.HTTP || proto === 'http') {
        const res = await HttpProxyParser.handleHandshake(initialChunk, reader, writer, 8000);
        dstBytes = res.dstBytes;
        targetStr = res.targetStr;
        leftover = res.leftover;
        rawSendSuccess = res.sendSuccess;
        rawSendFailure = res.sendFailure;
        proto = res.isConnect ? 'HTTPS CONNECT' : 'HTTP Plain';
      } else {
        throw new Error(`Unrecognized protocol preamble: 0x${initialChunk[0].toString(16)}`);
      }

      // One-shot state machine for proxy success/failure responses across retries
      let proxyReplied = false;
      const sendSuccessOnce = async () => {
        if (proxyReplied) return;
        proxyReplied = true;
        if (rawSendSuccess) await rawSendSuccess();
      };
      const sendFailureOnce = async (code) => {
        if (proxyReplied) return;
        proxyReplied = true;
        if (rawSendFailure) await rawSendFailure(code);
      };

      session = this.sessionTracker.createSession({
        protocol: proto,
        target: targetStr,
        clientAddr: `${remoteAddress || '127.0.0.1'}:${remotePort || 0}`
      });

      let tunnelError = null;
      let finalOutcome = null;
      let clientDataConsumed = false;
      let sessionAcquireErrorLogged = false;
      const MAX_ATTEMPTS = 3;

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        if (!this.isRunning) {
          throw new Error('ProxyDispatcher was stopped during dial attempt');
        }
        if (attempt > 1 && this.networkMonitor && !this.networkMonitor.isOnline) {
          throw new Error('Network is offline');
        }

        // Create or acquire multiplexed WebTransport stream session to remote Brook server
        // Assign to outer `quicSession` (no shadowing) so handlerEntry.cancel()
        // closes the live session on dropAllConnections/stop().
        quicSession = null;
        try {
          quicSession = await this.quicManager.createSession();
        } catch (sessErr) {
          tunnelError = sessErr;
          if (attempt === MAX_ATTEMPTS || (this.networkMonitor && !this.networkMonitor.isOnline)) {
            const errMsg = sessErr?.message || String(sessErr);
            const dedupKey = `wt_acquire:${errMsg.replace(/#\d+/g, '#N')}`;
            this._logDeduplicated(
              'warning',
              dedupKey,
              `[#${session.id}] ❌ Failed to acquire WebTransport session for ${targetStr}: ${errMsg}`
            );
            sessionAcquireErrorLogged = true;
            break;
          }
          // Short exponential backoff with jitter (500ms, 1000ms) when pool is down
          const baseBackoffMs = Math.min(2000, 500 * Math.pow(2, attempt - 1));
          const jitterMs = Math.floor(Math.random() * 150);
          await new Promise(r => setTimeout(r, baseBackoffMs + jitterMs));
          continue;
        }

        const dialTimeoutMs = attempt === 1 ? 6000 : (attempt === 2 ? 8000 : 10000);
        let outcome = null;

        try {
          outcome = await BrookTunnel.run({
            clientReader: reader,
            clientWriter: writer,
            quicManager: quicSession,
            dstBytes: dstBytes,
            leftover,
            password: this.password,
            withoutBrook: this.withoutBrook,
            clockOffsetSec: this.clockOffsetSec,
            targetStr,
            sessionId: session.id,
            sendSuccess: sendSuccessOnce,
            sendFailure: attempt === MAX_ATTEMPTS ? sendFailureOnce : null,
            dialTimeoutMs,
            closeClientStreams: attempt === MAX_ATTEMPTS,
            onClientDataRead: () => {
              clientDataConsumed = true;
            },
            onBytes: (sent, recv) => {
              this.sessionTracker.recordBytes(session.id, sent, recv);
            },
            onClose: () => {
              if (quicSession) {
                quicSession.close();
              }
            },
            onLog: (lvl, msg) => this._log(lvl, msg)
          });

          finalOutcome = outcome;

          if (outcome.success) {
            tunnelError = null;
            break;
          } else {
            tunnelError = outcome.error || new Error(`Brook tunnel failed (${outcome.kind})`);
            if (quicSession) {
              quicSession.close();
            }

            const bytesReceived = outcome ? outcome.bytesReceived : 0;
            if (clientDataConsumed || bytesReceived > 0 || outcome.kind === 'client_abort' || outcome.kind === 'rx_overflow') {
              break;
            }

            if (attempt < MAX_ATTEMPTS) {
              if (this.networkMonitor && !this.networkMonitor.isOnline) {
                break;
              }
              this.totalRetries++;
              this._log('warning', `[#${session?.id}] ⚠️ [Brook] Dial attempt ${attempt} for ${targetStr} failed (${outcome.kind}). Retrying with fresh session (${attempt + 1}/${MAX_ATTEMPTS})...`);
              await new Promise(r => setTimeout(r, 300));
            }
          }
        } catch (runErr) {
          tunnelError = runErr;
          if (quicSession) {
            quicSession.close();
          }
          break;
        }
      }

      if (tunnelError) {
        await sendFailureOnce(0x05);
        // Normal keep-alive socket expiration or clean transport/stream closure after data exchange is not a critical error
        if ((finalOutcome?.kind === 'idle_timeout' || finalOutcome?.kind === 'transport_closed' || finalOutcome?.kind === 'stream_reset') && finalOutcome?.bytesReceived > 0) {
          this._log('info', `[#${session?.id}] Proxy session closed (${finalOutcome.kind}, ${finalOutcome.bytesReceived}B transferred)`);
        } else if (!sessionAcquireErrorLogged) {
          const errMsg = tunnelError.message || String(tunnelError);
          const dedupKey = `proxy_err:${errMsg.replace(/#\d+/g, '#N')}`;
          this._logDeduplicated('warning', dedupKey, `Proxy session error: ${errMsg}`);
        }
      }
    } catch (err) {
      if (!err.message?.includes('idle_timeout') && !err.message?.includes('transport_closed')) {
        this._log('warning', `Proxy session error: ${err.message}`);
      }
    } finally {
      try { if (reader) await reader.cancel().catch(() => {}); } catch (e) {}
      try { if (writer) await writer.close().catch(() => {}); } catch (e) {}
      try { await acceptedSocket.close().catch(() => {}); } catch (e) {}
      try { if (reader) reader.releaseLock(); } catch (e) {}
      try { if (writer) writer.releaseLock(); } catch (e) {}
      if (session) {
        this.sessionTracker.closeSession(session.id);
      }
    }
  }

  async stop() {
    this._listenerOpSeq++;
    this.isRunning = false;
    this.isListeningPaused = false;
    this._dedupLogs.clear();

    // 1. Stop all listeners
    for (const [name, listener] of this.listeners.entries()) {
      try {
        await listener.stop();
      } catch (e) {}
    }
    this.listeners.clear();

    // 2. Cancel and await active handlers
    if (this.activeHandlers.size > 0) {
      const handlers = Array.from(this.activeHandlers);
      for (const h of handlers) {
        try {
          if (typeof h.cancel === 'function') h.cancel();
        } catch (e) {}
      }
      const promises = handlers.map(h => h.promise).filter(Boolean);
      await Promise.allSettled(promises);
      this.activeHandlers.clear();
    }
  }
}
