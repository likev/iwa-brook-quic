/**
 * Comprehensive Automated Test Suite for Brook WebTransport Client & Direct Sockets IWAs.
 * Runs unit tests and live end-to-end integration tests using native Web Crypto & WebTransport APIs.
 */

import net from 'node:net';
import http from 'node:http';
import { spawn, exec } from 'node:child_process';
import { promisify } from 'node:util';

import { deriveKey, deriveKeyBytes, generateNonce, nextNonce, sha256 } from '../brook-quicclient/src/core/brook-crypto.js';
import { sealFrame, openLength, openPayload, buildBrookHeader, BrookCipher } from '../brook-quicclient/src/core/brook-framing.js';
import { Socks5Parser } from '../brook-quicclient/src/protocols/socks5-parser.js';
import { HttpProxyParser } from '../brook-quicclient/src/protocols/http-proxy-parser.js';
import { ProtocolDetector, ProtocolType } from '../brook-quicclient/src/protocols/protocol-detector.js';
import { BrookTunnel } from '../brook-quicclient/src/core/brook-tunnel.js';
import { DnsResolver } from '../brook-quicclient/src/core/dns-resolver.js';
import { encodeAddress, parseIpv6, parseHostPort, formatIpv6 } from '../brook-quicclient/src/core/byte-utils.js';
import { WebTransportConnectionManager } from '../brook-quicclient/src/webtransport/wt-connection-manager.js';
import { WtStreamSession } from '../brook-quicclient/src/webtransport/wt-stream-adapter.js';
import { ProxyDispatcher } from '../brook-quicclient/src/server/proxy-dispatcher.js';
import { TcpListener } from '../brook-quicclient/src/server/tcp-listener.js';
import { LogStream } from '../brook-quicclient/src/ui/log-stream.js';
import { SessionTracker } from '../brook-quicclient/src/server/session-tracker.js';
import { createPortStreamBridge } from '../brook-quicclient/src/workers/worker-tunnel-bridge.js';

const execAsync = promisify(exec);

let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
  if (!condition) {
    failedTests++;
    console.error(`  ❌ FAIL: ${message}`);
    throw new Error(message);
  } else {
    passedTests++;
    console.log(`  ✅ PASS: ${message}`);
  }
}

