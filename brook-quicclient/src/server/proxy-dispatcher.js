/**
 * Proxy Dispatcher: coordinates listeners, protocol detection, and tunnel sessions.
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
    this.hostDialQueues = new Map(); // host -> Array of resolve callbacks
    this.hostActiveDials = new Map(); // host -> number
    this.isRunning = false;
  }

  async _acquireHostDialPermit(host, maxConcurrent = 2) {
    const cleanHost = (host || '').toLowerCase();
    const active = this.hostActiveDials.get(cleanHost) || 0;
    if (active < maxConcurrent) {
      this.hostActiveDials.set(cleanHost, active + 1);
      return;
    }
    return new Promise(resolve => {
      let queue = this.hostDialQueues.get(cleanHost);
      if (!queue) {
        queue = [];
        this.hostDialQueues.set(cleanHost, queue);
      }
      queue.push(resolve);
    });
  }

  _releaseHostDialPermit(host) {
    const cleanHost = (host || '').toLowerCase();
    const queue = this.hostDialQueues.get(cleanHost);
    if (queue && queue.length > 0) {
      const next = queue.shift();
      next();
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
   * Start proxy listener(s).
   *
   * Modes:
   * 1. Dual Mode: Separate SOCKS5 port (1080/10808) and HTTP port (8080)
   * 2. Single Auto-Detect Mode: Both protocols multiplexed on single port
   *
   * @param {Object} config
   * @param {number} config.socks5Port
   * @param {number} config.httpPort
   * @param {boolean} config.enableSocks5
   * @param {boolean} config.enableHttp
   * @param {boolean} config.autoDetectMode
   * @returns {Promise<{ socks5Port: number, httpPort: number }>}
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

    if (autoDetectMode) {
      // Unified Auto-Detect Listener on socks5Port
      const listener = new TcpListener({
        localPort: socks5Port,
        onConnection: (socket) => this._handleClient(socket, 'auto'),
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
          onConnection: (socket) => this._handleClient(socket, 'socks5'),
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
          onConnection: (socket) => this._handleClient(socket, 'http'),
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
  }

  async _handleClient(acceptedSocket, expectedProtocol = 'auto') {
    let reader = null;
    let writer = null;
    let session = null;

    try {
      const { readable, writable, remoteAddress, remotePort } = await acceptedSocket.opened;
      reader = readable.getReader();
      writer = writable.getWriter();

      // Read initial chunk to identify protocol / start handshake with 10s timeout
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
        clearTimeout(readTimer);
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
      let sendSuccess = null;
      let sendFailure = null;

      if (proto === ProtocolType.SOCKS5 || proto === 'socks5') {
        const res = await Socks5Parser.handleHandshake(initialChunk, reader, writer);
        dstBytes = res.dstBytes;
        targetStr = res.targetStr;
        leftover = res.leftover;
        sendSuccess = res.sendSuccess;
        sendFailure = res.sendFailure;
        proto = 'SOCKS5';
      } else if (proto === ProtocolType.HTTP || proto === 'http') {
        const res = await HttpProxyParser.handleHandshake(initialChunk, reader, writer);
        dstBytes = res.dstBytes;
        targetStr = res.targetStr;
        leftover = res.leftover;
        sendSuccess = res.sendSuccess;
        sendFailure = res.sendFailure;
        proto = res.isConnect ? 'HTTPS CONNECT' : 'HTTP Plain';
      } else {
        throw new Error(`Unrecognized protocol preamble: 0x${initialChunk[0].toString(16)}`);
      }

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

          // Fast 2.0s dial timeout on initial attempt, 2.2s on retry 2, 2.5s on retry 3
          const dialTimeoutMs = attempt === 1 ? 2000 : (attempt === 2 ? 2200 : 2500);
          try {
            await BrookTunnel.run({
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
              sendSuccess,
              sendFailure: attempt === MAX_ATTEMPTS ? sendFailure : null,
              dialTimeoutMs,
              onClientDataRead: () => {
                clientDataConsumed = true;
              },
              onBytes: (sent, recv) => {
                this.sessionTracker.recordBytes(session.id, sent, recv);
              },
              onClose: () => {
                releaseHostPermitOnce();
                if (session) {
                  this.sessionTracker.closeSession(session.id);
                }
                quicSession.close();
              },
              onLog: (lvl, msg) => this._log(lvl, msg)
            });
            tunnelError = null;
            break; // Tunnel completed successfully
          } catch (err) {
            tunnelError = err;
            quicSession.close();
            // Do not retry if client explicitly closed, or if payload data was already transmitted/consumed
            if (clientDataConsumed || err.message.includes('client_closed') || err.message.includes('client_abort') || err.message.includes('client_write_error') || (session && session.bytesRecv > 0)) {
              break;
            }
            if (attempt < MAX_ATTEMPTS) {
              this._log('warning', `[#${session.id}] ⚠️ [Brook] Dial attempt ${attempt} for ${targetStr} failed (${err.message}). Retrying with fresh QUIC session (${attempt + 1}/${MAX_ATTEMPTS})...`);
            }
          }
        }

        if (tunnelError) {
          releaseHostPermitOnce();
          if (sendFailure) await sendFailure(0x05);
          throw tunnelError;
        }
      } finally {
        releaseHostPermitOnce();
      }
    } catch (err) {
      if (session) {
        this.sessionTracker.closeSession(session.id);
      }
      this._log('warning', `Proxy session error: ${err.message}`);

      try { if (reader) { await reader.cancel().catch(() => {}); reader.releaseLock(); } } catch (e) {}
      try { if (writer) { await writer.close().catch(() => {}); writer.releaseLock(); } } catch (e) {}
      try { await acceptedSocket.close().catch(() => {}); } catch (e) {}
    }
  }

  async stop() {
    this.isRunning = false;
    for (const [name, listener] of this.listeners.entries()) {
      try {
        await listener.stop();
      } catch (e) {}
    }
    this.listeners.clear();
  }
}
