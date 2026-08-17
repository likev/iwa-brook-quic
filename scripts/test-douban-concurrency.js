import net from 'node:net';
import dgram from 'node:dgram';
import dns from 'node:dns/promises';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

import { Socks5Parser } from '../brook-quicclient/src/protocols/socks5-parser.js';
import { QuicConnectionManager, getDcidHex } from '../brook-quicclient/src/quic/quic-connection-manager.js';
import { QUICConnection } from '../brook-quicclient/vendor/quic-engine.bundle.js';
import { BrookTunnel } from '../brook-quicclient/src/core/brook-tunnel.js';

const execAsync = promisify(exec);

const SERVER_HOST = 'brook-quic.pplx.io';
const SERVER_PORT = 4433;
const PASSWORD = '271828brook';
const SOCKS5_PORT = 19199;

console.log('=== Testing Douban Concurrent Resource Fetching ===\n');

const resolved = await dns.lookup(SERVER_HOST);
const udpSocket = dgram.createSocket('udp4');
const sessionsByCid = new Map();

udpSocket.on('message', (msg, rinfo) => {
  const u8 = new Uint8Array(msg);
  const dcidHex = getDcidHex(u8);
  if (dcidHex && sessionsByCid.has(dcidHex)) {
    const session = sessionsByCid.get(dcidHex);
    if (session && session.quic && !session.isClosed) {
      session.lastActivity = Date.now();
      session.quic.feedDatagram(rinfo.address, rinfo.port, u8);
    }
  }
});

await new Promise(r => udpSocket.bind(0, r));

class TestQuicSession {
  constructor() {
    this.quic = null;
    this.streamHandlers = new Map();
    this.isClosed = false;
    this.isConnected = false;
    this.lastActivity = Date.now();
    this.createdAt = Date.now();
    this.scidHex = null;
    this.dcidHex = null;
  }

  isAlive() {
    if (this.isClosed || !this.isConnected || !this.quic) return false;
    if (this.quic.state === 'closed' || this.quic.state === 'draining' || this.quic.state === 'closing') return false;
    return (Date.now() - this.lastActivity) < 28000;
  }

  async connect(timeoutMs = 6000) {
    return new Promise((resolve, reject) => {
      let isResolved = false;
      const timer = setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          this.close();
          reject(new Error(`QUIC handshake timeout (${timeoutMs}ms)`));
        }
      }, timeoutMs);

      this.quic = new QUICConnection({
        isServer: false,
        hostname: SERVER_HOST,
        alpn: ['h3'],
        keepAlive: 8000,
        idleTimeout: 45000,
        rejectUnauthorized: false
      });

      this.quic.on('packet', (data) => {
        this.lastActivity = Date.now();
        if (!this.isClosed) {
          udpSocket.send(data, SERVER_PORT, resolved.address);
        }
      });

      this.quic.on('connect', () => {
        clearTimeout(timer);
        if (!isResolved) {
          isResolved = true;
          this.isConnected = true;
          this.lastActivity = Date.now();
          resolve(this);
        }
      });

      this.quic.on('stream', (streamId, data, fin) => {
        this.lastActivity = Date.now();
        const h = this.streamHandlers.get(streamId);
        if (h && h.onData) h.onData(data, fin);
      });

      this.quic.on('error', (err) => {
        clearTimeout(timer);
        if (!isResolved) {
          isResolved = true;
          this.close();
          reject(err);
        }
      });

      this.quic.on('close', () => {
        clearTimeout(timer);
        if (!isResolved) {
          isResolved = true;
          reject(new Error('QUIC connection closed'));
        }
        this.close();
      });

      this.quic.connect();

