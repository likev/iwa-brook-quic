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
    withoutBrook = false,
    clockOffsetSec = 0,
    onLog
  }) {
    this.quicManager = quicManager;
    this.sessionTracker = sessionTracker;
    this.password = password;
    this.withoutBrook = withoutBrook;
    this.clockOffsetSec = clockOffsetSec;
    this.onLog = onLog;

    this.listeners = new Map(); // name -> TcpListener
    this.hostDialQueues = new Map(); // host -> Array<{resolve, reject}>
    this.hostActiveDials = new Map(); // host -> number
    this.activeHandlers = new Set();
    this.isRunning = true;
  }

  async _acquireHostDialPermit(host, maxConcurrent = 8) {
    if (!this.isRunning) {
      throw new Error('ProxyDispatcher is stopped');
    }
    const cleanHost = (host || '').toLowerCase();
    const active = this.hostActiveDials.get(cleanHost) || 0;
    if (active < maxConcurrent) {
      this.hostActiveDials.set(cleanHost, active + 1);
      return;
    }

    const MAX_HOST_QUEUE_DEPTH = 64;
    let queue = this.hostDialQueues.get(cleanHost);
    if (!queue) {
      queue = [];
      this.hostDialQueues.set(cleanHost, queue);
    }
    if (queue.length >= MAX_HOST_QUEUE_DEPTH) {
      throw new Error(`Host dial queue full for ${cleanHost} (${queue.length} >= ${MAX_HOST_QUEUE_DEPTH})`);
    }

    return new Promise((resolve, reject) => {
      queue.push({ resolve, reject });
    });
  }

  _releaseHostDialPermit(host) {
    const cleanHost = (host || '').toLowerCase();
    const queue = this.hostDialQueues.get(cleanHost);
    if (queue && queue.length > 0) {
      const next = queue.shift();
      if (queue.length === 0) this.hostDialQueues.delete(cleanHost);
      if (next && next.resolve) next.resolve();
    } else {
      const active = this.hostActiveDials.get(cleanHost) || 1;
      if (active <= 1) {
        this.hostActiveDials.delete(cleanHost);
      } else {
        this.hostActiveDials.set(cleanHost, active - 1);
      }
    }
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

  async _handleClient(acceptedSocket, expectedProtocol = 'auto', onComplete = null) {
    const handlerPromise = this._processClient(acceptedSocket, expectedProtocol);
    this.activeHandlers.add(handlerPromise);
    try {
      await handlerPromise;
    } finally {
      this.activeHandlers.delete(handlerPromise);
      if (onComplete) onComplete();
    }
  }

  async _processClient(acceptedSocket, expectedProtocol = 'auto') {
    let reader = null;
    let writer = null;
    let session = null;

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

      const { host, port } = parseHostPort(targetStr, 80);

      // Acquire per-host dial permit to pace burst connections (max 8 concurrent active connections per host)
      await this._acquireHostDialPermit(host, 8);
      let hostPermitReleased = false;
      const releaseHostPermitOnce = () => {
        if (!hostPermitReleased) {
          hostPermitReleased = true;
          this._releaseHostDialPermit(host);
        }
      };

      let tunnelError = null;
      let clientDataConsumed = false;
      const MAX_ATTEMPTS = 3;

      try {
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
          if (!this.isRunning) {
            throw new Error('ProxyDispatcher was stopped during dial attempt');
          }

          // Resolve domain name to IPv4 locally via Brook DNS resolver (Anycast round-robin distribution)
          let forwardDstBytes = dstBytes;
          const resolvedIp = await DnsResolver.resolveIpv4(host, this.quicManager, this.password, {
            withoutBrook: this.withoutBrook,
            clockOffsetSec: this.clockOffsetSec,
            timeoutMs: 2500
          }).catch(() => null);

          if (resolvedIp && (DnsResolver.isIpv4(resolvedIp) || DnsResolver.isIpv6(resolvedIp))) {
            forwardDstBytes = encodeAddress(resolvedIp, port);
            if (resolvedIp !== host) {
              this._log('info', `[#${session.id}] 🎯 Proxy DNS resolved: ${host} -> ${resolvedIp}${attempt > 1 ? ` (retry ${attempt} rotation)` : ''}`);
            }
          }

          // Create or acquire dedicated QUIC session to remote Brook server
          const acqStart = Date.now();
          let quicSession;
          try {
            quicSession = await this.quicManager.createSession();
            const acqElapsed = Date.now() - acqStart;
            if (acqElapsed > 50) {
              this._log('info', `[#${session.id}] ⚡ QUIC session acquired on-demand (${acqElapsed}ms)`);
            }
          } catch (sessErr) {
            tunnelError = sessErr;
            if (attempt === MAX_ATTEMPTS) {
              this._log('error', `[#${session.id}] ❌ Failed to acquire QUIC session for ${targetStr}: ${sessErr.message}`);
              break;
            }
            continue;
          }

          // Fast 3.5s dial timeout on initial attempt, 4.0s on retry 2, 5.0s on retry 3
          // Started only after QUIC session is connected and frames are on the wire
          const dialTimeoutMs = attempt === 1 ? 3500 : (attempt === 2 ? 4000 : 5000);
          let outcome = null;

          try {
            outcome = await BrookTunnel.run({
              clientReader: reader,
              clientWriter: writer,
              quicManager: quicSession,
              dstBytes: forwardDstBytes,
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
                releaseHostPermitOnce();
                quicSession.close();
              },
              onLog: (lvl, msg) => this._log(lvl, msg)
            });

            if (outcome.success) {
              tunnelError = null;
              break; // Tunnel completed successfully
            } else {
              tunnelError = outcome.error || new Error(`Brook tunnel failed (${outcome.kind})`);
              quicSession.close();

              // Do not retry if client explicitly closed, or if payload data was already transmitted/consumed
              const bytesReceived = session ? session.bytesReceived : 0;
              if (clientDataConsumed || proxyReplied || bytesReceived > 0 || outcome.kind === 'client_abort' || outcome.kind === 'client_read_error' || outcome.kind === 'rx_overflow') {
                break;
              }

              if (attempt < MAX_ATTEMPTS) {
                this._log('warning', `[#${session.id}] ⚠️ [Brook] Dial attempt ${attempt} for ${targetStr} failed (${outcome.kind}). Retrying with fresh QUIC session (${attempt + 1}/${MAX_ATTEMPTS})...`);
              }
            }
          } catch (err) {
            tunnelError = err;
            quicSession.close();
            const bytesReceived = session ? session.bytesReceived : 0;
            if (clientDataConsumed || proxyReplied || bytesReceived > 0 || err.message.includes('client_closed') || err.message.includes('client_abort') || err.message.includes('client_write_error')) {
              break;
            }
            if (attempt < MAX_ATTEMPTS) {
              this._log('warning', `[#${session.id}] ⚠️ [Brook] Dial attempt ${attempt} for ${targetStr} failed (${err.message}). Retrying with fresh QUIC session (${attempt + 1}/${MAX_ATTEMPTS})...`);
            }
          }
        }

        if (tunnelError) {
          releaseHostPermitOnce();
          await sendFailureOnce(0x05);
          // Normal keep-alive socket expiration or clean transport closure after data exchange is not a critical error
          if ((tunnelError.message.includes('idle_timeout') || tunnelError.message.includes('transport_closed')) && session && session.bytesReceived > 0) {
            // Quiet normal termination
          } else {
            throw tunnelError;
          }
        }
      } finally {
        releaseHostPermitOnce();
        if (session) {
          this.sessionTracker.closeSession(session.id);
        }
      }
    } catch (err) {
      if (!err.message.includes('idle_timeout') && !err.message.includes('transport_closed')) {
        this._log('warning', `Proxy session error: ${err.message}`);
      }

      try { if (reader) { await reader.cancel().catch(() => {}); reader.releaseLock(); } } catch (e) {}
      try { if (writer) { await writer.close().catch(() => {}); writer.releaseLock(); } } catch (e) {}
      try { await acceptedSocket.close().catch(() => {}); } catch (e) {}
    }
  }

  async stop() {
    this.isRunning = false;

    // 1. Drain and reject all pending host dial queues
    for (const [host, queue] of this.hostDialQueues.entries()) {
      while (queue.length > 0) {
        const next = queue.shift();
        if (next && next.reject) {
          next.reject(new Error('ProxyDispatcher is stopped'));
        }
      }
    }
    this.hostDialQueues.clear();
    this.hostActiveDials.clear();

    // 2. Stop all listeners
    for (const [name, listener] of this.listeners.entries()) {
      try {
        await listener.stop();
      } catch (e) {}
    }
    this.listeners.clear();

    // 3. Await active handlers
    if (this.activeHandlers.size > 0) {
      await Promise.allSettled(Array.from(this.activeHandlers));
      this.activeHandlers.clear();
    }
  }
}
