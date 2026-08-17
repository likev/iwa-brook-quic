import net from 'node:net';
import dgram from 'node:dgram';
import dns from 'node:dns/promises';
import { QUICConnection } from '../brook-quicclient/vendor/quic-engine.bundle.js';
import { Socks5Parser } from '../brook-quicclient/src/protocols/socks5-parser.js';
import { HttpProxyParser } from '../brook-quicclient/src/protocols/http-proxy-parser.js';
import { BrookTunnel } from '../brook-quicclient/src/core/brook-tunnel.js';

async function runTestProxyServer() {
  const SERVER_HOST = 'brook-quic.pplx.io';
  const SERVER_PORT = 4433;
  const PASSWORD = '271828brook';
  const SOCKS5_PORT = 1081;
  const HTTP_PORT = 8085;

  console.log(`Resolving ${SERVER_HOST}...`);
  const resolved = await dns.lookup(SERVER_HOST);
  console.log(`Remote Brook Server IP: ${resolved.address}:${SERVER_PORT}`);

  // Create UDP socket for QUIC
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
    sendStreamData: (streamId, data, fin = false) => {
      if (!quic) throw new Error('QUIC not connected');
      quic.sendStream(streamId, data, fin);
    }
  };

  await new Promise((resolve, reject) => {
    udpSocket.bind(0, () => {
      quic = new QUICConnection({
        isServer: false,
        hostname: SERVER_HOST,
        alpn: ['h3'],
        rejectUnauthorized: false
      });

      quic.on('packet', (data) => {
        udpSocket.send(data, SERVER_PORT, resolved.address);
      });

      quic.on('stream', (id, data, fin) => {
        const h = streamHandlers.get(id);
        if (h && h.onData) h.onData(data, fin);
      });

      quic.on('connect', () => {
        console.log('✅ QUIC Connected to Brook Server!');
        resolve();
      });

      quic.on('error', (err) => {
        console.error('QUIC Error:', err);
      });

      quic.connect();
    });
  });

  // Helper to adapt Node net.Socket to WebStreams (Reader/Writer)
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
      if (readResolve) {
        readResolve({ value: undefined, done: true });
      }
    });

    socket.on('error', () => {
      isDone = true;
      if (readResolve) {
        readResolve({ value: undefined, done: true });
      }
    });

    const reader = {
      read: async () => {
        if (queue.length > 0) {
          return { value: queue.shift(), done: false };
        }
        if (isDone) {
          return { value: undefined, done: true };
        }
        return new Promise((resolve) => {
          readResolve = resolve;
        });
      },
      cancel: async () => {
        socket.destroy();
      },
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
      close: async () => {
        socket.end();
      },
      releaseLock: () => {}
    };

    return { reader, writer };
  }

  // Start SOCKS5 Server on 1080
  const socks5Server = net.createServer(async (socket) => {
    const { reader, writer } = createSocketAdapter(socket);
    try {
      const { value: initialChunk } = await reader.read();
      if (!initialChunk) return;

      const { dstBytes, targetStr, leftover } = await Socks5Parser.handleHandshake(initialChunk, reader, writer);
      console.log(`🧦 [SOCKS5] Proxying request to ${targetStr}`);

      await BrookTunnel.run({
        clientReader: reader,
        clientWriter: writer,
        quicManager,
        dstBytes,
        leftover,
        password: PASSWORD,
        targetStr,
        onLog: (lvl, msg) => console.log(`[Tunnel] ${msg}`)
      });
    } catch (e) {
      socket.destroy();
    }
  });

  // Start HTTP Proxy Server on 8080
  const httpServer = net.createServer(async (socket) => {
    const { reader, writer } = createSocketAdapter(socket);
    try {
      const { value: initialChunk } = await reader.read();
      if (!initialChunk) return;

      const { dstBytes, targetStr, isConnect, leftover } = await HttpProxyParser.handleHandshake(initialChunk, reader, writer);
      console.log(`🌐 [HTTP Proxy] ${isConnect ? 'CONNECT' : 'PLAIN'} Proxying request to ${targetStr}`);

      await BrookTunnel.run({
        clientReader: reader,
        clientWriter: writer,
        quicManager,
        dstBytes,
        leftover,
        password: PASSWORD,
        targetStr,
        onLog: (lvl, msg) => console.log(`[Tunnel] ${msg}`)
      });
    } catch (e) {
      socket.destroy();
    }
  });

  socks5Server.listen(SOCKS5_PORT, '127.0.0.1', () => {
    console.log(`🚀 SOCKS5 Proxy Server listening on 127.0.0.1:${SOCKS5_PORT}`);
  });

  httpServer.listen(HTTP_PORT, '127.0.0.1', () => {
    console.log(`🚀 HTTP Proxy Server listening on 127.0.0.1:${HTTP_PORT}`);
  });
}

runTestProxyServer().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
