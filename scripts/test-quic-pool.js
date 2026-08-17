/**
 * Test Shared UDP Socket + Pre-connected QUIC Session Pool
 */
import dgram from 'node:dgram';
import dns from 'node:dns/promises';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import net from 'node:net';

import { Socks5Parser } from '../brook-quicclient/src/protocols/socks5-parser.js';
import { QUICConnection } from '../brook-quicclient/vendor/quic-engine.bundle.js';
import { BrookTunnel } from '../brook-quicclient/src/core/brook-tunnel.js';

const execAsync = promisify(exec);

async function test() {
  const SERVER_HOST = 'brook-quic.pplx.io';
  const SERVER_PORT = 4433;
  const PASSWORD = '271828brook';
  const SOCKS5_PORT = 19181;

  const resolved = await dns.lookup(SERVER_HOST);
  console.log(`Target: ${resolved.address}:${SERVER_PORT}`);

  // Single Shared UDP Socket with exact Connection ID routing
  const udpSocket = dgram.createSocket('udp4');
  const sessionsByCid = new Map();

  function getDcidHex(data) {
    if (!data || data.length < 6) return null;
    const firstByte = data[0];
    if ((firstByte & 0x80) !== 0) {
      // Long Header: byte 5 is DCID Length
      const dcidLen = data[5];
      if (data.length < 6 + dcidLen) return null;
      return Array.from(data.subarray(6, 6 + dcidLen)).map(b => b.toString(16).padStart(2, '0')).join('');
    } else {
      // Short Header (1-RTT): 8-byte DCID
      if (data.length < 9) return null;
      return Array.from(data.subarray(1, 9)).map(b => b.toString(16).padStart(2, '0')).join('');
    }
  }

  udpSocket.on('message', (msg, rinfo) => {
    const u8 = new Uint8Array(msg);
    const dcidHex = getDcidHex(u8);
    if (dcidHex && sessionsByCid.has(dcidHex)) {
      const session = sessionsByCid.get(dcidHex);
      if (session.quic && !session.isClosed) {
        session.quic.feedDatagram(rinfo.address, rinfo.port, u8);
      }
    }
  });

  await new Promise(r => udpSocket.bind(0, r));

  class SharedQuicSession {
    constructor() {
      this.quic = null;
      this.streamHandlers = new Map();
      this.isClosed = false;
      this.isConnected = false;
    }

    async connect(timeoutMs = 8000) {
      return new Promise((resolve, reject) => {
        let isResolved = false;
        const timer = setTimeout(() => {
          if (!isResolved) {
            isResolved = true;
            this.close();
            reject(new Error(`QUIC handshake timed out after ${timeoutMs}ms`));
          }
        }, timeoutMs);

        this.quic = new QUICConnection({
          isServer: false,
          hostname: SERVER_HOST,
          alpn: ['h3'],
          rejectUnauthorized: false
        });

        this.quic.on('packet', (data) => {
          if (!this.isClosed) {
            udpSocket.send(data, SERVER_PORT, resolved.address);
          }
        });

        this.quic.on('connect', () => {
          clearTimeout(timer);
          if (!isResolved) {
            isResolved = true;
            this.isConnected = true;
            resolve(this);
          }
        });

        this.quic.on('stream', (streamId, data, fin) => {
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
            reject(new Error('QUIC connection closed unexpectedly'));
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
      if (this.isClosed || !this.quic) throw new Error('QUIC session is closed');
      this.quic.sendStream(streamId, data instanceof Uint8Array ? data : new Uint8Array(data), fin);
    }
    async ensureConnected() {}

    close() {
      if (this.isClosed) return;
      this.isClosed = true;
      if (this.scidHex) sessionsByCid.delete(this.scidHex);
      if (this.dcidHex) sessionsByCid.delete(this.dcidHex);
      for (const handler of this.streamHandlers.values()) {
        if (handler.onClose) handler.onClose();
      }
      this.streamHandlers.clear();
      if (this.quic) {
        try { this.quic.close(0, 'close'); } catch (e) {}
        this.quic = null;
      }
    }
  }

  // Session Pool Manager (maintains warm pre-connected QUIC sessions)
  class SessionPool {
    constructor(targetWarm = 2) {
      this.targetWarm = targetWarm;
      this.pool = [];
      this._refill();
    }

    async _refill() {
      while (this.pool.length < this.targetWarm) {
        try {
          const session = new SharedQuicSession();
          await session.connect(6000);
          this.pool.push(session);
        } catch (e) {
          break;
        }
      }
    }

    async acquire() {
      while (this.pool.length > 0) {
        const session = this.pool.shift();
        if (session && !session.isClosed && session.isConnected) {
          this._refill().catch(() => {});
          return session;
        }
      }
      // If pool is empty, create on demand
      const session = new SharedQuicSession();
      await session.connect(6000);
      this._refill().catch(() => {});
      return session;
    }
  }

  const pool = new SessionPool(2);
  console.log('Pre-warming QUIC session pool...');
  await new Promise(r => setTimeout(r, 1000));

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
        return new Promise(r => readResolve = r);
      },
      cancel: async () => socket.destroy(),
      releaseLock: () => {}
    };
    const writer = {
      write: async (data) => new Promise((resolve, reject) => {
        socket.write(Buffer.from(data), (err) => err ? reject(err) : resolve());
      }),
      close: async () => socket.end(),
      releaseLock: () => {}
    };
    return { reader, writer };
  }

  const socks5Server = net.createServer(async (socket) => {
    const { reader, writer } = createSocketAdapter(socket);
    let quicSession = null;
    try {
      const { value: initialChunk } = await reader.read();
      if (!initialChunk) return;
      const { dstBytes, targetStr, leftover } = await Socks5Parser.handleHandshake(initialChunk, reader, writer);
      quicSession = await pool.acquire();
      await BrookTunnel.run({
        clientReader: reader,
        clientWriter: writer,
        quicManager: quicSession,
        dstBytes,
        leftover,
        password: PASSWORD,
        targetStr,
        onLog: (lvl, msg) => console.log(`[${targetStr}] ${lvl}: ${msg}`)
      });
    } catch (e) {
      console.error('SOCKS5 Server Error:', e.message);
      socket.destroy();
    } finally {
      if (quicSession) quicSession.close();
    }
  });

  await new Promise(r => socks5Server.listen(SOCKS5_PORT, '127.0.0.1', r));

  console.log('\n--- Firing 8 simultaneous parallel requests (like x.com / google.com) ---');
  const startTime = Date.now();
  const urls = [
    `curl -s -o /dev/null -w "%{http_code}" --max-time 10 -x socks5h://127.0.0.1:${SOCKS5_PORT} https://www.google.com`,
    `curl -s -o /dev/null -w "%{http_code}" --max-time 10 -x socks5h://127.0.0.1:${SOCKS5_PORT} https://www.google.com`,
    `curl -s -o /dev/null -w "%{http_code}" --max-time 10 -x socks5h://127.0.0.1:${SOCKS5_PORT} http://example.com`,
    `curl -s -o /dev/null -w "%{http_code}" --max-time 10 -x socks5h://127.0.0.1:${SOCKS5_PORT} http://example.com`,
    `curl -s -o /dev/null -w "%{http_code}" --max-time 10 -x socks5h://127.0.0.1:${SOCKS5_PORT} https://www.google.com`,
    `curl -s -o /dev/null -w "%{http_code}" --max-time 10 -x socks5h://127.0.0.1:${SOCKS5_PORT} https://www.google.com`,
    `curl -s -o /dev/null -w "%{http_code}" --max-time 10 -x socks5h://127.0.0.1:${SOCKS5_PORT} http://example.com`,
    `curl -s -o /dev/null -w "%{http_code}" --max-time 10 -x socks5h://127.0.0.1:${SOCKS5_PORT} http://example.com`
  ];

  const results = await Promise.allSettled(urls.map(cmd => execAsync(cmd)));
  results.forEach((r, idx) => {
    if (r.status === 'fulfilled') {
      console.log(`[${idx}] HTTP ${r.value.stdout}`);
    } else {
      console.error(`[${idx}] FAIL:`, r.reason.message);
    }
  });
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  const successCount = results.filter(r => r.status === 'fulfilled' && (r.value.stdout.includes('200') || r.value.stdout.includes('301'))).length;
  console.log(`\n========================================`);
  console.log(`Results: ${successCount}/8 succeeded in ${elapsed}s!`);
  console.log(`========================================\n`);

  socks5Server.close();
  udpSocket.close();
}

test().catch(console.error);