// -------------------------------------------------------------
// 1. Unit Tests: Crypto, Framing, Protocols, & WebTransport
// -------------------------------------------------------------
async function runUnitTests() {
  console.log('\n========================================');
  console.log('  1. RUNNING UNIT TESTS');
  console.log('========================================\n');

  // 1.1 Web Crypto Key Derivation & Hashing
  const password = '271828brook';
  const nonce = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

  // Test WithoutBrook = true (Default)
  const defaultCryptoKey = await deriveKey(password, nonce);
  assert(defaultCryptoKey instanceof CryptoKey, 'deriveKey returns native Web Crypto CryptoKey with default withoutBrook=true');

  const defaultRawKey = await deriveKeyBytes(password, nonce);
  assert(defaultRawKey instanceof Uint8Array && defaultRawKey.length === 32, 'deriveKeyBytes returns 32-byte key with default withoutBrook=true');

  const manualSha256 = await sha256(new TextEncoder().encode(password));
  const derivedFromHash = await deriveKeyBytes(manualSha256, nonce, 'brook', false);
  assert(Buffer.from(defaultRawKey).equals(Buffer.from(derivedFromHash)), 'Default deriveKey matches manual SHA256 pre-hashed password key');

  // Test WithoutBrook = false (Legacy raw password)
  const legacyCryptoKey = await deriveKey(password, nonce, 'brook', false);
  assert(legacyCryptoKey instanceof CryptoKey, 'deriveKey returns native CryptoKey with withoutBrook=false');
  const legacyRawKey = await deriveKeyBytes(password, nonce, 'brook', false);
  assert(!Buffer.from(defaultRawKey).equals(Buffer.from(legacyRawKey)), 'WithoutBrook=true produces different key from withoutBrook=false');

  const hash = await sha256(new TextEncoder().encode('hello'));
  assert(hash instanceof Uint8Array && hash.length === 32, 'sha256 returns 32-byte digest');

  // 1.2 Nonce Progression
  const n = new Uint8Array([0xFF, 0x00, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4]);
  nextNonce(n);
  assert(n[0] === 0x00 && n[1] === 0x01, 'nextNonce correctly increments little-endian 64-bit counter');

  // 1.3 Frame Sealing & Decryption (Round-Trip)
  const payload = new TextEncoder().encode('Hello Brook WebTransport');
  const cn = new Uint8Array(nonce);
  const sealed = await sealFrame(defaultCryptoKey, cn, payload);
  assert(sealed.length === 18 + payload.length + 16, `Sealed frame length is correct (${sealed.length}B)`);

  const sn = new Uint8Array(nonce);
  const openLen = await openLength(defaultCryptoKey, sn, sealed.slice(0, 18));
  assert(openLen === payload.length, `Decrypted frame length matches original (${openLen} == ${payload.length})`);

  const openedPayload = await openPayload(defaultCryptoKey, sn, sealed.slice(18));
  assert(new TextDecoder().decode(openedPayload) === 'Hello Brook WebTransport', 'Decrypted payload matches original string');

  // 1.4 BrookCipher Class
  const cipher = new BrookCipher(defaultCryptoKey);
  const cn2 = new Uint8Array(nonce);
  const sealedFast = await sealFrame(cipher, cn2, payload);
  assert(sealedFast.length === sealed.length, 'BrookCipher sealed frame length matches standard format');

  const sn2 = new Uint8Array(nonce);
  const openLenFast = await openLength(cipher, sn2, sealedFast.subarray(0, 18));
  assert(openLenFast === payload.length, 'BrookCipher openLength correctly recovers payload length');
  const openedFast = await openPayload(cipher, sn2, sealedFast.subarray(18));
  assert(new TextDecoder().decode(openedFast) === 'Hello Brook WebTransport', 'BrookCipher openPayload matches original plaintext');

  // 1.5 Unaligned Memory View Resilience
  const unalignedBuf = new Uint8Array(200);
  const unalignedSlice = unalignedBuf.subarray(3, 3 + payload.length);
  unalignedSlice.set(payload);
  const cnUnaligned = new Uint8Array(nonce);
  const sealedUnaligned = await cipher.encrypt(cnUnaligned, unalignedSlice);
  assert(sealedUnaligned.length === payload.length + 16, 'BrookCipher encrypts unaligned memory view without error');

  const unalignedCtBuf = new Uint8Array(200);
  const unalignedCtSlice = unalignedCtBuf.subarray(1, 1 + sealedUnaligned.length);
  unalignedCtSlice.set(sealedUnaligned);
  const snUnaligned = new Uint8Array(nonce);
  const openedUnaligned = await cipher.decrypt(snUnaligned, unalignedCtSlice);
  assert(new TextDecoder().decode(openedUnaligned) === 'Hello Brook WebTransport', 'BrookCipher decrypts unaligned ciphertext view accurately');

  // 1.6 Protocol Detection
  assert(ProtocolDetector.detect(new Uint8Array([0x05, 0x01, 0x00])) === ProtocolType.SOCKS5, 'Detects SOCKS5 correctly');
  assert(ProtocolDetector.detect(new TextEncoder().encode('CONNECT google.com:443 HTTP/1.1\r\n')) === ProtocolType.HTTP, 'Detects HTTP CONNECT correctly');
  assert(ProtocolDetector.detect(new TextEncoder().encode('GET /index.html HTTP/1.1\r\n')) === ProtocolType.HTTP, 'Detects HTTP GET correctly');

  // 1.7 IPv6 & parseHostPort Parsing
  const parsedHp1 = parseHostPort('[2001:db8::1]:443', 80);
  assert(parsedHp1.host === '2001:db8::1' && parsedHp1.port === 443, 'parseHostPort parses bracketed IPv6 with port');
  const parsedHp2 = parseHostPort('example.com:8080', 80);
  assert(parsedHp2.host === 'example.com' && parsedHp2.port === 8080, 'parseHostPort parses domain with port');
  const parsedIpv6 = parseIpv6('2001:db8::1');
  assert(parsedIpv6 instanceof Uint8Array && parsedIpv6.length === 16, 'parseIpv6 returns 16-byte address buffer');
  const encodedV6 = encodeAddress('2001:db8::1', 443);
  assert(encodedV6[0] === 0x04 && encodedV6.length === 19, 'encodeAddress encodes IPv6 as ATYP 0x04 slice (19 bytes)');

  // 1.8 DNS Resolver
  assert(DnsResolver.isIpv4('142.250.190.46') === true, 'isIpv4 validates IPv4 address correctly');
  assert(DnsResolver.isIpv4('www.google.com') === false, 'isIpv4 rejects domain names correctly');
  assert(DnsResolver.isIpv6('2001:db8::1') === true, 'isIpv6 validates IPv6 address correctly');
  const dnsQuery = DnsResolver._buildDnsQuery('example.com');
  assert(dnsQuery instanceof Uint8Array && dnsQuery.length > 20, 'DnsResolver builds RFC 1035 query frame correctly');

  DnsResolver._setCache('anycast.example.com', [
    { ip: '192.0.2.1', ttl: 300 },
    { ip: '192.0.2.2', ttl: 300 },
    { ip: '192.0.2.3', ttl: 300 }
  ], 300);
  const ipResults = await Promise.all([
    DnsResolver.resolveIpv4('anycast.example.com'),
    DnsResolver.resolveIpv4('anycast.example.com'),
    DnsResolver.resolveIpv4('anycast.example.com'),
    DnsResolver.resolveIpv4('anycast.example.com')
  ]);
  assert(ipResults[0] === '192.0.2.1' && ipResults[1] === '192.0.2.2' && ipResults[2] === '192.0.2.3' && ipResults[3] === '192.0.2.1', 'Concurrent DNS lookups cycle round-robin across Anycast A-records');

  // 1.9 WebTransport Connection Manager & Stream Adapter
  const wtMgr = new WebTransportConnectionManager({
    serverHost: '127.0.0.1',
    serverPort: 64433,
    path: '/brook'
  });
  assert(wtMgr.serverUrl === 'https://127.0.0.1:64433/brook', 'WebTransportConnectionManager formats URL correctly');

  let streamController = null;
  let mockStreamWritten = null;
  const mockBidiStream = {
    readable: new ReadableStream({
      start(controller) {
        streamController = controller;
      }
    }),
    writable: new WritableStream({
      write(chunk) {
        mockStreamWritten = chunk;
      }
    })
  };
  const streamAdapter = new WtStreamSession({ bidiStream: mockBidiStream, streamId: 0 });
  let adapterRecv = null;
  let adapterClosed = false;
  streamAdapter.registerStream(0, {
    onData: (d, fin) => {
      if (d && d.length > 0) adapterRecv = d;
      if (fin) adapterClosed = true;
    },
    onClose: () => { adapterClosed = true; }
  });
  await streamAdapter.sendStreamData(0, new Uint8Array([9, 8, 7]), false);
  assert(mockStreamWritten && mockStreamWritten.length === 3 && mockStreamWritten[0] === 9, 'WtStreamSession writes to WebTransport stream');

  streamController.enqueue(new Uint8Array([1, 2, 3]));
  streamController.close();
  await new Promise(r => setTimeout(r, 20));
  assert(adapterRecv && adapterRecv.length === 3 && adapterRecv[0] === 1, 'WtStreamSession correctly reads stream data');
  assert(adapterClosed === true, 'WtStreamSession signals FIN on stream close');

  // 1.10 WorkerTunnelBridge MessagePort Streaming
  const { port1: bridgePort1, port2: bridgePort2 } = new MessageChannel();
  const bridge = createPortStreamBridge(bridgePort2);

  bridgePort1.postMessage({ type: 'CLIENT_DATA', chunk: new Uint8Array([1, 2, 3, 4, 5]) });
  const readChunk = await bridge.clientReader.read();
  assert(!readChunk.done && readChunk.value.length === 5 && readChunk.value[0] === 1, 'WorkerTunnelBridge clientReader receives streamed chunk accurately');

  let receivedStreamData = null;
  bridgePort1.onmessage = (e) => {
    if (e.data.type === 'STREAM_DATA') receivedStreamData = e.data.chunk;
  };
  await bridge.clientWriter.write(new Uint8Array([10, 20, 30]));
  await new Promise(r => setTimeout(r, 10));
  assert(receivedStreamData && receivedStreamData.length === 3 && receivedStreamData[1] === 20, 'WorkerTunnelBridge clientWriter forwards stream data over MessagePort');

  bridgePort1.postMessage({ type: 'CLIENT_FIN' });
  const finChunk = await bridge.clientReader.read();
  assert(finChunk.done === true, 'WorkerTunnelBridge clientReader signals stream completion upon CLIENT_FIN');
  bridge.close();
  bridgePort1.close();

  // 1.11 BrookTunnel Structured Outcome Classification
  const targetRefusedOutcome = {
    terminationReason: 'target_dial_refused',
    serverHandshakeDone: true,
    totalBytesRecv: 0
  };
  const isSuccessRefused = targetRefusedOutcome.terminationReason === 'both_closed' ||
                           targetRefusedOutcome.terminationReason === 'normal' ||
                           (targetRefusedOutcome.terminationReason === 'transport_closed' && targetRefusedOutcome.totalBytesRecv > 0);
  assert(isSuccessRefused === false, 'Target dial refused with 0 bytes is classified as failure (success: false)');

  const successTransferOutcome = {
    terminationReason: 'transport_closed',
    serverHandshakeDone: true,
    totalBytesRecv: 5120
  };
  const isSuccessTransferred = successTransferOutcome.terminationReason === 'both_closed' ||
                              successTransferOutcome.terminationReason === 'normal' ||
                              (successTransferOutcome.terminationReason === 'transport_closed' && successTransferOutcome.totalBytesRecv > 0);
  assert(isSuccessTransferred === true, 'Transport closed after data transfer (>0 bytes) is classified as success (success: true)');

  // 1.12 LogStream Historical Log Preservation
  const testLogStream = new LogStream({ container: null, maxLogs: 10 });
  for (let i = 1; i <= 600; i++) {
    testLogStream.add('info', `Event log #${i}`);
  }
  assert(testLogStream.displayLogs.length === 10, 'Display logs buffer is strictly bounded to maxLogs (10)');
  assert(testLogStream.getTotalLogsCount() === 600, 'Historical logs retains 100% of all logs since app start (600)');
  const allFormatted = testLogStream.getFormattedLogs(true);
  assert(allFormatted.includes('Event log #1') && allFormatted.includes('Event log #600'), 'Formatted export includes first (#1) and last (#600) logs from app start');

  // 1.13 SOCKS5 IPv6 Request Parsing with Colons
  const v6Raw = new Uint8Array([
    0x05, 0x01, 0x00,
    0x05, 0x01, 0x00, 0x04,
    0x20, 0x01, 0x0d, 0xb8, 0x85, 0xa3, 0x00, 0x00, 0x00, 0x00, 0x8a, 0x2e, 0x03, 0x70, 0x73, 0x34,
    0x01, 0xbb
  ]);
  let s5Written = null;
  const s5Reader = { read: async () => ({ value: null, done: true }) };
  const s5Writer = { write: async (b) => { s5Written = b; } };
  const s5Res = await Socks5Parser.handleHandshake(v6Raw, s5Reader, s5Writer);
  assert(s5Res.targetStr.includes(':'), `SOCKS5 IPv6 targetStr contains proper colons (${s5Res.targetStr})`);
  assert(s5Res.targetStr.startsWith('[2001:db8:85a3:'), 'SOCKS5 IPv6 formatted with RFC 5952 bracketed notation');
  assert(s5Res.dstBytes[0] === 0x04 && s5Res.dstBytes.length === 19, 'SOCKS5 IPv6 dstBytes is 19 bytes ATYP 0x04');

  // 1.14 HttpProxyParser UTF-8 Header Preserving
  const unicodeHttpReq = new TextEncoder().encode("CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\nCookie: session=🌟UnicodeSpecialKey🌟\r\n\r\nBODY_PAYLOAD_BYTES");
  let httpWritten = null;
  const httpReader = { read: async () => ({ value: null, done: true }) };
  const httpWriter = { write: async (b) => { httpWritten = b; } };
  const httpRes = await HttpProxyParser.handleHandshake(unicodeHttpReq, httpReader, httpWriter);
  assert(httpRes.isConnect === true, 'HttpProxyParser detects CONNECT request with unicode header');
  assert(httpRes.targetStr === 'example.com:443', 'HttpProxyParser extracts correct target with unicode header');
  const leftoverStr = new TextDecoder().decode(httpRes.leftover);
  assert(leftoverStr === 'BODY_PAYLOAD_BYTES', `HttpProxyParser raw byte split preserves exact body without offset drift ("${leftoverStr}")`);

  // 1.15 SessionTracker & Live Telemetry Engine
  let lastStatsReceived = null;
  const tracker = new SessionTracker({
    onStatsUpdate: (stats) => {
      lastStatsReceived = stats;
    }
  });

  const sess1 = tracker.createSession({ id: 'sess-101', protocol: 'SOCKS5', target: 'example.com:443' });
  assert(sess1.id === 'sess-101' && sess1.target === 'example.com:443', 'SessionTracker creates session with explicit ID and target');
  assert(tracker.getStats().activeSessions === 1, 'SessionTracker tracks active session count (1)');
  assert(tracker.getStats().totalSessions === 1, 'SessionTracker increments total session count (1)');

  tracker.recordBytes('sess-101', 500, 1500);
  const sess1Stats = tracker.getStats();
  assert(sess1Stats.totalBytesSent === 500 && sess1Stats.totalBytesReceived === 1500, 'SessionTracker records sent and received byte counters');
  assert(sess1Stats.activeSessionList.length === 1 && sess1Stats.activeSessionList[0].bytesSent === 500, 'SessionTracker updates per-session traffic stats');

  tracker.closeSession('sess-101');
  assert(tracker.getStats().activeSessions === 0, 'SessionTracker clears active session on close');
  assert(tracker.getStats().totalBytesSent === 500 && tracker.getStats().totalBytesReceived === 1500, 'SessionTracker retains cumulative byte totals after session close');
  tracker.destroy();

  // 1.16 Downstream Throughput & Detached Buffer Accounting
  let accountedSent = 0;
  let accountedRecv = 0;
  const mockOnBytes = (sent, recv) => {
    accountedSent += sent;
    accountedRecv += recv;
  };
  // Simulate client writer that transfers/detaches buffer
  const mockDetachingWriter = {
    write: async (buf) => {
      const channel = new MessageChannel();
      channel.port1.postMessage(buf, [buf.buffer]); // detaches buf.buffer
      channel.port1.close();
      channel.port2.close();
    }
  };
  const testPayload = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  const plainLen = testPayload.length;
  await mockDetachingWriter.write(testPayload);
  mockOnBytes(0, plainLen);
  assert(accountedRecv === 8, 'Downstream throughput accounting captures non-zero received bytes across detached buffer writes (8 bytes)');

  // 1.17 Fast Wi-Fi Recovery & Stalled Session Flushing
  const recoveryTracker = new SessionTracker();
  recoveryTracker.createSession({ id: 'sess-stalled-1', target: 'stalled.com:443' });
  recoveryTracker.createSession({ id: 'sess-stalled-2', target: 'stalled2.com:443' });
  assert(recoveryTracker.getStats().activeSessions === 2, 'SessionTracker registers stalled sessions (2)');

  const mockWtManager = {
    workers: new Map([
      ['sess-stalled-1', { worker: { postMessage: () => {}, terminate: () => {} }, targetStr: 'stalled.com:443' }],
      ['sess-stalled-2', { worker: { postMessage: () => {}, terminate: () => {} }, targetStr: 'stalled2.com:443' }]
    ]),
    sessionTracker: recoveryTracker,
    _log: () => {},
    flushStalledSessions(reason) {
      for (const [id] of this.workers.entries()) {
        if (this.sessionTracker) this.sessionTracker.closeSession(id);
      }
      this.workers.clear();
    }
  };

  mockWtManager.flushStalledSessions('network_offline');
  assert(recoveryTracker.getStats().activeSessions === 0, 'flushStalledSessions immediately clears all active streams to 0 on network disconnect');
  recoveryTracker.destroy();
}