      if (this.quic.context) {
        if (this.quic.context.my_cids && this.quic.context.my_cids[0]) {
          this.scidHex = Array.from(this.quic.context.my_cids[0]).map(b => b.toString(16).padStart(2, '0')).join('');
          sessionsByCid.set(this.scidHex, this);
        }
        if (this.quic.context.original_dcid) {
          this.dcidHex = Array.from(this.quic.context.original_dcid).map(b => b.toString(16).padStart(2, '0')).join('');
          sessionsByCid.set(this.dcidHex, this);
        }
      }
    });
  }

  allocateStreamId() { return 0; }
  registerStream(streamId, handlers) { this.streamHandlers.set(streamId, handlers); }
  unregisterStream(streamId) { this.streamHandlers.delete(streamId); }
  async sendStreamData(streamId, data, fin = false) {
    if (this.isClosed || !this.quic) throw new Error('QUIC session closed');
    this.lastActivity = Date.now();
    this.quic.sendStream(streamId, data instanceof Uint8Array ? data : new Uint8Array(data), fin);
  }
  async ensureConnected() {}

  close() {
    if (this.isClosed) return;
    this.isClosed = true;
    if (this.scidHex) sessionsByCid.delete(this.scidHex);
    if (this.dcidHex) sessionsByCid.delete(this.dcidHex);
    for (const h of this.streamHandlers.values()) {
      if (h.onClose) h.onClose();
    }
    this.streamHandlers.clear();
    if (this.quic) {
      try { this.quic.close(0, 'close'); } catch (e) {}
      this.quic = null;
    }
  }
}

class SessionPool {
  constructor(targetWarm = 6) {
    this.targetWarm = targetWarm;
    this.pool = [];
    this.isRefilling = false;
  }

  async refill() {
    if (this.isRefilling) return;
    this.isRefilling = true;
    try {
      while (this.pool.length < this.targetWarm) {
        try {
          const session = new TestQuicSession();
          await session.connect(5000);
          this.pool.push(session);
        } catch (e) {
          break;
        }
      }
    } finally {
      this.isRefilling = false;
    }
  }

  async acquire() {
    while (this.pool.length > 0) {
      const session = this.pool.shift();
      if (session && session.isAlive()) {
        this.refill().catch(() => {});
        return session;
      } else if (session) {
        session.close();
      }
    }
    const session = new TestQuicSession();
    await session.connect(5000);
    this.refill().catch(() => {});
    return session;
  }
}

function createSocketAdapter(socket) {
  let readResolve = null;
  const queue = [];
  let isDone = false;

  socket.on('data', (chunk) => {
    const u8 = new Uint8Array(chunk);
    if (readResolve) {
      const r = readResolve;
      readResolve = null;
      r({ value: u8, done: false });
    } else {
      queue.push(u8);
    }
  });

  socket.on('end', () => {
    isDone = true;
    if (readResolve) {
      const r = readResolve;
      readResolve = null;
      r({ value: undefined, done: true });
    }
  });

  socket.on('error', () => {
    isDone = true;
    if (readResolve) {
      const r = readResolve;
      readResolve = null;
      r({ value: undefined, done: true });
    }
  });

  const reader = {
    read: () => new Promise((resolve) => {
      if (queue.length > 0) {
        resolve({ value: queue.shift(), done: false });
      } else if (isDone) {
        resolve({ value: undefined, done: true });
      } else {
        readResolve = resolve;
      }
    }),
    cancel: async () => { socket.destroy(); },
    releaseLock: () => {}
  };

  const writer = {
    write: (chunk) => new Promise((resolve, reject) => {
      const u8 = chunk instanceof Uint8Array ? chunk : (chunk.data || new Uint8Array(0));
      socket.write(Buffer.from(u8), (err) => err ? reject(err) : resolve());
    }),
    close: async () => { socket.end(); },
    releaseLock: () => {}
  };

  return { reader, writer };
}

const pool = new SessionPool(6);
await pool.refill();

const server = net.createServer(async (socket) => {
  const { reader, writer } = createSocketAdapter(socket);
  let quicSession = null;
  try {
    const { value: initialChunk } = await reader.read();
    if (!initialChunk) return;
    const { dstBytes, targetStr, leftover, sendSuccess } = await Socks5Parser.handleHandshake(initialChunk, reader, writer);
    quicSession = await pool.acquire();
    if (sendSuccess) await sendSuccess();
    await BrookTunnel.run({
      clientReader: reader,
      clientWriter: writer,
      quicManager: quicSession,
      dstBytes,
      leftover,
      password: PASSWORD,
      targetStr
    });
  } catch (e) {
    socket.destroy();
  } finally {
    if (quicSession) quicSession.close();
  }
});

