/**
 * Comprehensive Protocol & TLS Inspector for Brook QUIC Proxy
 * Inspects TLS 1.3, ALPN (h2, http/1.1), Post-Quantum Kyber, and HTTP responses.
 */

import net from 'node:net';
import tls from 'node:tls';
import dgram from 'node:dgram';
import dns from 'node:dns/promises';

import { Socks5Parser } from '../brook-quicclient/src/protocols/socks5-parser.js';
import { QUICConnection } from '../brook-quicclient/vendor/quic-engine.bundle.js';
import { BrookTunnel } from '../brook-quicclient/src/core/brook-tunnel.js';

async function inspect() {
  const SERVER_HOST = 'brook-quic.pplx.io';
  const SERVER_PORT = 4433;
  const PASSWORD = '271828brook';
  const SOCKS5_PORT = 19182;

  const resolved = await dns.lookup(SERVER_HOST);
  console.log(`\n========================================`);
  console.log(`  TLS & HTTP PROTOCOL INSPECTOR`);
  console.log(`========================================\n`);

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
      this.scidHex = null;
      this.dcidHex = null;
    }

    async connect(timeoutMs = 8000) {
      return new Promise((resolve, reject) => {
        let isResolved = false;
        const timer = setTimeout(() => {
          if (!isResolved) {
            isResolved = true;
            this.close();
            reject(new Error(`Handshake timeout`));
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
            reject(new Error('Connection closed'));
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

  class SessionPool {
    constructor(targetWarm = 2) {
      this.targetWarm = targetWarm;
      this.pool = [];
    }
    async refill() {
      while (this.pool.length < this.targetWarm) {
        try {
          const s = new TestQuicSession();
          await s.connect(6000);
          this.pool.push(s);
        } catch (e) { break; }
      }
    }
    async acquire() {
      while (this.pool.length > 0) {
        const s = this.pool.shift();
        if (s && !s.isClosed && s.isConnected) {
          this.refill().catch(() => {});
          return s;
        }
      }
      const s = new TestQuicSession();
      await s.connect(6000);
      this.refill().catch(() => {});
      return s;
    }
  }

  const pool = new SessionPool(2);
  await pool.refill();

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
    socket.on('end', () => { isDone = true; if (readResolve) readResolve({ value: undefined, done: true }); });
    socket.on('error', () => { isDone = true; if (readResolve) readResolve({ value: undefined, done: true }); });

    return {
      reader: {
        read: async () => {
          if (queue.length > 0) return { value: queue.shift(), done: false };
          if (isDone) return { value: undefined, done: true };
          return new Promise(r => readResolve = r);
        },
        cancel: async () => socket.destroy(),
        releaseLock: () => {}
      },
      writer: {
        write: async (data) => new Promise((resolve, reject) => {
          socket.write(Buffer.from(data), (err) => err ? reject(err) : resolve());
        }),
        close: async () => socket.end(),
        releaseLock: () => {}
      }
    };
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
        targetStr
      });
    } catch (e) {
      socket.destroy();
    } finally {
      if (quicSession) quicSession.close();
    }
  });

  await new Promise(r => socks5Server.listen(SOCKS5_PORT, '127.0.0.1', r));

  async function testTarget(host, port, alpnProtocols) {
    return new Promise((resolve, reject) => {
      console.log(`\nTesting ${host}:${port} with ALPN [${alpnProtocols.join(', ')}]...`);
      const socket = net.connect(SOCKS5_PORT, '127.0.0.1', async () => {
        // 1. SOCKS5 handshake
        socket.write(Buffer.from([0x05, 0x01, 0x00])); // NO AUTH
        socket.once('data', (d1) => {
          if (d1[0] !== 0x05 || d1[1] !== 0x00) return reject(new Error('SOCKS5 auth failed'));

          // Send CONNECT domain
          const domainBuf = Buffer.from(host);
          const req = Buffer.alloc(1 + 1 + 1 + 1 + 1 + domainBuf.length + 2);
          req[0] = 0x05;
          req[1] = 0x01; // CONNECT
          req[2] = 0x00;
          req[3] = 0x03; // DOMAIN
          req[4] = domainBuf.length;
          domainBuf.copy(req, 5);
          req.writeUInt16BE(port, 5 + domainBuf.length);

          socket.write(req);
          socket.once('data', (d2) => {
            if (d2[1] !== 0x00) return reject(new Error(`SOCKS5 connect error: 0x${d2[1].toString(16)}`));

            // Now perform TLS Handshake on top of SOCKS5 tunnel
            const tlsSocket = tls.connect({
              socket,
              servername: host,
              ALPNProtocols: alpnProtocols,
              rejectUnauthorized: false
            }, () => {
              const negotiated = tlsSocket.alpnProtocol;
              const cipher = tlsSocket.getCipher();
              const protocol = tlsSocket.getProtocol();
              console.log(`  ✅ TLS Handshake Success!`);
              console.log(`     - Protocol: ${protocol}`);
              console.log(`     - Cipher:   ${cipher.name} (${cipher.version})`);
              console.log(`     - ALPN:     ${negotiated || 'none'}`);

              // Send HTTP Request
              tlsSocket.write(`GET / HTTP/1.1\r\nHost: ${host}\r\nUser-Agent: Mozilla/5.0\r\nAccept: */*\r\nConnection: close\r\n\r\n`);
            });

            tlsSocket.on('data', (httpChunk) => {
              const resStr = httpChunk.toString();
              const firstLine = resStr.split('\r\n')[0];
              const altSvc = resStr.split('\r\n').find(l => l.toLowerCase().startsWith('alt-svc:'));
              console.log(`  ✅ HTTP Response: ${firstLine}`);
              if (altSvc) console.log(`     - ${altSvc}`);
              tlsSocket.destroy();
              resolve();
            });

            tlsSocket.on('error', (err) => {
              console.error(`  ❌ TLS Socket Error:`, err.message);
              reject(err);
            });
          });
        });
      });
      socket.on('error', (err) => reject(err));
    });
  }

  // 1. Test example.com (HTTP/1.1)
  await testTarget('example.com', 443, ['http/1.1']);

  // 2. Test google.com (HTTP/1.1 & h2)
  await testTarget('www.google.com', 443, ['h2', 'http/1.1']);

  // 3. Test x.com (HTTP/1.1 & h2)
  await testTarget('x.com', 443, ['h2', 'http/1.1']);

  // 4. Test api.x.com (HTTP/1.1 & h2)
  await testTarget('api.x.com', 443, ['h2', 'http/1.1']);

  socks5Server.close();
  udpSocket.close();
}

inspect().catch(console.error);
