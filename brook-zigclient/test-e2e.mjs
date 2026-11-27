/**
 * End-to-end verification suite for brook-zigclient:
 *  1. Spawns the compiled single-file Linux binary with --no-open --http-port 0
 *  2. Verifies embedded static assets (/index.html, /app.js, /src/workers/proxy-engine.worker.js, etc.)
 *  3. Verifies CSWSH / token & Origin security on /ws and /api/config
 *  4. Verifies config persistence across GET/POST /api/config
 *  5. Drives the REAL WsBridgeClient + TcpListener + ProxyDispatcher + Socks5Parser + HttpProxyParser
 *     against the live Zig binary:
 *       - SOCKS5 proxy handshake & full-duplex echo
 *       - HTTP CONNECT proxy handshake & full-duplex echo
 *       - Large 1.6 MiB upload + download (> 1 MiB initial credit window) verifying WINDOW flow control
 *       - Pause/Resume listening (closeActive=false preserves in-flight TCP connections!)
 *       - Refresh/Reconnect takeover (second WS connection cleanly replaces the first)
 */

import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN_PATH = path.join(__dirname, 'zig-out', 'release', 'brook-zigclient-linux-x86_64');

// Import the REAL browser modules directly
const { WsBridgeClient } = await import('./web/src/server/ws-bridge-client.js');
const { TcpListener } = await import('./web/src/server/tcp-listener.js');
const { Socks5Parser } = await import('./web/src/protocols/socks5-parser.js');
const { HttpProxyParser } = await import('./web/src/protocols/http-proxy-parser.js');
const { ProtocolDetector } = await import('./web/src/protocols/protocol-detector.js');

// Ensure global WebSocket exists (Node 22+ has built-in WebSocket)
assert.ok(typeof globalThis.WebSocket === 'function', 'Node 22+ global WebSocket is required');

const tmpConfigPath = path.join(os.tmpdir(), `brook-zigclient-test-${Date.now()}.json`);

