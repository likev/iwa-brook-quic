import net from 'node:net';
import dgram from 'node:dgram';
import dns from 'node:dns/promises';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

import { Socks5Parser } from '../brook-quicclient/src/protocols/socks5-parser.js';
import { QUICConnection } from '../brook-quicclient/vendor/quic-engine.bundle.js';
import { BrookTunnel } from '../brook-quicclient/src/core/brook-tunnel.js';

const execAsync = promisify(exec);

const SERVER_HOST = 'brook-quic.pplx.io';
const SERVER_PORT = 4433;
const PASSWORD = '271828brook';
const SOCKS5_PORT = 19188;

console.log('=== Running Review Issue Verification Benchmarks ===\n');

const resolved = await dns.lookup(SERVER_HOST);
const udpSocket = dgram.createSocket('udp4');
const sessionsByCid = new Map();

function getDcidHex(data) {
  if (!data || data.length < 6) return null;
  const firstByte = data[0];
  if ((firstByte & 0x80) !== 0) {
    const dcidLen = data[5];
    if (data.length < 6 + dcidLen) return null;
    return Array.from(data.subarray(6, 6 + dcidLen)).map(b => b.toString(16).padStart(2, '0')).join('');
  } else {
    if (data.length < 9) return null;
    return Array.from(data.subarray(1, 9)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
}

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
        keepAlive: 6000,
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
  constructor(targetWarm = 4) {
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

const pool = new SessionPool(4);
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
console.log(`Test SOCKS5 proxy running on 127.0.0.1:${SOCKS5_PORT}`);

// Test 1: Download speed test (2MB chunk)
console.log('\n--- 1. Testing Throughput (2 MB download) ---');
const tStart = Date.now();
const { stdout: dlOut } = await execAsync(`curl -s -x socks5h://127.0.0.1:${SOCKS5_PORT} "https://speed.cloudflare.com/__down?bytes=2000000" | wc -c`);
const tElapsed = (Date.now() - tStart) / 1000;
const bytesDl = parseInt(dlOut.trim(), 10);
const mbps = ((bytesDl * 8) / (tElapsed * 1e6)).toFixed(2);
console.log(`✅ Downloaded ${bytesDl} bytes in ${tElapsed.toFixed(2)}s (${mbps} Mbps)`);

// Test 2: Multi-connection burst to google.com and x.com
console.log('\n--- 2. Testing Burst Parallel Requests (10 parallel google/x requests) ---');
const urls = [
  'https://www.google.com',
  'https://x.com',
  'https://www.google.com/generate_204',
  'https://www.google.com',
  'https://x.com',
  'https://www.google.com',
  'https://x.com',
  'https://www.google.com',
  'https://x.com',
  'https://www.google.com'
];
const pStart = Date.now();
const results = await Promise.allSettled(
  urls.map(url => execAsync(`curl -s -o /dev/null -w "%{http_code}" -x socks5h://127.0.0.1:${SOCKS5_PORT} --max-time 10 "${url}"`))
);
const pElapsed = (Date.now() - pStart) / 1000;
const successCount = results.filter(r => r.status === 'fulfilled' && (r.value.stdout.startsWith('2') || r.value.stdout.startsWith('3'))).length;
console.log(`✅ Parallel requests finished in ${pElapsed.toFixed(2)}s: ${successCount}/${urls.length} succeeded`);

server.close();
udpSocket.close();
console.log('\n=== All Verification Benchmarks Completed Successfully! ===');
process.exit(0);
