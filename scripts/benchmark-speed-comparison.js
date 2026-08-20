/**
 * Comprehensive Benchmark: IWA Brook QUIC Client (JavaScript) vs. Official Brook QUIC Client (Go)
 * 
 * Benchmarks:
 * 1. Low Latency & TTFB (Small web requests)
 * 2. Medium File Download Throughput (5MB & 10MB)
 * 3. Large File Sustained Throughput (25MB & 50MB)
 * 4. High-Concurrency Multi-Stream Download (10 parallel 2MB streams = 20MB)
 * 5. Real-World Parallel Web Asset Downloads
 */

import net from 'node:net';
import dgram from 'node:dgram';
import { spawn, exec } from 'node:child_process';
import { promisify } from 'node:util';
import { ProxyDispatcher } from '../brook-quicclient/src/server/proxy-dispatcher.js';
import { QuicConnectionManager } from '../brook-quicclient/src/quic/quic-connection-manager.js';
import { LogStream } from '../brook-quicclient/src/ui/log-stream.js';
import { SessionTracker } from '../brook-quicclient/src/server/session-tracker.js';

const execAsync = promisify(exec);

const SERVER_HOST = 'brook-quic.pplx.io';
const SERVER_PORT = 4433;
const PASSWORD = '271828brook';

const GO_SOCKS5_PORT = 10881;
const JS_SOCKS5_PORT = 10882;

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

        server.on('error', (err) => { try { controller.error(err); } catch (e) {} });
        server.on('close', () => { try { controller.close(); } catch (e) {} });
      },
      cancel() {
        try { server.close(); } catch (e) {}
      }
    });

    this.opened = new Promise((resolve, reject) => {
      server.listen(options.localPort || 0, localAddress, () => {
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
    return new Promise((resolve) => {
      this.server.close(resolve);
    });
  }
}

globalThis.UDPSocket = NodeUDPSocket;
globalThis.TCPServerSocket = NodeTCPServerSocket;

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
  console.log('  ⚡ BROOK QUIC CLIENT PERFORMANCE BENCHMARK: JS (IWA) vs. GO (OFFICIAL)');
  console.log(`  Target Brook Server: quic://${SERVER_HOST}:${SERVER_PORT}`);
  console.log('========================================================================\n');

  // 1. Start Official Go Brook QUIC Client
  console.log('▶ [1/6] Launching Official Go brook quicclient on port 10881...');
  const goProcess = spawn('/root/.nami/bin/brook', [
    'quicclient',
    '-s', `quic://${SERVER_HOST}:${SERVER_PORT}`,
    '-p', PASSWORD,
    '--socks5', `127.0.0.1:${GO_SOCKS5_PORT}`,
    '--insecure'
  ], { stdio: 'ignore' });

  // 2. Start IWA JavaScript Brook QUIC Client
  console.log('▶ [2/6] Launching IWA JavaScript Brook QUIC Client on port 10882...');
  const logStream = new LogStream({ container: null, maxLogs: 100 });
  const sessionTracker = new SessionTracker();

  const quicManager = new QuicConnectionManager({
    serverHost: SERVER_HOST,
    serverPort: SERVER_PORT,
    alpn: 'h3',
    password: PASSWORD,
    withoutBrook: false,
    onLog: (lvl, msg) => {}
  });

  await quicManager.connect();

  const proxyDispatcher = new ProxyDispatcher({
    quicManager,
    sessionTracker,
    logStream,
    password: PASSWORD,
    withoutBrook: false,
    onLog: (lvl, msg) => {}
  });

  await proxyDispatcher.start({
    socks5Port: JS_SOCKS5_PORT,
    httpPort: 19188
  });

  // Give proxies a moment to initialize
  await new Promise(r => setTimeout(r, 2000));

  // Warm-up check
  console.log('▶ [3/6] Verifying warm connections for both clients...');
  const warmGo = await runCurlBenchmark(GO_SOCKS5_PORT, 'https://example.com/');
  const warmJs = await runCurlBenchmark(JS_SOCKS5_PORT, 'https://example.com/');
  console.log(`  Go Client Warmup: HTTP ${warmGo.httpCode} in ${warmGo.timeTotalSec.toFixed(3)}s`);
  console.log(`  JS Client Warmup: HTTP ${warmJs.httpCode} in ${warmJs.timeTotalSec.toFixed(3)}s\n`);

  // ========================================================================
  // Benchmark 1: Latency & TTFB (Small Requests)
  // ========================================================================
  console.log('========================================================================');
  console.log('  TEST 1: LATENCY & TTFB (5 iterations on https://cloudflare.com/cdn-cgi/trace)');
  console.log('========================================================================');
  
  const test1Url = 'https://cloudflare.com/cdn-cgi/trace';
  const goTtfbList = [];
  const jsTtfbList = [];
  const goTotalList = [];
  const jsTotalList = [];

  for (let i = 1; i <= 5; i++) {
    const resGo = await runCurlBenchmark(GO_SOCKS5_PORT, test1Url);
    const resJs = await runCurlBenchmark(JS_SOCKS5_PORT, test1Url);

    goTtfbList.push(resGo.timeTtfbMs);
    jsTtfbList.push(resJs.timeTtfbMs);
    goTotalList.push(resGo.timeTotalSec * 1000);
    jsTotalList.push(resJs.timeTotalSec * 1000);

    console.log(`  Run ${i}: Go TTFB=${resGo.timeTtfbMs}ms (Total: ${(resGo.timeTotalSec*1000).toFixed(0)}ms) | JS TTFB=${resJs.timeTtfbMs}ms (Total: ${(resJs.timeTotalSec*1000).toFixed(0)}ms)`);
  }

  const avgGoTtfb = Math.round(goTtfbList.reduce((a, b) => a + b, 0) / goTtfbList.length);
  const avgJsTtfb = Math.round(jsTtfbList.reduce((a, b) => a + b, 0) / jsTtfbList.length);
  const avgGoTotal = Math.round(goTotalList.reduce((a, b) => a + b, 0) / goTotalList.length);
  const avgJsTotal = Math.round(jsTotalList.reduce((a, b) => a + b, 0) / jsTotalList.length);

  console.log(`\n  👉 Average TTFB:  Go = ${avgGoTtfb}ms | JS = ${avgJsTtfb}ms (${avgJsTtfb <= avgGoTtfb ? 'JS is faster!' : `+${avgJsTtfb - avgGoTtfb}ms`})`);
  console.log(`  👉 Average Total: Go = ${avgGoTotal}ms | JS = ${avgJsTotal}ms\n`);

  // ========================================================================
  // Benchmark 2: Medium File Download (5 MB & 10 MB)
  // ========================================================================
  console.log('========================================================================');
  console.log('  TEST 2: MEDIUM FILE DOWNLOAD (5 MB & 10 MB Cloudflare Speed Test)');
  console.log('========================================================================');

  // 5MB
  console.log('  --- Downloading 5 MB File ---');
  const url5MB = 'https://speed.cloudflare.com/__down?bytes=5242880';
  const go5MB = await runCurlBenchmark(GO_SOCKS5_PORT, url5MB);
  const js5MB = await runCurlBenchmark(JS_SOCKS5_PORT, url5MB);
  console.log(`  Go Client (5MB): ${(go5MB.sizeBytes / 1e6).toFixed(2)}MB in ${go5MB.timeTotalSec.toFixed(2)}s ➔ ${go5MB.speedMBps.toFixed(2)} MB/s (${go5MB.speedMbps.toFixed(1)} Mbps)`);
  console.log(`  JS Client (5MB): ${(js5MB.sizeBytes / 1e6).toFixed(2)}MB in ${js5MB.timeTotalSec.toFixed(2)}s ➔ ${js5MB.speedMBps.toFixed(2)} MB/s (${js5MB.speedMbps.toFixed(1)} Mbps)`);

  // 10MB
  console.log('\n  --- Downloading 10 MB File ---');
  const url10MB = 'https://speed.cloudflare.com/__down?bytes=10485760';
  const go10MB = await runCurlBenchmark(GO_SOCKS5_PORT, url10MB);
  const js10MB = await runCurlBenchmark(JS_SOCKS5_PORT, url10MB);
  console.log(`  Go Client (10MB): ${(go10MB.sizeBytes / 1e6).toFixed(2)}MB in ${go10MB.timeTotalSec.toFixed(2)}s ➔ ${go10MB.speedMBps.toFixed(2)} MB/s (${go10MB.speedMbps.toFixed(1)} Mbps)`);
  console.log(`  JS Client (10MB): ${(js10MB.sizeBytes / 1e6).toFixed(2)}MB in ${js10MB.timeTotalSec.toFixed(2)}s ➔ ${js10MB.speedMBps.toFixed(2)} MB/s (${js10MB.speedMbps.toFixed(1)} Mbps)\n`);

  // ========================================================================
  // Benchmark 3: Large File Sustained Throughput (25 MB)
  // ========================================================================
  console.log('========================================================================');
  console.log('  TEST 3: LARGE FILE SUSTAINED DOWNLOAD (25 MB)');
  console.log('========================================================================');

  console.log('  --- Downloading 25 MB File ---');
  const url25MB = 'https://speed.cloudflare.com/__down?bytes=26214400';
  const go25MB = await runCurlBenchmark(GO_SOCKS5_PORT, url25MB, { maxTime: 60 });
  const js25MB = await runCurlBenchmark(JS_SOCKS5_PORT, url25MB, { maxTime: 90 });
  console.log(`  Go Client (25MB): ${(go25MB.sizeBytes / 1e6).toFixed(2)}MB in ${go25MB.timeTotalSec.toFixed(2)}s ➔ ${go25MB.speedMBps.toFixed(2)} MB/s (${go25MB.speedMbps.toFixed(1)} Mbps)`);
  console.log(`  JS Client (25MB): ${(js25MB.sizeBytes / 1e6).toFixed(2)}MB in ${js25MB.timeTotalSec.toFixed(2)}s ➔ ${js25MB.speedMBps.toFixed(2)} MB/s (${js25MB.speedMbps.toFixed(1)} Mbps)\n`);

  // ========================================================================
  // Benchmark 4: High-Concurrency Multi-Stream Download (10 parallel x 2MB)
  // ========================================================================
  console.log('========================================================================');
  console.log('  TEST 4: HIGH-CONCURRENCY MULTI-STREAM (10 concurrent downloads x 2MB = 20MB)');
  console.log('========================================================================');

  const url2MB = 'https://speed.cloudflare.com/__down?bytes=2097152';
  const CONCURRENCY = 10;

  // Go Concurrency
  console.log(`  Running ${CONCURRENCY} parallel downloads through Go Client...`);
  const t0Go = Date.now();
  const goParallelResults = await Promise.all(
    Array.from({ length: CONCURRENCY }, () => runCurlBenchmark(GO_SOCKS5_PORT, url2MB, { maxTime: 30 }))
  );
  const elapsedGoParallelSec = (Date.now() - t0Go) / 1000;
  const goTotalBytes = goParallelResults.reduce((sum, r) => sum + r.sizeBytes, 0);
  const goAggregateSpeedMBps = (goTotalBytes / (1024 * 1024)) / elapsedGoParallelSec;
  const goSuccessCount = goParallelResults.filter(r => r.httpCode === 200).length;

  console.log(`  Go Client: ${goSuccessCount}/${CONCURRENCY} streams succeeded (${(goTotalBytes/1e6).toFixed(2)}MB in ${elapsedGoParallelSec.toFixed(2)}s) ➔ Aggregate: ${goAggregateSpeedMBps.toFixed(2)} MB/s (${(goAggregateSpeedMBps * 8).toFixed(1)} Mbps)`);

  // JS Concurrency
  console.log(`  Running ${CONCURRENCY} parallel downloads through JS Client...`);
  const t0Js = Date.now();
  const jsParallelResults = await Promise.all(
    Array.from({ length: CONCURRENCY }, () => runCurlBenchmark(JS_SOCKS5_PORT, url2MB, { maxTime: 90 }))
  );
  const elapsedJsParallelSec = (Date.now() - t0Js) / 1000;
  const jsTotalBytes = jsParallelResults.reduce((sum, r) => sum + r.sizeBytes, 0);
  const jsAggregateSpeedMBps = (jsTotalBytes / (1024 * 1024)) / elapsedJsParallelSec;
  const jsSuccessCount = jsParallelResults.filter(r => r.httpCode === 200).length;

  console.log(`  JS Client: ${jsSuccessCount}/${CONCURRENCY} streams succeeded (${(jsTotalBytes/1e6).toFixed(2)}MB in ${elapsedJsParallelSec.toFixed(2)}s) ➔ Aggregate: ${jsAggregateSpeedMBps.toFixed(2)} MB/s (${(jsAggregateSpeedMBps * 8).toFixed(1)} Mbps)\n`);

  // ========================================================================
  // Benchmark 5: Real-World Web Asset Concurrency
  // ========================================================================
  console.log('========================================================================');
  console.log('  TEST 5: REAL-WORLD PARALLEL WEB REQUESTS (8 Distinct Popular Sites)');
  console.log('========================================================================');

  const siteUrls = [
    'https://www.google.com/',
    'https://example.com/',
    'https://www.wikipedia.org/',
    'https://www.cloudflare.com/',
    'https://www.bing.com/',
    'https://www.apple.com/',
    'https://www.microsoft.com/',
    'https://www.mozilla.org/'
  ];

  const t0GoSites = Date.now();
  const goSites = await Promise.all(siteUrls.map(u => runCurlBenchmark(GO_SOCKS5_PORT, u, { maxTime: 30 })));
  const elapsedGoSitesSec = (Date.now() - t0GoSites) / 1000;
  const goSiteSuccess = goSites.filter(r => r.httpCode === 200).length;

  const t0JsSites = Date.now();
  const jsSites = await Promise.all(siteUrls.map(u => runCurlBenchmark(JS_SOCKS5_PORT, u, { maxTime: 30 })));
  const elapsedJsSitesSec = (Date.now() - t0JsSites) / 1000;
  const jsSiteSuccess = jsSites.filter(r => r.httpCode === 200).length;

  console.log(`  Go Client: ${goSiteSuccess}/${siteUrls.length} sites loaded in ${elapsedGoSitesSec.toFixed(2)}s`);
  console.log(`  JS Client: ${jsSiteSuccess}/${siteUrls.length} sites loaded in ${elapsedJsSitesSec.toFixed(2)}s\n`);

  // ========================================================================
  // Benchmark Summary & Scorecard
  // ========================================================================
  console.log('========================================================================');
  console.log('  📊 SUMMARY PERFORMANCE SCORECARD');
  console.log('========================================================================');
  console.log('| Metric                              | Go Client (Official) | JS Client (IWA)      | Comparison / Ratio |');
  console.log('|-------------------------------------|----------------------|----------------------|--------------------|');
  console.log(`| Avg Latency / TTFB                  | ${avgGoTtfb} ms              | ${avgJsTtfb} ms              | ${(avgJsTtfb / avgGoTtfb * 100).toFixed(0)}% (${avgJsTtfb <= avgGoTtfb ? 'JS faster' : 'Go faster'}) |`);
  console.log(`| 5 MB Download Speed                 | ${go5MB.speedMBps.toFixed(2)} MB/s           | ${js5MB.speedMBps.toFixed(2)} MB/s           | ${(js5MB.speedMBps / go5MB.speedMBps * 100).toFixed(0)}% of Go speed  |`);
  console.log(`| 10 MB Download Speed                | ${go10MB.speedMBps.toFixed(2)} MB/s           | ${js10MB.speedMBps.toFixed(2)} MB/s           | ${(js10MB.speedMBps / go10MB.speedMBps * 100).toFixed(0)}% of Go speed  |`);
  console.log(`| 25 MB Download Speed                | ${go25MB.speedMBps.toFixed(2)} MB/s           | ${js25MB.speedMBps.toFixed(2)} MB/s           | ${(js25MB.speedMBps / go25MB.speedMBps * 100).toFixed(0)}% of Go speed  |`);
  console.log(`| 10x 2MB Concurrency Aggregate Speed | ${goAggregateSpeedMBps.toFixed(2)} MB/s          | ${jsAggregateSpeedMBps.toFixed(2)} MB/s          | ${(jsAggregateSpeedMBps / goAggregateSpeedMBps * 100).toFixed(0)}% of Go speed  |`);
  console.log(`| 10x 2MB Total Elapsed Time          | ${elapsedGoParallelSec.toFixed(2)} s             | ${elapsedJsParallelSec.toFixed(2)} s             | ${(elapsedJsParallelSec / elapsedGoParallelSec * 100).toFixed(0)}% of Go time   |`);
  console.log(`| 8 Parallel Sites Loaded Time        | ${elapsedGoSitesSec.toFixed(2)} s             | ${elapsedJsSitesSec.toFixed(2)} s             | ${(elapsedJsSitesSec / elapsedGoSitesSec * 100).toFixed(0)}% of Go time   |`);
  console.log('========================================================================\n');

  // Cleanup
  console.log('▶ Cleaning up processes...');
  try { goProcess.kill('SIGKILL'); } catch (e) {}
  try { await proxyDispatcher.stop(); } catch (e) {}
  try { await quicManager.close(); } catch (e) {}
  console.log('✅ Benchmark completed successfully.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Benchmark Error:', err);
  process.exit(1);
});