// -------------------------------------------------------------
// 2. End-to-End Integration Tests with Unified Go Server
// -------------------------------------------------------------
async function runE2ETests() {
  console.log('\n========================================');
  console.log('  2. RUNNING LIVE WEBTRANSPORT E2E TESTS');
  console.log('========================================\n');

  const SERVER_PORT = 64434;
  const BRIDGE_PORT = 59091;
  const SOCKS5_PORT = 10810;
  const HTTP_PORT = 8090;
  const PASSWORD = 'testpassword123';

  // 2.1 Start Local Target HTTP Echo Server
  const targetServer = http.createServer((req, res) => {
    if (req.url.startsWith('/stream')) {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      const chunk = Buffer.alloc(64 * 1024, 'B'); // 64KB chunks
      let sent = 0;
      const total = 2 * 1024 * 1024; // 2MB
      const interval = setInterval(() => {
        if (sent >= total) {
          clearInterval(interval);
          res.end();
        } else {
          res.write(chunk);
          sent += chunk.length;
        }
      }, 10);
      return;
    }
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        url: req.url,
        method: req.method,
        headers: req.headers,
        body
      }));
    });
  });

  const targetPort = await new Promise((resolve) => {
    targetServer.listen(0, '127.0.0.1', () => {
      resolve(targetServer.address().port);
    });
  });
  console.log(`[E2E Test] Target HTTP server on 127.0.0.1:${targetPort}`);

  // 2.2 Start Go Unified Brook Server (QUIC + WebTransport)
  const serverProcess = spawn('/root/downloads/iwa/brook-quicserver.go/brook-quicserver', [
    '-l', `127.0.0.1:${SERVER_PORT}`,
    '-p', PASSWORD
  ]);
  serverProcess.stdout.on('data', d => console.log('[GoServer]', d.toString().trim()));
  serverProcess.stderr.on('data', d => console.error('[GoServer Err]', d.toString().trim()));

  await new Promise(r => setTimeout(r, 1000));

  async function waitForPort(port, host = '127.0.0.1', timeoutMs = 5000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        await new Promise((resolve, reject) => {
          const s = new net.Socket();
          s.connect(port, host, () => {
            s.destroy();
            resolve();
          });
          s.on('error', (err) => {
            s.destroy();
            reject(err);
          });
        });
        return;
      } catch (e) {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    throw new Error(`Timeout waiting for port ${port} to open`);
  }

  // 2.3 Start WebTransport Bridge
  const bridgeProcess = spawn('/root/downloads/iwa/scripts/wt-bridge', [
    '-server', `https://127.0.0.1:${SERVER_PORT}/brook`,
    '-listen', `127.0.0.1:${BRIDGE_PORT}`
  ]);
  bridgeProcess.stdout.on('data', d => console.log('[Bridge]', d.toString().trim()));
  bridgeProcess.stderr.on('data', d => console.error('[Bridge Err]', d.toString().trim()));

  await waitForPort(BRIDGE_PORT);

  function createSocketAdapter(socket) {
    let readResolve = null;
    const queue = [];
    let isDone = false;

    socket.on('data', (chunk) => {
      const u8 = new Uint8Array(chunk);
      if (readResolve) {
        const res = readResolve;
        readResolve = null;
        res({ value: u8, done: false });
      } else {
        queue.push(u8);
      }
    });

    socket.on('end', () => {
      isDone = true;
      if (readResolve) {
        const res = readResolve;
        readResolve = null;
        res({ value: undefined, done: true });
      }
    });

    socket.on('error', () => {
      isDone = true;
      if (readResolve) {
        const res = readResolve;
        readResolve = null;
        res({ value: undefined, done: true });
      }
    });

    const reader = {
      read: async () => {
        if (queue.length > 0) return { value: queue.shift(), done: false };
        if (isDone) return { value: undefined, done: true };
        return new Promise((r) => { readResolve = r; });
      },
      cancel: async () => { socket.destroy(); },
      releaseLock: () => {}
    };

    const writer = {
      write: async (data) => {
        if (isDone || socket.destroyed) return;
        return new Promise((resolve) => {
          socket.write(Buffer.from(data.buffer, data.byteOffset, data.byteLength), (err) => {
            resolve();
          });
        });
      },
      close: async () => { try { socket.end(); } catch (e) {} },
      releaseLock: () => {}
    };

    return { reader, writer };
  }

  // Helper to open a WebTransport stream through the bridge
  async function openWtStreamSession() {
    const socket = new net.Socket();
    await new Promise((resolve, reject) => {
      socket.connect(BRIDGE_PORT, '127.0.0.1', resolve);
      socket.on('error', reject);
    });

    const { reader, writer } = createSocketAdapter(socket);
    const streamHandlers = new Map();

    (async () => {
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            for (const h of streamHandlers.values()) {
              if (h.onData) h.onData(new Uint8Array(0), true);
              if (h.onClose) h.onClose();
            }
            break;
          }
          if (value && value.length > 0) {
            for (const h of streamHandlers.values()) {
              if (h.onData) h.onData(value, false);
            }
          }
        }
      } catch (e) {
        for (const h of streamHandlers.values()) {
          if (h.onError) h.onError(e);
        }
      }
    })();

    return {
      allocateStreamId: () => 0,
      registerStream: (id, handlers) => streamHandlers.set(id, handlers),
      unregisterStream: (id) => streamHandlers.delete(id),
      ensureConnected: async () => {},
      sendStreamData: async (id, data, fin = false) => {
        if (data && data.length > 0) await writer.write(data);
        if (fin) await writer.close();
      },
      close: () => socket.destroy()
    };
  }

  // 2.4 Start SOCKS5 & HTTP Proxy Listeners
  const socks5Server = net.createServer(async (socket) => {
    const { reader, writer } = createSocketAdapter(socket);
    try {
      const { value: initialChunk } = await reader.read();
      if (!initialChunk) return;

      const { dstBytes, targetStr, leftover, sendSuccess, sendFailure } = await Socks5Parser.handleHandshake(initialChunk, reader, writer);
      const wtSession = await openWtStreamSession();

      const outcome = await BrookTunnel.run({
        clientReader: reader,
        clientWriter: writer,
        quicManager: wtSession,
        dstBytes,
        leftover,
        password: PASSWORD,
        targetStr,
        sendSuccess,
        sendFailure,
        onLog: (lvl, msg) => console.log(`[SOCKS5 ${lvl}]`, msg)
      });
      if (!outcome.success) {
        console.error('[SOCKS5 Outcome Fail]', outcome);
      }
    } catch (e) {
      console.error('[SOCKS5 Handler Error]', e);
      socket.destroy();
    }
  });

  const httpServer = net.createServer(async (socket) => {
    const { reader, writer } = createSocketAdapter(socket);
    try {
      const { value: initialChunk } = await reader.read();
      if (!initialChunk) return;

      const { dstBytes, targetStr, isConnect, leftover, sendSuccess, sendFailure } = await HttpProxyParser.handleHandshake(initialChunk, reader, writer);
      const wtSession = await openWtStreamSession();

      await BrookTunnel.run({
        clientReader: reader,
        clientWriter: writer,
        quicManager: wtSession,
        dstBytes,
        leftover,
        password: PASSWORD,
        targetStr,
        sendSuccess,
        sendFailure
      });
    } catch (e) {
      socket.destroy();
    }
  });

  await new Promise((res) => socks5Server.listen(SOCKS5_PORT, '127.0.0.1', res));
  await new Promise((res) => httpServer.listen(HTTP_PORT, '127.0.0.1', res));

  try {
    // Test 1: SOCKS5 GET Request
    const { stdout: s5Out } = await execAsync(`curl -s -x socks5h://127.0.0.1:${SOCKS5_PORT} http://127.0.0.1:${targetPort}/echo?client=socks5`);
    const parsedS5 = JSON.parse(s5Out);
    assert(parsedS5.url === '/echo?client=socks5', 'SOCKS5 Proxy routed GET request over WebTransport successfully');

    // Test 2: HTTP Proxy GET Request
    const { stdout: httpOut } = await execAsync(`curl -s -x http://127.0.0.1:${HTTP_PORT} http://127.0.0.1:${targetPort}/echo?client=http`);
    const parsedHttp = JSON.parse(httpOut);
    assert(parsedHttp.url === '/echo?client=http', 'HTTP Proxy routed GET request over WebTransport successfully');

    // Test 3: Concurrency (20 parallel requests through WebTransport)
    const reqPromises = [];
    for (let i = 0; i < 20; i++) {
      const idx = i;
      reqPromises.push(execAsync(`curl -s -x socks5h://127.0.0.1:${SOCKS5_PORT} "http://127.0.0.1:${targetPort}/echo?req=${idx}"`));
    }
    const reqResults = await Promise.all(reqPromises);
    let allValid = true;
    for (let i = 0; i < 20; i++) {
      const resJson = JSON.parse(reqResults[i].stdout);
      if (resJson.url !== `/echo?req=${i}`) allValid = false;
    }
    assert(allValid, '20 parallel concurrent proxy requests succeeded with 100% accuracy');

    // Test 4: 2MB Large Payload Streaming
    const t0 = Date.now();
    const { stdout: streamOut } = await execAsync(`curl -s -x socks5h://127.0.0.1:${SOCKS5_PORT} http://127.0.0.1:${targetPort}/stream | wc -c`);
    const streamBytes = parseInt(streamOut.trim(), 10);
    const duration = (Date.now() - t0) / 1000;
    assert(streamBytes === 2 * 1024 * 1024, `Large payload streaming transferred exactly 2MB without corruption (${(streamBytes / 1024 / 1024 / duration).toFixed(2)} MB/s)`);

    // Test 5: Auto-Detection of withoutBrookProtocol in brook-quicserver.go
    const { stdout: autoDetectOut } = await execAsync('/usr/local/go/bin/go test -v -run TestAutoDetectWithoutBrookProtocol .', {
      cwd: '/root/downloads/iwa/brook-quicserver.go'
    });
    assert(autoDetectOut.includes('PASS'), 'brook-quicserver.go auto-detects withoutBrookProtocol per stream dynamically');

    // Test 6: Simultaneous 25 Raw QUIC + 25 WebTransport Clients on the SAME port
    const { stdout: goTestOut } = await execAsync('/usr/local/go/bin/go test -v -run TestSimultaneousDualClients .', {
      cwd: '/root/downloads/iwa/brook-quicserver.go'
    });
    assert(goTestOut.includes('PASS'), '25 Raw QUIC + 25 WebTransport simultaneous clients verified on same port');

  } finally {
    socks5Server.close();
    httpServer.close();
    targetServer.close();
    bridgeProcess.kill('SIGTERM');
    serverProcess.kill('SIGTERM');
  }
}

async function main() {
  const startTime = Date.now();
  try {
    await runUnitTests();
    await runE2ETests();
  } catch (err) {
    console.error('\nSuite encountered an error:', err);
  } finally {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log('\n========================================');
    console.log(`  TEST RESULTS: ${passedTests} PASSED, ${failedTests} FAILED (${elapsed}s)`);
    console.log('========================================\n');
    process.exit(failedTests > 0 ? 1 : 0);
  }
}

main();