await new Promise(r => server.listen(SOCKS5_PORT, '127.0.0.1', r));
console.log(`Test SOCKS5 proxy listening on 127.0.0.1:${SOCKS5_PORT}`);

// 1. Fetch Douban HTML
console.log('\nFetching https://douban.com HTML...');
const { stdout: html } = await execAsync(`curl -s -L -x socks5h://127.0.0.1:${SOCKS5_PORT} "https://douban.com"`);
console.log(`Received ${html.length} bytes of HTML.`);

// 2. Extract asset URLs (images, css, js)
const imgMatches = [...html.matchAll(/<img[^>]+src=["'](https?:\/\/[^"']+)["']/g)].map(m => m[1]);
const scriptMatches = [...html.matchAll(/<script[^>]+src=["'](https?:\/\/[^"']+)["']/g)].map(m => m[1]);
const linkMatches = [...html.matchAll(/<link[^>]+href=["'](https?:\/\/[^"']+\.css[^"']*)["']/g)].map(m => m[1]);

const allAssets = [...new Set([...imgMatches, ...scriptMatches, ...linkMatches])];
console.log(`Found ${allAssets.length} unique asset URLs (images, scripts, styles).`);
console.log('Sample URLs:', allAssets.slice(0, 5));

// 3. Concurrently fetch 25+ assets in parallel!
console.log(`\nLaunching ${allAssets.length} concurrent downloads through proxy with browser headers...`);
const startT = Date.now();
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const results = await Promise.allSettled(
  allAssets.map((url, idx) => {
    return execAsync(`curl -s -L -o /dev/null -w "%{http_code}" -H "User-Agent: ${UA}" -H "Referer: https://douban.com/" -x socks5h://127.0.0.1:${SOCKS5_PORT} --max-time 15 "${url}"`)
      .then(res => ({ url, code: res.stdout, ok: res.stdout.startsWith('2') || res.stdout.startsWith('3') }))
      .catch(err => ({ url, error: err.message, ok: false }));
  })
);
const elapsed = (Date.now() - startT) / 1000;

const successCount = results.filter(r => r.status === 'fulfilled' && r.value.ok).length;
console.log(`\nResults: ${successCount}/${allAssets.length} assets downloaded successfully in ${elapsed.toFixed(2)}s!`);
console.log('Sample result statuses:', results.slice(0, 5).map(r => r.status === 'fulfilled' ? r.value : r.reason));

// 4. Concurrently fetch 20 distinct sites
console.log('\n--- Testing 20 Distinct Sites Concurrently ---');
const sites = [
  'https://www.google.com',
  'https://x.com',
  'https://douban.com',
  'https://qq.com',
  'https://example.com',
  'https://httpbin.org/get',
  'https://cloudflare.com',
  'https://github.com',
  'https://wikipedia.org',
  'https://bing.com',
  'https://yahoo.com',
  'https://baidu.com',
  'https://zhihu.com',
  'https://weibo.com',
  'https://bilibili.com',
  'https://taobao.com',
  'https://jd.com',
  'https://163.com',
  'https://sina.com.cn',
  'https://sohu.com'
];

const siteStart = Date.now();
const siteResults = await Promise.allSettled(
  sites.map(url => {
    return execAsync(`curl -s -L -o /dev/null -w "%{http_code}" -x socks5h://127.0.0.1:${SOCKS5_PORT} --max-time 15 "${url}"`)
      .then(res => ({ url, code: res.stdout, ok: res.stdout.startsWith('2') || res.stdout.startsWith('3') || res.stdout === '501' }))
      .catch(err => ({ url, error: err.message, ok: false }));
  })
);
const siteElapsed = (Date.now() - siteStart) / 1000;
const siteSuccess = siteResults.filter(r => r.status === 'fulfilled' && r.value.ok).length;
console.log(`\n20 Sites Concurrency: ${siteSuccess}/${sites.length} succeeded in ${siteElapsed.toFixed(2)}s!`);

server.close();
udpSocket.close();
process.exit(0);