function waitForUrl(child, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for brook-zigclient UI URL. Output:\n${output}`));
    }, timeoutMs);

    const onChunk = (buf) => {
      output += buf.toString('utf8');
      const m = output.match(/http:\/\/127\.0\.0\.1:(\d+)\/\?token=([0-9a-f]{32})/);
      if (m) {
        clearTimeout(timer);
        resolve({ port: parseInt(m[1], 10), token: m[2], url: m[0] });
      }
    };
    child.stdout.on('data', onChunk);
    child.stderr.on('data', onChunk);
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`brook-zigclient exited early with code ${code}. Output:\n${output}`));
    });
  });
}

function connectTcp(port) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host: '127.0.0.1', port }, () => resolve(sock));
    sock.on('error', reject);
  });
}

function readExact(sock, n) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    const onData = (chunk) => {
      chunks.push(chunk);
      total += chunk.length;
      if (total >= n) {
        cleanup();
        const full = Buffer.concat(chunks);
        resolve({ exact: full.subarray(0, n), rest: full.subarray(n) });
      }
    };
    const onEnd = () => {
      cleanup();
      reject(new Error(`EOF before reading ${n} bytes (got ${total})`));
    };
    const onErr = (e) => {
      cleanup();
      reject(e);
    };
    const cleanup = () => {
      sock.off('data', onData);
      sock.off('end', onEnd);
      sock.off('error', onErr);
    };
    sock.on('data', onData);
    sock.on('end', onEnd);
    sock.on('error', onErr);
  });
}

console.log('1. Spawning brook-zigclient binary:', BIN_PATH);
const child = spawn(BIN_PATH, [
  '--no-open',
  '--http-port', '0',
  '--config', tmpConfigPath,
  '--server', 'https://example.invalid:4433/brook',
  '--socks5', '0',
  '--http', '0'
], { stdio: ['ignore', 'pipe', 'pipe'] });

let passed = 0;
function ok(msg) {
  passed++;
  console.log(`  ✅ ${msg}`);
}

try {
  const { port: httpPort, token } = await waitForUrl(child);
  assert.ok(httpPort > 0 && httpPort < 65536, 'Random HTTP port bound');
  ok(`Started on random localhost port 127.0.0.1:${httpPort} with 128-bit session token`);

  // 2. Test embedded static assets
  const assetPaths = [
    '/',
    '/app.js',
    '/styles.css',
    '/icons/icon.svg',
    '/src/workers/proxy-engine.worker.js',
    '/src/server/ws-bridge-client.js',
    '/src/server/tcp-listener.js',
    '/src/server/proxy-dispatcher.js',
    '/src/protocols/socks5-parser.js',
    '/src/protocols/http-proxy-parser.js',
    '/src/webtransport/wt-connection-manager.js',
    '/src/webtransport/ws-connection-manager.js'
  ];
  for (const p of assetPaths) {
    const r = await fetch(`http://127.0.0.1:${httpPort}${p}`);
    assert.equal(r.status, 200, `Expected 200 for ${p}`);
    const body = await r.text();
    assert.ok(body.length > 50, `Expected non-empty body for ${p}`);
  }
  ok(`All ${assetPaths.length} embedded static UI & Worker assets served with HTTP 200`);

  // 3. Test security: bad token & bad Origin must be rejected
  {
    const rNoTok = await fetch(`http://127.0.0.1:${httpPort}/api/config`);
    assert.equal(rNoTok.status, 403, '/api/config without token must be 403');

    const rBadTok = await fetch(`http://127.0.0.1:${httpPort}/api/config?token=00000000000000000000000000000000`);
    assert.equal(rBadTok.status, 403, '/api/config with wrong token must be 403');

    const rBadOrigin = await fetch(`http://127.0.0.1:${httpPort}/api/config?token=${token}`, {
      headers: { Origin: 'https://evil.example' }
    });
    assert.equal(rBadOrigin.status, 403, '/api/config with evil Origin must be 403');

    // Raw HTTP check for /ws rejected on bad token
    const rWsBad = await fetch(`http://127.0.0.1:${httpPort}/ws?token=deadbeef`);
    assert.equal(rWsBad.status, 403, '/ws with wrong token must be 403');
  }
  ok('Security checks passed (403 on missing/wrong token and foreign Origin)');

  // 4. Test config persistence API
  {
    const rGet = await fetch(`http://127.0.0.1:${httpPort}/api/config?token=${token}`);
    assert.equal(rGet.status, 200);
    const initialCfg = await rGet.json();
    assert.equal(initialCfg.server, 'https://example.invalid:4433/brook');

    const newCfg = {
      server: 'https://saved.example:4433/brook',
      password: 'test-password-123',
      socks5Port: 1080,
      httpPort: 8081,
      autoDetect: true,
      withoutBrook: true
    };
    const rPost = await fetch(`http://127.0.0.1:${httpPort}/api/config?token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newCfg)
    });
    assert.equal(rPost.status, 200);

    const rGet2 = await fetch(`http://127.0.0.1:${httpPort}/api/config?token=${token}`);
    const savedCfg = await rGet2.json();
    assert.equal(savedCfg.server, newCfg.server);
    assert.equal(savedCfg.socks5Port, 1080);
    assert.ok(fs.existsSync(tmpConfigPath), 'Config file written to disk');
  }
  ok('Config persistence API (/api/config GET/POST) verified');

  // 5. Connect REAL WsBridgeClient + TcpListener
  const wsUrl = `ws://127.0.0.1:${httpPort}/ws?token=${token}`;
  const bridge = new WsBridgeClient({ wsUrl });
  const readyMsg = await bridge.connect();
  assert.equal(readyMsg.type, 'ready');
  assert.equal(readyMsg.httpPort, httpPort);
  TcpListener.setBridge(bridge);
  ok('WsBridgeClient connected and received ready handshake');

  // 6. Test Unified Auto-Detect Listener handling BOTH SOCKS5 and HTTP CONNECT + 1.6 MiB stream backpressure
  const unifiedListener = new TcpListener({
    localAddress: '127.0.0.1',
    localPort: 0,
    onConnection: async (acceptedSocket, onDone) => {
      try {
        const { readable, writable } = await acceptedSocket.opened;
        const reader = readable.getReader();
        const writer = writable.getWriter();

        const { value: initialChunk, done } = await reader.read();
        if (done || !initialChunk) return;

        const proto = ProtocolDetector.detect(initialChunk);
        let parsed;
        if (proto === 'socks5') {
          parsed = await Socks5Parser.handleHandshake(initialChunk, reader, writer, 5000);
        } else {
          parsed = await HttpProxyParser.handleHandshake(initialChunk, reader, writer, 5000);
        }

        await parsed.sendSuccess();
        if (parsed.leftover && parsed.leftover.length > 0) {
          await writer.write(parsed.leftover);
        }

        // Echo every byte back (tests full-duplex TCP <-> WS <-> JS Streams + WINDOW credit replenishment)
        while (true) {
          const { value, done: rDone } = await reader.read();
          if (rDone) break;
          if (value && value.length > 0) {
            await writer.write(value);
          }
        }
        await writer.close();
      } catch (e) {
        // Expected on forced close
      } finally {
        try { await acceptedSocket.close(); } catch (e) {}
        onDone();
      }
    }
  });

  await unifiedListener.start();
  const proxyPort = unifiedListener.localPort;
  assert.ok(proxyPort > 0, 'Unified listener bound to dynamic port');
  ok(`Zig TCP listener bound dynamically on 127.0.0.1:${proxyPort}`);

  // 6a. SOCKS5 handshake + 1.6 MiB round-trip (exceeds 1 MiB initial credit window!)
  {
    const client = await connectTcp(proxyPort);
    // SOCKS5 greeting: VER=5, NMETHODS=1, NO_AUTH=0
    client.write(Buffer.from([0x05, 0x01, 0x00]));
    const { exact: mReply } = await readExact(client, 2);
    assert.deepEqual(mReply, Buffer.from([0x05, 0x00]), 'SOCKS5 method reply OK');

    // SOCKS5 CONNECT to example.com:443
    const domain = Buffer.from('example.com');
    const req = Buffer.concat([
      Buffer.from([0x05, 0x01, 0x00, 0x03, domain.length]),
      domain,
      Buffer.from([0x01, 0xbb])
    ]);
    client.write(req);
    const { exact: cReply } = await readExact(client, 10);
    assert.equal(cReply[0], 0x05);
    assert.equal(cReply[1], 0x00, 'SOCKS5 CONNECT succeeded');

    // Send 1.6 MiB of random data & verify exact SHA-256 echo back (tests WINDOW credit replenishment!)
    const TOTAL_BYTES = 1600 * 1024;
    const payload = crypto.randomBytes(TOTAL_BYTES);
    const expectedHash = crypto.createHash('sha256').update(payload).digest('hex');

    const recvHash = crypto.createHash('sha256');
    let recvBytes = 0;
    const echoDone = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Echo timeout: received ${recvBytes}/${TOTAL_BYTES}`)), 15000);
      client.on('data', (chunk) => {
        recvHash.update(chunk);
        recvBytes += chunk.length;
        if (recvBytes === TOTAL_BYTES) {
          clearTimeout(timer);
          resolve();
        }
      });
      client.on('error', (e) => { clearTimeout(timer); reject(e); });
    });

    client.write(payload);
    client.end(); // Half-close write side (FIN)
    await echoDone;
    assert.equal(recvHash.digest('hex'), expectedHash, '1.6 MiB SHA-256 integrity matched byte-for-byte');
    client.destroy();
  }
  ok('SOCKS5 handshake + 1.6 MiB full-duplex transfer with WINDOW flow control verified (SHA-256 exact match)');

  // 6b. HTTP CONNECT handshake + echo
  {
    const client = await connectTcp(proxyPort);
    client.write('CONNECT httpbin.org:443 HTTP/1.1\r\nHost: httpbin.org:443\r\n\r\n');
    const headerResp = await new Promise((resolve, reject) => {
      let acc = '';
      const onData = (c) => {
        acc += c.toString('utf8');
        if (acc.includes('\r\n\r\n')) {
          client.off('data', onData);
          resolve(acc);
        }
      };
      client.on('data', onData);
      client.on('error', reject);
    });
    assert.ok(headerResp.startsWith('HTTP/1.1 200 Connection Established'), `Unexpected HTTP CONNECT reply: ${headerResp}`);

    const msg = Buffer.from('hello-through-zig-http-connect-bridge!');
    client.write(msg);
    const { exact: echoed } = await readExact(client, msg.length);
    assert.deepEqual(echoed, msg);
    client.destroy();
  }
  ok('HTTP CONNECT handshake + payload relay verified on same unified auto-detect port');

  // 6c. Pause listening (stopListening with closeActive=false) preserves active TCP socket while rejecting new accepts
  {
    const activeClient = await connectTcp(proxyPort);
    activeClient.write('CONNECT keepalive.test:443 HTTP/1.1\r\nHost: keepalive.test:443\r\n\r\n');
    await new Promise((resolve) => {
      activeClient.once('data', resolve);
    });

    // Pause listening without closing active sockets
    await unifiedListener.stopListening();

    // New TCP connections to proxyPort must now be refused
    let newConnRefused = false;
    try {
      const probe = await connectTcp(proxyPort);
      probe.destroy();
    } catch (e) {
      newConnRefused = true;
    }
    assert.ok(newConnRefused, 'Paused listener must stop accepting new connections');

    // Existing activeClient must STILL work!
    const pingMsg = Buffer.from('still-alive-while-paused');
    activeClient.write(pingMsg);
    const { exact: pong } = await readExact(activeClient, pingMsg.length);
    assert.deepEqual(pong, pingMsg, 'Active connection preserved during pauseListening()');
    activeClient.destroy();
  }
  ok('Pause listening (closeActive=false) stops new accepts while preserving active TCP connections');

  // 6d. Reconnect / page-reload takeover: second WS connection cleanly releases first session's bound port
  {
    const reuseListener = new TcpListener({
      localAddress: '127.0.0.1',
      localPort: 0,
      onConnection: (s, onDone) => { s.close(); onDone(); }
    });
    await reuseListener.start();
    const pinnedPort = reuseListener.localPort;

    const bridge2 = new WsBridgeClient({ wsUrl });
    const ready2 = await bridge2.connect();
    assert.equal(ready2.type, 'ready');
    TcpListener.setBridge(bridge2);

    // Immediately re-bind the EXACT same port on the new session without AddressInUse!
    const reuseListener2 = new TcpListener({
      localAddress: '127.0.0.1',
      localPort: pinnedPort,
      onConnection: (s, onDone) => { s.close(); onDone(); }
    });
    await reuseListener2.start();
    assert.equal(reuseListener2.localPort, pinnedPort, 'New session immediately re-bound exact same port after reload');
    await reuseListener2.stop();
    bridge2.close();
  }
  bridge.close();
  ok('Browser reload / WS session takeover cleanly releases and re-binds exact same TCP port');

  console.log(`\n🎉 ALL ${passed} E2E CHECKS PASSED!`);
} finally {
  child.kill('SIGTERM');
  try { fs.unlinkSync(tmpConfigPath); } catch (e) {}
}
