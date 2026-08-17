import net from 'node:net';
import dgram from 'node:dgram';
import dns from 'node:dns/promises';
import { exec } from 'node:child_process';
import { HttpProxyParser } from '../brook-quicclient/src/protocols/http-proxy-parser.js';
import { QUICConnection } from '../brook-quicclient/vendor/quic-engine.bundle.js';
import { BrookTunnel } from '../brook-quicclient/src/core/brook-tunnel.js';

async function testHttp() {
  const SERVER_HOST = 'brook-quic.pplx.io';
  const SERVER_PORT = 4433;
  const PASSWORD = '271828brook';
  const HTTP_PORT = 19185;

  const resolved = await dns.lookup(SERVER_HOST);
  const udpSocket = dgram.createSocket('udp4');
  let quic = null;
  let nextStreamId = 0;
  const streamHandlers = new Map();

  udpSocket.on('message', (msg, rinfo) => {
    if (quic) quic.feedDatagram(rinfo.address, rinfo.port, new Uint8Array(msg));
  });

  const quicManager = {
    allocateStreamId: () => {
      const id = nextStreamId;
      nextStreamId += 4;
      return id;
    },
    registerStream: (streamId, handlers) => {
      streamHandlers.set(streamId, handlers);
    },
    unregisterStream: (streamId) => {
      streamHandlers.delete(streamId);
    },
    sendStreamData: async (streamId, data, fin = false) => {
      if (!quic) throw new Error('QUIC not connected');
      quic.sendStream(streamId, data, fin);
    },
    ensureConnected: async () => {
      if (!quic) throw new Error('QUIC not connected');
    }
  };

  await new Promise((resolve) => {
    udpSocket.bind(0, () => {
      quic = new QUICConnection({
        isServer: false,
        hostname: SERVER_HOST,
        alpn: ['h3'],
        rejectUnauthorized: false,
        keepAlive: true,
        idleTimeout: 60000
      });
      quic.on('packet', (data) => udpSocket.send(data, SERVER_PORT, resolved.address));
      quic.on('stream', (id, data, fin) => {
        const h = streamHandlers.get(id);
        if (h && h.onData) h.onData(data, fin);
      });
      quic.on('connect', () => {
        console.log('QUIC connected');
        resolve();
      });
      quic.connect();
    });
  });

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

  const httpServer = net.createServer(async (socket) => {
    const { reader, writer } = createSocketAdapter(socket);
    try {
      const { value: initialChunk } = await reader.read();
      if (!initialChunk) return;

      const { dstBytes, targetStr, leftover } = await HttpProxyParser.handleHandshake(initialChunk, reader, writer);
      console.log(`[HTTP Proxy] Handshake done for ${targetStr}`);

      await BrookTunnel.run({
        clientReader: reader,
        clientWriter: writer,
        quicManager,
        dstBytes,
        leftover,
        password: PASSWORD,
        targetStr,
        onLog: (lvl, msg) => console.log(`[Tunnel ${lvl}] ${msg}`)
      });
    } catch (e) {
      console.error('HTTP Proxy error:', e);
      socket.destroy();
    }
  });

  await new Promise(r => httpServer.listen(HTTP_PORT, '127.0.0.1', r));

  console.log('Running curl...');
  exec(`curl -v --max-time 10 -x http://127.0.0.1:${HTTP_PORT} https://www.google.com`, (err, stdout, stderr) => {
    console.log('CURL ERR:', err);
    console.log('CURL STDERR:\n', stderr);
    console.log('CURL STDOUT LEN:', stdout.length);
    httpServer.close();
    udpSocket.close();
    process.exit(0);
  });
}

testHttp();
