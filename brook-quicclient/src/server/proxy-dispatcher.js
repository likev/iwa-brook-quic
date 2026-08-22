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
import { DnsResolver } from '../core/dns-resolver.js';
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

    let boundS5Port = socks5Port;
    let boundHttpPort = httpPort;

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
          this.listeners.set('http', httpListener);
          this._log('success', `🌐 HTTP/HTTPS Proxy listening on 127.0.0.1:${httpListener.localPort}`);
        }
      }

      return {
        socks5Port: boundS5Port,
        httpPort: boundHttpPort
      };
    } catch (err) {
      // Rollback any successfully bound listeners on failure
      await this.stop();
      throw err;
    }
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
      }
    };
    this.activeHandlers.add(handlerEntry);

    try {
      await this._processClient(acceptedSocket, expectedProtocol, handlerEntry);
    } finally {
      this.activeHandlers.delete(handlerEntry);
      if (onComplete) onComplete();
    }
  }

  async _processClient(acceptedSocket, expectedProtocol = 'auto', handlerEntry = null) {
    let reader = null;
    let writer = null;
    let session = null;

    if (handlerEntry) {
      handlerEntry.cancel = () => {
        try { acceptedSocket.close(); } catch (e) {}
        try { if (reader) reader.cancel().catch(() => {}); } catch (e) {}
        try { if (writer) writer.close().catch(() => {}); } catch (e) {}
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
        const timeoutPromise = new Promise((_, reject) => {
          readTimer = setTimeout(() => reject(new Error('Client initial read timed out (idle connection)')), 10000);
        });
        const readResult = await Promise.race([readPromise, timeoutPromise]);
        clearTimeout(readTimer);
        if (readResult.done || !readResult.value || readResult.value.length === 0) {
          await reader.cancel().catch(() => {});
          await writer.close().catch(() => {});
          return;
        }
        initialChunk = readResult.value;
      } catch (readErr) {
        if (readTimer) clearTimeout(readTimer);
        await reader.cancel().catch(() => {});
        await writer.close().catch(() => {});
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
      let clientDataConsumed = false;
      const MAX_ATTEMPTS = 3;

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        if (!this.isRunning) {
          throw new Error('ProxyDispatcher was stopped during dial attempt');
        }
        if (this.networkMonitor && !this.networkMonitor.isOnline) {
          throw new Error('Network is offline');
        }

        // Create or acquire multiplexed WebTransport stream session to remote Brook server
        const acqStart = Date.now();
        let quicSession;
        try {
          quicSession = await this.quicManager.createSession();
        } catch (sessErr) {
          tunnelError = sessErr;
          if (attempt === MAX_ATTEMPTS) {
            this._log('error', `[#${session.id}] ❌ Failed to acquire WebTransport session for ${targetStr}: ${sessErr.message}`);
            break;
          }
          await new Promise(r => setTimeout(r, 300));
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

          if (outcome.success) {
            tunnelError = null;
            break;
          } else {
            tunnelError = outcome.error || new Error(`Brook tunnel failed (${outcome.kind})`);
            if (quicSession) {
              quicSession.close();
            }

            const bytesReceived = session ? session.bytesReceived : 0;
            if (clientDataConsumed || proxyReplied || bytesReceived > 0 || outcome.kind === 'client_abort' || outcome.kind === 'client_read_error' || outcome.kind === 'rx_overflow') {
              break;
            }

            if (attempt < MAX_ATTEMPTS) {
              this.totalRetries++;
              this._log('warning', `[#${session.id}] ⚠️ [Brook] Dial attempt ${attempt} for ${targetStr} failed (${outcome.kind}). Retrying with fresh session (${attempt + 1}/${MAX_ATTEMPTS})...`);
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
        // Normal keep-alive socket expiration or clean transport closure after data exchange is not a critical error
        if ((tunnelError.message.includes('idle_timeout') || tunnelError.message.includes('transport_closed')) && session && session.bytesReceived > 0) {
          // Quiet normal termination
        } else {
          throw tunnelError;
        }
      }
    } catch (err) {
      if (!err.message.includes('idle_timeout') && !err.message.includes('transport_closed')) {
        this._log('warning', `Proxy session error: ${err.message}`);
      }

      try { if (reader) await reader.cancel().catch(() => {}); } catch (e) {}
      try { if (writer) await writer.close().catch(() => {}); } catch (e) {}
      try { await acceptedSocket.close().catch(() => {}); } catch (e) {}
    } finally {
      try { if (reader) reader.releaseLock(); } catch (e) {}
      try { if (writer) writer.releaseLock(); } catch (e) {}
      if (session) {
        this.sessionTracker.closeSession(session.id);
      }
    }
  }

  async stop() {
    this.isRunning = false;

    // 1. Stop all listeners
    for (const [name, listener] of this.listeners.entries()) {
      try {
        await listener.stop();
      } catch (e) {}
    }
    this.listeners.clear();

    // 2. Await active handlers
    if (this.activeHandlers.size > 0) {
      await Promise.allSettled(Array.from(this.activeHandlers));
      this.activeHandlers.clear();
    }
  }
}
