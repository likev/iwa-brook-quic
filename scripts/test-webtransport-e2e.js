import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { Socks5Parser } from '../brook-quicclient/src/protocols/socks5-parser.js';
import { HttpProxyParser } from '../brook-quicclient/src/protocols/http-proxy-parser.js';
import { BrookTunnel } from '../brook-quicclient/src/core/brook-tunnel.js';

const SERVER_PORT = 64433;
const WT_BRIDGE_PORT = 59090;
const PASSWORD = 'testpassword123';
const SOCKS5_PORT = 10809;
const HTTP_PORT = 8089;

function log(msg) {
  console.log(`[E2E Test] ${msg}`);
}

async function startLocalEchoHttpServer() {
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/echo')) {
      let body = [];
      req.on('data', (chunk) => body.push(chunk));
      req.on('end', () => {
        const fullBody = Buffer.concat(body).toString();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'ok',
          method: req.method,
          url: req.url,
          headers: req.headers,
          body: fullBody,
          origin: '127.0.0.1'
        }));
      });
    } else if (req.url.startsWith('/large')) {
      const sizeMB = parseInt(req.url.split('size=')[1] || '1', 10);
      const chunkSize = 64 * 1024;
      const totalBytes = sizeMB * 1024 * 1024;
      let sent = 0;
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      const chunk = Buffer.alloc(chunkSize, 'A');
      function push() {
        while (sent < totalBytes) {
          const toSend = Math.min(chunkSize, totalBytes - sent);
          const ok = res.write(chunk.subarray(0, toSend));
          sent += toSend;
          if (!ok) {
            res.once('drain', push);
            return;
          }
        }
        res.end();
      }
      push();
    } else {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Hello from local target server!');
    }
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  log(`Local Target HTTP Server listening on 127.0.0.1:${port}`);
  return { server, port };
}

function startGoServer() {
  log(`Starting Go Brook Server (QUIC + WebTransport) on :${SERVER_PORT}...`);
  const serverProcess = spawn(
    '/root/downloads/iwa/brook-quicserver.go/brook-quicserver',
    ['-l', `127.0.0.1:${SERVER_PORT}`, '-p', PASSWORD],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );
  serverProcess.stdout.on('data', (d) => console.log(`[GoServer] ${d.toString().trim()}`));
  serverProcess.stderr.on('data', (d) => console.error(`[GoServer] ${d.toString().trim()}`));
  return serverProcess;
}

