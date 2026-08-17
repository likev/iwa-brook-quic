/**
 * Test what causes Brook server to send CONNECTION_CLOSE
 */
import dgram from 'node:dgram';
import dns from 'node:dns/promises';
import { deriveKey, generateNonce } from '../brook-quicclient/src/core/brook-crypto.js';
import { sealFrame, openLength, openPayload, buildBrookHeader } from '../brook-quicclient/src/core/brook-framing.js';
import { QUICConnection } from '../brook-quicclient/vendor/quic-engine.bundle.js';

async function test() {
  const SERVER_HOST = 'brook-quic.pplx.io';
  const SERVER_PORT = 4433;
  const PASSWORD = '271828brook';

  const resolved = await dns.lookup(SERVER_HOST);
  const udpSocket = dgram.createSocket('udp4');
  let quic = null;
  const streamHandlers = new Map();

  udpSocket.on('message', (msg, rinfo) => {
    if (quic) quic.feedDatagram(rinfo.address, rinfo.port, new Uint8Array(msg));
  });

  await new Promise((resolve) => {
    udpSocket.bind(0, () => {
      quic = new QUICConnection({
        isServer: false,
        hostname: SERVER_HOST,
        alpn: ['h3'],
        rejectUnauthorized: false
      });
      quic.on('packet', (data) => udpSocket.send(data, SERVER_PORT, resolved.address));
      quic.on('stream', (id, data, fin) => {
        console.log(`[QUIC] stream data on stream ${id}: length=${data.length}, fin=${fin}`);
        const h = streamHandlers.get(id);
        if (h && h.onData) h.onData(data, fin);
      });
      quic.on('connect', () => {
        console.log('Connected to QUIC!');
        resolve();
      });
      quic.on('close', (code, reason) => console.log(`[QUIC] connection closed: code=${code}, reason=${reason}`));
      quic.on('error', (err) => console.error('[QUIC] error:', err));
      quic.connect();
    });
  });

  // Stream 0: send request with FIN = true (client finished sending)
  console.log('\n--- Testing Stream 0 with FIN ---');
  await sendBrookRequestWithFin(quic, streamHandlers, 0, 'example.com', 80, PASSWORD);

  console.log('\nWaiting 2 seconds...');
  await new Promise(r => setTimeout(r, 2000));

  console.log('\n--- Testing Stream 4 on SAME QUIC Connection ---');
  try {
    await sendBrookRequestWithFin(quic, streamHandlers, 4, 'example.com', 80, PASSWORD);
    console.log('Stream 4 succeeded!');
  } catch (err) {
    console.error('Stream 4 failed:', err.message);
  }

  udpSocket.close();
}

async function sendBrookRequestWithFin(quic, streamHandlers, streamId, host, port, password) {
  return new Promise((resolve, reject) => {
    const cn = generateNonce();
    const cnCopy = new Uint8Array(cn);
    const ck = deriveKey(password, cnCopy, 'brook', false);

    let serverHandshakeDone = false;
    let sn = null;
    let sk = null;
    let rxBuffer = new Uint8Array(0);

    const timer = setTimeout(() => reject(new Error('Timeout')), 5000);

    streamHandlers.set(streamId, {
      onData: (data, fin) => {
        const merged = new Uint8Array(rxBuffer.length + data.length);
        merged.set(rxBuffer, 0);
        merged.set(data, rxBuffer.length);
        rxBuffer = merged;

        if (!serverHandshakeDone) {
          if (rxBuffer.length < 12) return;
          sn = rxBuffer.slice(0, 12);
          rxBuffer = rxBuffer.slice(12);
          sk = deriveKey(password, sn, 'brook', false);
          serverHandshakeDone = true;
          console.log(`Stream ${streamId} received server nonce!`);
        }

        while (serverHandshakeDone) {
          if (rxBuffer.length < 18) break;
          const chunk18 = rxBuffer.slice(0, 18);
          const expectedLen = openLength(sk, sn, chunk18);
          const reqLen = 18 + expectedLen + 16;
          if (rxBuffer.length < reqLen) break;
          const payloadAndTag = rxBuffer.slice(18, reqLen);
          rxBuffer = rxBuffer.slice(reqLen);
          const plain = openPayload(sk, sn, payloadAndTag);
          console.log(`Stream ${streamId} received decrypted payload (${plain.length}B)`);
          clearTimeout(timer);
          resolve();
          return;
        }
      }
    });

    const domainBytes = new TextEncoder().encode(host);
    const dstBytes = new Uint8Array(1 + 1 + domainBytes.length + 2);
    dstBytes[0] = 0x03;
    dstBytes[1] = domainBytes.length;
    dstBytes.set(domainBytes, 2);
    dstBytes[2 + domainBytes.length] = (port >> 8) & 0xFF;
    dstBytes[3 + domainBytes.length] = port & 0xFF;

    quic.sendStream(streamId, cn, false);
    const header = buildBrookHeader(dstBytes, true, 0);
    quic.sendStream(streamId, sealFrame(ck, cnCopy, header), false);

    const req = new TextEncoder().encode(`GET / HTTP/1.1\r\nHost: ${host}\r\nUser-Agent: curl/7.68.0\r\nConnection: close\r\nAccept: */*\r\n\r\n`);
    quic.sendStream(streamId, sealFrame(ck, cnCopy, req), true); // send FIN
  });
}

test().catch(console.error);
