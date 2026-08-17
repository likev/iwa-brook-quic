import net from 'node:net';
import dgram from 'node:dgram';
import dns from 'node:dns/promises';
import { exec } from 'node:child_process';
import { Socks5Parser } from '../brook-quicclient/src/protocols/socks5-parser.js';
import { HttpProxyParser } from '../brook-quicclient/src/protocols/http-proxy-parser.js';
import { QUICConnection } from '../brook-quicclient/vendor/quic-engine.bundle.js';
import { BrookTunnel } from '../brook-quicclient/src/core/brook-tunnel.js';

async function testDedicatedQuicPerConnection() {
  const SERVER_HOST = 'brook-quic.pplx.io';
  const SERVER_PORT = 4433;
  const PASSWORD = '271828brook';
  const SOCKS5_PORT = 19181;
  const HTTP_PORT = 19185;

  const resolved = await dns.lookup(SERVER_HOST);

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

  // Helper to establish a dedicated QUIC connection for a session (Brook quicclient.go architecture)
  async function createQuicSession() {
    const udpSocket = dgram.createSocket('udp4');
    let quic = null;
    const streamHandlers = new Map();

    udpSocket.on('message', (msg, rinfo) => {
      if (quic) quic.feedDatagram(rinfo.address, rinfo.port, new Uint8Array(msg));
    });

    await new Promise((resolve, reject) => {
      udpSocket.bind(0, () => {
        quic = new QUICConnection({
          isServer: false,
          hostname: SERVER_HOST,
          alpn: ['h3'],
          rejectUnauthorized: false
        });
        quic.on('packet', (data) => udpSocket.send(data, SERVER_PORT, resolved.address));
        quic.on('stream', (id, data, fin) => {
          const h = streamHandlers.get(id);
          if (h && h.onData) h.onData(data, fin);
        });
        quic.on('connect', () => resolve());
        quic.on('error', (err) => reject(err));
        quic.connect();
      });
    });

    return {
      allocateStreamId: () => 0, // Dedicated session always starts at stream 0
      registerStream: (streamId, handlers) => streamHandlers.set(streamId, handlers),
      unregisterStream: (streamId) => streamHandlers.delete(streamId),
      sendStreamData: async (streamId, data, fin = false) => quic.sendStream(streamId, data, fin),
      ensureConnected: async () => {},
      close: () => {
        try { quic.close(0, 'close'); } catch (e) {}
        try { udpSocket.close(); } catch (e) {}
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
      console.log(`[SOCKS5] Handshake done for ${targetStr}`);
      quicSession = await createQuicSession();
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

  const httpServer = net.createServer(async (socket) => {
    const { reader, writer } = createSocketAdapter(socket);
    let quicSession = null;
    try {
      const { value: initialChunk } = await reader.read();
      if (!initialChunk) return;
      const { dstBytes, targetStr, leftover } = await HttpProxyParser.handleHandshake(initialChunk, reader, writer);
      console.log(`[HTTP Proxy] Handshake done for ${targetStr}`);
      quicSession = await createQuicSession();
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
  await new Promise(r => httpServer.listen(HTTP_PORT, '127.0.0.1', r));

  console.log('Running Test 1 (SOCKS5 google.com)...');
  exec(`curl -s -o /dev/null -w "%{http_code}" --max-time 10 -x socks5h://127.0.0.1:${SOCKS5_PORT} https://www.google.com`, (err, stdout) => {
    console.log('Test 1 result:', stdout);

    console.log('Running Test 2 (HTTP CONNECT google.com)...');
    exec(`curl -s -o /dev/null -w "%{http_code}" --max-time 10 -x http://127.0.0.1:${HTTP_PORT} https://www.google.com`, (err2, stdout2) => {
      console.log('Test 2 result:', stdout2);

      console.log('Running Test 3 (5 concurrent requests)...');
      const cmds = [
        `curl -s -o /dev/null -w "%{http_code}" --max-time 10 -x socks5h://127.0.0.1:${SOCKS5_PORT} https://www.google.com`,
        `curl -s -o /dev/null -w "%{http_code}" --max-time 10 -x http://127.0.0.1:${HTTP_PORT} https://www.google.com`,
        `curl -s -o /dev/null -w "%{http_code}" --max-time 10 -x socks5h://127.0.0.1:${SOCKS5_PORT} https://httpbin.org/ip`,
        `curl -s -o /dev/null -w "%{http_code}" --max-time 10 -x http://127.0.0.1:${HTTP_PORT} https://httpbin.org/ip`,
        `curl -s -o /dev/null -w "%{http_code}" --max-time 10 -x socks5h://127.0.0.1:${SOCKS5_PORT} https://www.google.com`
      ];

      Promise.all(cmds.map(c => new Promise(res => exec(c, (e, out) => res(out))))).then(resList => {
        console.log('All 5 concurrent requests results:', resList.join(', '));
        socks5Server.close();
        httpServer.close();
        process.exit(0);
      });
    });
  });
}

testDedicatedQuicPerConnection();