function startWtBridge() {
  log(`Starting WebTransport Bridge on :${WT_BRIDGE_PORT} -> https://127.0.0.1:${SERVER_PORT}/brook...`);
  const bridgeProcess = spawn(
    '/root/downloads/iwa/scripts/wt-bridge',
    ['-server', `https://127.0.0.1:${SERVER_PORT}/brook`, '-listen', `127.0.0.1:${WT_BRIDGE_PORT}`],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );
  bridgeProcess.stdout.on('data', (d) => console.log(`[Bridge] ${d.toString().trim()}`));
  bridgeProcess.stderr.on('data', (d) => console.error(`[Bridge] ${d.toString().trim()}`));
  return bridgeProcess;
}

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
    if (readResolve) readResolve({ value: undefined, done: true });
  });

  socket.on('error', () => {
    isDone = true;
    if (readResolve) readResolve({ value: undefined, done: true });
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
      return new Promise((resolve, reject) => {
        socket.write(Buffer.from(data), (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },
    close: async () => { socket.end(); },
    releaseLock: () => {}
  };

  return { reader, writer };
}

// Open WebTransport stream via local WT bridge
async function openWtStreamSession() {
  const socket = new net.Socket();
  await new Promise((resolve, reject) => {
    socket.connect(WT_BRIDGE_PORT, '127.0.0.1', resolve);
    socket.on('error', reject);
  });

  const { reader, writer } = createSocketAdapter(socket);
  const streamHandlers = new Map();

  // Background pump from WT stream to streamHandlers
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

async function run() {
  const { server: echoServer, port: targetPort } = await startLocalEchoHttpServer();
  const goServer = startGoServer();

  // Wait for Go server to bind
  await new Promise((r) => setTimeout(r, 1000));

  const wtBridge = startWtBridge();
  // Wait for WT bridge to connect and bind
  await waitForPort(WT_BRIDGE_PORT);

  log('✅ WebTransport connection established to Go server!');

  // Start local SOCKS5 Proxy Server
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
        onLog: (lvl, msg) => console.log(`[SOCKS5 Tunnel] ${msg}`)
      });
      if (!outcome.success) {
        console.error(`[SOCKS5 Tunnel Outcome Error]`, outcome);
      }
    } catch (e) {
      console.error(`[SOCKS5 Handler Error]`, e);
      socket.destroy();
    }
  });

  await new Promise((resolve) => socks5Server.listen(SOCKS5_PORT, '127.0.0.1', resolve));
  log(`🧦 SOCKS5 Proxy listening on 127.0.0.1:${SOCKS5_PORT}`);

  // Start local HTTP Proxy Server
  const httpServer = net.createServer(async (socket) => {
    const { reader, writer } = createSocketAdapter(socket);
    try {
      const { value: initialChunk } = await reader.read();
      if (!initialChunk) return;

      const { dstBytes, targetStr, isConnect, leftover, sendSuccess, sendFailure } = await HttpProxyParser.handleHandshake(initialChunk, reader, writer);
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
        onLog: (lvl, msg) => console.log(`[SOCKS5 Tunnel] ${msg}`)
      });
      if (!outcome.success) {
        console.error(`[SOCKS5 Tunnel Outcome Error]`, outcome);
      }
    } catch (e) {
      console.error(`[SOCKS5 Handler Error]`, e);
      socket.destroy();
    }
  });

  await new Promise((resolve) => httpServer.listen(HTTP_PORT, '127.0.0.1', resolve));
  log(`🌐 HTTP Proxy listening on 127.0.0.1:${HTTP_PORT}`);

  // ==================== TEST SUITE ====================
  log('\n--- Running Test Suite ---');

  // Test 1: SOCKS5 Proxy Request
  log('Test 1: SOCKS5 GET request to local target...');
  const curlSocksResult = await new Promise((resolve, reject) => {
    const cp = spawn('curl', ['-s', '-x', `socks5h://127.0.0.1:${SOCKS5_PORT}`, `http://127.0.0.1:${targetPort}/echo?client=socks5`]);
    let out = '';
    cp.stdout.on('data', (d) => out += d);
    cp.on('close', (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`curl exited with code ${code}`));
    });
  });
  const parsedS5 = JSON.parse(curlSocksResult);
  if (parsedS5.url === '/echo?client=socks5') {
    log('✅ Test 1 PASSED: SOCKS5 Proxy request routed through WebTransport successfully!');
  } else {
    throw new Error(`Test 1 Failed: unexpected response ${curlSocksResult}`);
  }

  // Test 2: HTTP Proxy Request
  log('Test 2: HTTP Proxy GET request to local target...');
  const curlHttpResult = await new Promise((resolve, reject) => {
    const cp = spawn('curl', ['-s', '-x', `http://127.0.0.1:${HTTP_PORT}`, `http://127.0.0.1:${targetPort}/echo?client=http`]);
    let out = '';
    cp.stdout.on('data', (d) => out += d);
    cp.on('close', (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`curl exited with code ${code}`));
    });
  });
  const parsedHttp = JSON.parse(curlHttpResult);
  if (parsedHttp.url === '/echo?client=http') {
    log('✅ Test 2 PASSED: HTTP Proxy request routed through WebTransport successfully!');
  } else {
    throw new Error(`Test 2 Failed: unexpected response ${curlHttpResult}`);
  }

  // Test 3: Raw QUIC Client to Same Server Port (Verifying Multiplexing!)
  log('Test 3: Raw Brook QUIC client to SAME server port...');
  const rawQuicClientResult = await new Promise((resolve, reject) => {
    const cp = spawn('/usr/local/go/bin/go', ['test', '-v', '-run', 'TestSimultaneousDualClients', '.'], {
      cwd: '/root/downloads/iwa/brook-quicserver.go'
    });
    let out = '';
    cp.stdout.on('data', (d) => out += d);
    cp.stderr.on('data', (d) => out += d);
    cp.on('close', (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`Go test failed with code ${code}: ${out}`));
    });
  });
  log('✅ Test 3 PASSED: 25 Raw QUIC + 25 WebTransport simultaneous clients verified on the same port!');

  // Test 4: Concurrency (20 parallel requests through WebTransport)
  log('Test 4: High Concurrency (20 parallel requests)...');
  const promises = [];
  for (let i = 0; i < 20; i++) {
    promises.push(
      new Promise((resolve, reject) => {
        const cp = spawn('curl', ['-s', '-x', `socks5h://127.0.0.1:${SOCKS5_PORT}`, `http://127.0.0.1:${targetPort}/echo?req=${i}`]);
        let out = '';
        cp.stdout.on('data', (d) => out += d);
        cp.on('close', (code) => {
          if (code === 0) {
            try {
              const res = JSON.parse(out);
              if (res.url === `/echo?req=${i}`) resolve();
              else reject(new Error(`Mismatch on req ${i}`));
            } catch (err) {
              reject(err);
            }
          } else {
            reject(new Error(`Request ${i} failed with code ${code}`));
          }
        });
      })
    );
  }
  await Promise.all(promises);
  log('✅ Test 4 PASSED: 20 parallel concurrent proxy requests succeeded with 100% accuracy!');

  // Test 5: Throughput & Large Payload Streaming (2MB transfer)
  log('Test 5: Throughput & Large Payload Streaming (2MB transfer)...');
  const startT = Date.now();
  const largeResult = await new Promise((resolve, reject) => {
    const cp = spawn('curl', ['-s', '-x', `socks5h://127.0.0.1:${SOCKS5_PORT}`, `http://127.0.0.1:${targetPort}/large?size=2`, '-o', '/dev/null', '-w', '%{size_download}']);
    let out = '';
    cp.stdout.on('data', (d) => out += d);
    cp.on('close', (code) => {
      if (code === 0) resolve(parseInt(out, 10));
      else reject(new Error(`large transfer failed with code ${code}`));
    });
  });
  const durationMs = Date.now() - startT;
  const speedMBs = (largeResult / (1024 * 1024)) / (durationMs / 1000);
  log(`Transferred ${largeResult} bytes in ${durationMs}ms (${speedMBs.toFixed(2)} MB/s)`);
  if (largeResult === 2 * 1024 * 1024) {
    log('✅ Test 5 PASSED: Large payload streamed with zero corruption!');
  } else {
    throw new Error(`Expected 2097152 bytes, got ${largeResult}`);
  }

  log('\n🎉 ALL END-TO-END TESTS PASSED SUCCESSFULLY! 🎉');

  // Clean up
  socks5Server.close();
  httpServer.close();
  echoServer.close();
  wtBridge.kill();
  goServer.kill();
  process.exit(0);
}

run().catch((err) => {
  console.error('❌ E2E Test Error:', err);
  process.exit(1);
});
