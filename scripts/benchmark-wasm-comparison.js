/**
 * 4-Way Comprehensive Speed Benchmark:
 * 1. Official Go brook quicclient (compiled Go binary)
 * 2. Current Pure JavaScript Client (quic-engine.bundle.js)
 * 3. Cloudflare Quiche WASM Client (http3_client.wasm via WebAssembly)
 * 4. Cloudflare Quiche Native Client (io_uring / C++ native binding)
 */

import net from 'node:net';
import dgram from 'node:dgram';
import { spawn, exec } from 'node:child_process';
import { promisify } from 'node:util';
import { connectQuicAsync } from '@currentspace/http3';
import { ProxyDispatcher } from '../brook-quicclient/src/server/proxy-dispatcher.js';
import { QuicConnectionManager } from '../brook-quicclient/src/quic/quic-connection-manager.js';
import { SessionTracker } from '../brook-quicclient/src/server/session-tracker.js';

const execAsync = promisify(exec);

const SERVER_HOST = 'brook-quic.pplx.io';
const SERVER_PORT = 4433;
const PASSWORD = '271828brook';

const GO_PORT = 10881;
const JS_PORT = 10882;
const WASM_PORT = 10883;
const NATIVE_PORT = 10884;

// Polyfill Direct Sockets for Node.js
class NodeUDPSocket {
  constructor({ remoteAddress, remotePort }) {
    this.remoteAddress = remoteAddress;
    this.remotePort = remotePort;
    const socket = dgram.createSocket('udp4');

    const readable = new ReadableStream({
      start(controller) {
        socket.on('message', (msg, rinfo) => {
          try {
            controller.enqueue({
              data: new Uint8Array(msg),
              remoteAddress: rinfo.address,
              remotePort: rinfo.port
            });
          } catch (e) {}
        });
        socket.on('error', (err) => { try { controller.error(err); } catch (e) {} });
        socket.on('close', () => { try { controller.close(); } catch (e) {} });
      },
      cancel() {
        try { socket.close(); } catch (e) {}
      }
    });

    const writable = new WritableStream({
      write(chunk) {
        return new Promise((resolve, reject) => {
          const data = chunk.data || chunk;
          const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
          socket.send(buf, remotePort, remoteAddress, (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      },
      close() {
        try { socket.close(); } catch (e) {}
      }
    });

    this.opened = new Promise((resolve) => {
      socket.bind(0, () => {
        resolve({ readable, writable });
      });
    });
    this.socket = socket;
  }
  async close() {
    try { this.socket.close(); } catch (e) {}
  }
}

class NodeTCPServerSocket {
  constructor(localAddress, options = {}) {
    const server = net.createServer({ pauseOnConnect: true });

    const readable = new ReadableStream({
      start(controller) {
        server.on('connection', (socket) => {
          const socketReadable = new ReadableStream({
            start(sController) {
              socket.on('data', (data) => {
                try { sController.enqueue(new Uint8Array(data)); } catch (e) {}
              });
              socket.on('error', (err) => { try { sController.error(err); } catch (e) {} });
              socket.on('end', () => { try { sController.close(); } catch (e) {} });
            },
            cancel() {
              try { socket.destroy(); } catch (e) {}
            }
          });

          const socketWritable = new WritableStream({
            write(chunk) {
              return new Promise((resolve, reject) => {
                const u8 = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
                const buf = Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength);
                socket.write(buf, (err) => {
                  if (err) reject(err);
                  else resolve();
                });
              });
            },
            close() {
              return new Promise((resolve) => {
                socket.end(resolve);
              });
            },
            abort() {
              try { socket.destroy(); } catch (e) {}
            }
          });

          const clientSocket = {
            opened: Promise.resolve({
              readable: socketReadable,
              writable: socketWritable,
              remoteAddress: socket.remoteAddress,
              remotePort: socket.remotePort
            }),
            close: async () => {
              try { socket.destroy(); } catch (e) {}
            }
          };

          try {
            controller.enqueue(clientSocket);
            socket.resume();
          } catch (e) {}
        });

        server.on('error', (err) => {
          try { controller.error(err); } catch (e) {}
        });
      },
      cancel() {
        try { server.close(); } catch (e) {}
      }
    });

    this.opened = new Promise((resolve, reject) => {
      server.listen(options.localPort || 0, localAddress || '127.0.0.1', () => {
        const addr = server.address();
        resolve({
          readable,
          localAddress: addr.address,
          localPort: addr.port
        });
      });
      server.on('error', reject);
    });

    this.server = server;
  }

  async close() {
    try { this.server.close(); } catch (e) {}
  }
}

globalThis.UDPSocket = NodeUDPSocket;
globalThis.TCPServerSocket = NodeTCPServerSocket;

// Quiche Session Adapter
class QuicheSessionAdapter {
  constructor(session) {
    this.session = session;
    this.streamCallbacks = new Map();
    this.quicStreams = new Map();
    this.nextStreamId = 0;
  }

  allocateStreamId() {
    const id = this.nextStreamId;
    this.nextStreamId += 4;
    return id;
  }

  registerStream(streamId, callbacks) {
    this.streamCallbacks.set(streamId, callbacks);
    if (!this.session || this.session.closed) return;
    try {
      const quicStream = this.session.openStream();
      this.quicStreams.set(streamId, quicStream);
      quicStream.on('data', (chunk) => {
        if (callbacks.onData) callbacks.onData(new Uint8Array(chunk), false);
      });
      quicStream.on('end', () => {
        if (callbacks.onData) callbacks.onData(new Uint8Array(0), true);
        if (callbacks.onClose) callbacks.onClose();
      });
      quicStream.on('error', (err) => {
        if (callbacks.onError) callbacks.onError(err);
      });
    } catch (e) {
      if (callbacks.onError) callbacks.onError(e);
    }
  }

  unregisterStream(streamId) {
    const stream = this.quicStreams.get(streamId);
    if (stream) {
      try { stream.destroy(); } catch (e) {}
      this.quicStreams.delete(streamId);
    }
    this.streamCallbacks.delete(streamId);
  }

  async ensureConnected() {
    if (!this.session || this.session.closed) {
      throw new Error('QUIC session closed');
    }
  }

  async sendStreamData(streamId, data, fin = false) {
    let stream = this.quicStreams.get(streamId);
    if (!stream) {
      stream = this.session.openStream();
      this.quicStreams.set(streamId, stream);
      const callbacks = this.streamCallbacks.get(streamId);
      if (callbacks) {
        stream.on('data', (chunk) => {
          if (callbacks.onData) callbacks.onData(new Uint8Array(chunk), false);
        });
        stream.on('end', () => {
          if (callbacks.onData) callbacks.onData(new Uint8Array(0), true);
          if (callbacks.onClose) callbacks.onClose();
        });
        stream.on('error', (err) => {
          if (callbacks.onError) callbacks.onError(err);
        });
      }
    }
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    if (fin) {
      stream.end(buf);
    } else {
      stream.write(buf);
    }
  }

  async close() {}
}

class QuicheManagerAdapter {
  constructor({ serverHost, serverPort, runtimeMode = 'wasm', onLog }) {
    this.serverHost = serverHost;
    this.serverPort = serverPort;
    this.runtimeMode = runtimeMode;
    this.onLog = onLog || (() => {});
    this.session = null;
  }

  async createSession({ forceFresh = false } = {}) {
    if (!this.session || this.session.closed || forceFresh) {
      this.session = await connectQuicAsync(`https://${this.serverHost}:${this.serverPort}`, {
        alpn: ['h3'],
        rejectUnauthorized: false,
        runtimeMode: this.runtimeMode,
        initialMaxData: 64 * 1024 * 1024,
        initialMaxStreamDataBidiLocal: 32 * 1024 * 1024,
        initialMaxStreamsBidi: 1000
      });
    }
    return new QuicheSessionAdapter(this.session);
  }

  async close() {
    if (this.session) {
      await this.session.close();
      this.session = null;
    }
  }
}

async function runCurlBenchmark(socksPort, url, options = {}) {
  const maxTime = options.maxTime || 60;
  const cmd = `curl -s -L -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" -o /dev/null -w "%{http_code}|%{size_download}|%{speed_download}|%{time_connect}|%{time_starttransfer}|%{time_total}" -x socks5h://127.0.0.1:${socksPort} --max-time ${maxTime} "${url}"`;
  
  const t0 = Date.now();
  let stdout = '';
  try {
    const res = await execAsync(cmd);
    stdout = res.stdout;
  } catch (err) {
    if (err && err.stdout && err.stdout.includes('|')) {
      stdout = err.stdout;
    } else {
      stdout = '0|0|0|0|0|0';
    }
  }
  const elapsedMs = Date.now() - t0;

  const parts = stdout.trim().split('|');
  const httpCode = parseInt(parts[0], 10) || 0;
  const sizeBytes = parseInt(parts[1], 10) || 0;
  const speedBytesPerSec = parseFloat(parts[2]) || 0;
  const timeConnectSec = parseFloat(parts[3]) || 0;
  const timeTtfbSec = parseFloat(parts[4]) || 0;
  const timeTotalSec = parseFloat(parts[5]) || (elapsedMs / 1000);

  const speedMBps = speedBytesPerSec / (1024 * 1024);
  const speedMbps = (speedBytesPerSec * 8) / 1_000_000;

  return {
    httpCode,
    sizeBytes,
    speedBytesPerSec,
    speedMBps,
    speedMbps,
    timeConnectMs: Math.round(timeConnectSec * 1000),
    timeTtfbMs: Math.round(timeTtfbSec * 1000),
    timeTotalSec,
    elapsedMs
  };
}

async function main() {
  console.log('========================================================================');
  console.log('  ⚡ 4-WAY BROOK QUIC SPEED BENCHMARK: GO vs JS vs WASM (QUICHE) vs NATIVE');
  console.log(`  Target Brook Server: quic://${SERVER_HOST}:${SERVER_PORT}`);
  console.log('========================================================================\n');

  // 1. Launch Official Go Client
  console.log(`▶ [1/4] Launching Official Go brook quicclient on port ${GO_PORT}...`);
  const goProcess = spawn('/root/.nami/bin/brook', [
    'quicclient',
    '-s', `quic://${SERVER_HOST}:${SERVER_PORT}`,
    '-p', PASSWORD,
    '--socks5', `127.0.0.1:${GO_PORT}`,
    '--insecure'
  ], { stdio: 'ignore' });

  // 2. Launch Pure JS Client
  console.log(`▶ [2/4] Launching Pure JS Brook QUIC Client on port ${JS_PORT}...`);
  const jsQuicManager = new QuicConnectionManager({
    serverHost: SERVER_HOST,
    serverPort: SERVER_PORT,
    alpn: ['h3'],
    onLog: () => {}
  });
  const jsDispatcher = new ProxyDispatcher({
    quicManager: jsQuicManager,
    sessionTracker: new SessionTracker({ onStatsUpdate: () => {} }),
    password: PASSWORD,
    onLog: () => {}
  });
  await jsDispatcher.start({ socks5Port: JS_PORT, enableSocks5: true, enableHttp: false });

  // 3. Launch Quiche WASM Client
  console.log(`▶ [3/4] Launching Cloudflare Quiche WASM Client on port ${WASM_PORT}...`);
  const wasmQuicManager = new QuicheManagerAdapter({
    serverHost: SERVER_HOST,
    serverPort: SERVER_PORT,
    runtimeMode: 'wasm',
    onLog: () => {}
  });
  await wasmQuicManager.createSession();
  const wasmDispatcher = new ProxyDispatcher({
    quicManager: wasmQuicManager,
    sessionTracker: new SessionTracker({ onStatsUpdate: () => {} }),
    password: PASSWORD,
    onLog: () => {}
  });
  await wasmDispatcher.start({ socks5Port: WASM_PORT, enableSocks5: true, enableHttp: false });

  // 4. Launch Quiche Native Client
  console.log(`▶ [4/4] Launching Cloudflare Quiche Native Client on port ${NATIVE_PORT}...`);
  const nativeQuicManager = new QuicheManagerAdapter({
    serverHost: SERVER_HOST,
    serverPort: SERVER_PORT,
    runtimeMode: 'fast',
    onLog: () => {}
  });
  const nativeDispatcher = new ProxyDispatcher({
    quicManager: nativeQuicManager,
    sessionTracker: new SessionTracker({ onStatsUpdate: () => {} }),
    password: PASSWORD,
    onLog: () => {}
  });
  await nativeDispatcher.start({ socks5Port: NATIVE_PORT, enableSocks5: true, enableHttp: false });

  // Wait for listeners to bind and start
  await new Promise(r => setTimeout(r, 2000));

  // Warmup
  console.log('\n▶ Verifying warm connections for all 4 clients...');
  const warmupUrl = 'https://cloudflare.com/cdn-cgi/trace';
  const wGo = await runCurlBenchmark(GO_PORT, warmupUrl);
  const wJs = await runCurlBenchmark(JS_PORT, warmupUrl);
  const wWasm = await runCurlBenchmark(WASM_PORT, warmupUrl);
  const wNat = await runCurlBenchmark(NATIVE_PORT, warmupUrl);
  console.log(`  Go Client Warmup:     HTTP ${wGo.httpCode} in ${(wGo.elapsedMs / 1000).toFixed(3)}s`);
  console.log(`  JS Client Warmup:     HTTP ${wJs.httpCode} in ${(wJs.elapsedMs / 1000).toFixed(3)}s`);
  console.log(`  Quiche WASM Warmup:   HTTP ${wWasm.httpCode} in ${(wWasm.elapsedMs / 1000).toFixed(3)}s`);
  console.log(`  Quiche Native Warmup: HTTP ${wNat.httpCode} in ${(wNat.elapsedMs / 1000).toFixed(3)}s\n`);

  // ========================================================================
  // Benchmark 1: Latency & TTFB
  // ========================================================================
  console.log('========================================================================');
  console.log('  TEST 1: LATENCY & TTFB (5 iterations on https://cloudflare.com/cdn-cgi/trace)');
  console.log('========================================================================');

  const LATENCY_RUNS = 5;
  const goTtfbs = [], jsTtfbs = [], wasmTtfbs = [], natTtfbs = [];

  for (let i = 1; i <= LATENCY_RUNS; i++) {
    const resGo = await runCurlBenchmark(GO_PORT, warmupUrl);
    const resJs = await runCurlBenchmark(JS_PORT, warmupUrl);
    const resWasm = await runCurlBenchmark(WASM_PORT, warmupUrl);
    const resNat = await runCurlBenchmark(NATIVE_PORT, warmupUrl);

    goTtfbs.push(resGo.timeTtfbMs);
    jsTtfbs.push(resJs.timeTtfbMs);
    wasmTtfbs.push(resWasm.timeTtfbMs);
    natTtfbs.push(resNat.timeTtfbMs);

    console.log(`  Run ${i}: Go=${resGo.timeTtfbMs}ms | JS=${resJs.timeTtfbMs}ms | WASM=${resWasm.timeTtfbMs}ms | Native=${resNat.timeTtfbMs}ms`);
  }

  const avgGoTtfb = Math.round(goTtfbs.reduce((a, b) => a + b, 0) / LATENCY_RUNS);
  const avgJsTtfb = Math.round(jsTtfbs.reduce((a, b) => a + b, 0) / LATENCY_RUNS);
  const avgWasmTtfb = Math.round(wasmTtfbs.reduce((a, b) => a + b, 0) / LATENCY_RUNS);
  const avgNatTtfb = Math.round(natTtfbs.reduce((a, b) => a + b, 0) / LATENCY_RUNS);

  console.log(`\n  👉 Average TTFB: Go = ${avgGoTtfb}ms | JS = ${avgJsTtfb}ms | WASM = ${avgWasmTtfb}ms | Native = ${avgNatTtfb}ms\n`);

  // ========================================================================
  // Benchmark 2: Medium File Download (5 MB & 10 MB)
  // ========================================================================
  console.log('========================================================================');
  console.log('  TEST 2: MEDIUM FILE DOWNLOAD (5 MB & 10 MB)');
  console.log('========================================================================');

  // 5MB
  console.log('  --- Downloading 5 MB File ---');
  const url5MB = 'https://speed.cloudflare.com/__down?bytes=5242880';
  const go5MB = await runCurlBenchmark(GO_PORT, url5MB);
  const js5MB = await runCurlBenchmark(JS_PORT, url5MB);
  const wasm5MB = await runCurlBenchmark(WASM_PORT, url5MB);
  const nat5MB = await runCurlBenchmark(NATIVE_PORT, url5MB);

  console.log(`  Go Client (5MB):     ${(go5MB.sizeBytes / 1e6).toFixed(2)}MB in ${go5MB.timeTotalSec.toFixed(2)}s ➔ ${go5MB.speedMBps.toFixed(2)} MB/s (${go5MB.speedMbps.toFixed(1)} Mbps)`);
  console.log(`  JS Client (5MB):     ${(js5MB.sizeBytes / 1e6).toFixed(2)}MB in ${js5MB.timeTotalSec.toFixed(2)}s ➔ ${js5MB.speedMBps.toFixed(2)} MB/s (${js5MB.speedMbps.toFixed(1)} Mbps)`);
  console.log(`  Quiche WASM (5MB):   ${(wasm5MB.sizeBytes / 1e6).toFixed(2)}MB in ${wasm5MB.timeTotalSec.toFixed(2)}s ➔ ${wasm5MB.speedMBps.toFixed(2)} MB/s (${wasm5MB.speedMbps.toFixed(1)} Mbps)`);
  console.log(`  Quiche Native (5MB): ${(nat5MB.sizeBytes / 1e6).toFixed(2)}MB in ${nat5MB.timeTotalSec.toFixed(2)}s ➔ ${nat5MB.speedMBps.toFixed(2)} MB/s (${nat5MB.speedMbps.toFixed(1)} Mbps)`);

  // 10MB
  console.log('\n  --- Downloading 10 MB File ---');
  const url10MB = 'https://speed.cloudflare.com/__down?bytes=10485760';
  const go10MB = await runCurlBenchmark(GO_PORT, url10MB);
  const js10MB = await runCurlBenchmark(JS_PORT, url10MB);
  const wasm10MB = await runCurlBenchmark(WASM_PORT, url10MB);
  const nat10MB = await runCurlBenchmark(NATIVE_PORT, url10MB);

  console.log(`  Go Client (10MB):     ${(go10MB.sizeBytes / 1e6).toFixed(2)}MB in ${go10MB.timeTotalSec.toFixed(2)}s ➔ ${go10MB.speedMBps.toFixed(2)} MB/s (${go10MB.speedMbps.toFixed(1)} Mbps)`);
  console.log(`  JS Client (10MB):     ${(js10MB.sizeBytes / 1e6).toFixed(2)}MB in ${js10MB.timeTotalSec.toFixed(2)}s ➔ ${js10MB.speedMBps.toFixed(2)} MB/s (${js10MB.speedMbps.toFixed(1)} Mbps)`);
  console.log(`  Quiche WASM (10MB):   ${(wasm10MB.sizeBytes / 1e6).toFixed(2)}MB in ${wasm10MB.timeTotalSec.toFixed(2)}s ➔ ${wasm10MB.speedMBps.toFixed(2)} MB/s (${wasm10MB.speedMbps.toFixed(1)} Mbps)`);
  console.log(`  Quiche Native (10MB): ${(nat10MB.sizeBytes / 1e6).toFixed(2)}MB in ${nat10MB.timeTotalSec.toFixed(2)}s ➔ ${nat10MB.speedMBps.toFixed(2)} MB/s (${nat10MB.speedMbps.toFixed(1)} Mbps)\n`);

  // ========================================================================
  // Benchmark 3: Large File Sustained Throughput (25 MB)
  // ========================================================================
  console.log('========================================================================');
  console.log('  TEST 3: LARGE FILE SUSTAINED DOWNLOAD (25 MB)');
  console.log('========================================================================');

  console.log('  --- Downloading 25 MB File ---');
  const url25MB = 'https://speed.cloudflare.com/__down?bytes=26214400';
  const go25MB = await runCurlBenchmark(GO_PORT, url25MB, { maxTime: 60 });
  const js25MB = await runCurlBenchmark(JS_PORT, url25MB, { maxTime: 90 });
  const wasm25MB = await runCurlBenchmark(WASM_PORT, url25MB, { maxTime: 60 });
  const nat25MB = await runCurlBenchmark(NATIVE_PORT, url25MB, { maxTime: 60 });

  console.log(`  Go Client (25MB):     ${(go25MB.sizeBytes / 1e6).toFixed(2)}MB in ${go25MB.timeTotalSec.toFixed(2)}s ➔ ${go25MB.speedMBps.toFixed(2)} MB/s (${go25MB.speedMbps.toFixed(1)} Mbps)`);
  console.log(`  JS Client (25MB):     ${(js25MB.sizeBytes / 1e6).toFixed(2)}MB in ${js25MB.timeTotalSec.toFixed(2)}s ➔ ${js25MB.speedMBps.toFixed(2)} MB/s (${js25MB.speedMbps.toFixed(1)} Mbps)`);
  console.log(`  Quiche WASM (25MB):   ${(wasm25MB.sizeBytes / 1e6).toFixed(2)}MB in ${wasm25MB.timeTotalSec.toFixed(2)}s ➔ ${wasm25MB.speedMBps.toFixed(2)} MB/s (${wasm25MB.speedMbps.toFixed(1)} Mbps)`);
  console.log(`  Quiche Native (25MB): ${(nat25MB.sizeBytes / 1e6).toFixed(2)}MB in ${nat25MB.timeTotalSec.toFixed(2)}s ➔ ${nat25MB.speedMBps.toFixed(2)} MB/s (${nat25MB.speedMbps.toFixed(1)} Mbps)\n`);

  // ========================================================================
  // Benchmark Summary & Scorecard
  // ========================================================================
  console.log('==============================================================================================');
  console.log('  📊 4-WAY PERFORMANCE SCORECARD');
  console.log('==============================================================================================');
  console.log('| Metric               | Go Binary (Official) | JS Client (Old) | Quiche WASM      | Quiche Native   |');
  console.log('|----------------------|----------------------|-----------------|------------------|-----------------|');
  console.log(`| Avg Latency / TTFB   | ${avgGoTtfb} ms               | ${avgJsTtfb} ms          | ${avgWasmTtfb} ms           | ${avgNatTtfb} ms          |`);
  console.log(`| 5 MB Download Speed  | ${go5MB.speedMBps.toFixed(2)} MB/s            | ${js5MB.speedMBps.toFixed(2)} MB/s        | ${wasm5MB.speedMBps.toFixed(2)} MB/s         | ${nat5MB.speedMBps.toFixed(2)} MB/s       |`);
  console.log(`| 10 MB Download Speed | ${go10MB.speedMBps.toFixed(2)} MB/s            | ${js10MB.speedMBps.toFixed(2)} MB/s        | ${wasm10MB.speedMBps.toFixed(2)} MB/s         | ${nat10MB.speedMBps.toFixed(2)} MB/s       |`);
  console.log(`| 25 MB Download Speed | ${go25MB.speedMBps.toFixed(2)} MB/s           | ${js25MB.speedMBps.toFixed(2)} MB/s        | ${wasm25MB.speedMBps.toFixed(2)} MB/s         | ${nat25MB.speedMBps.toFixed(2)} MB/s       |`);
  console.log('==============================================================================================\n');

  // Cleanup
  console.log('▶ Cleaning up processes...');
  try { goProcess.kill('SIGKILL'); } catch (e) {}
  try { await jsDispatcher.stop(); } catch (e) {}
  try { await jsQuicManager.close(); } catch (e) {}
  try { await wasmDispatcher.stop(); } catch (e) {}
  try { await wasmQuicManager.close(); } catch (e) {}
  try { await nativeDispatcher.stop(); } catch (e) {}
  try { await nativeQuicManager.close(); } catch (e) {}
  console.log('✅ Benchmark completed successfully.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Benchmark Error:', err);
  process.exit(1);
});
