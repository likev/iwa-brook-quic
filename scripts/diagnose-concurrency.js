import dgram from 'node:dgram';
import dns from 'node:dns/promises';
import { QUICConnection } from '../brook-quicclient/vendor/quic-engine.bundle.js';
import { getDcidHex } from '../brook-quicclient/src/quic/quic-connection-manager.js';
import { generateNonce, deriveKey } from '../brook-quicclient/src/core/brook-crypto.js';
import { sealFrame, buildBrookHeader } from '../brook-quicclient/src/core/brook-framing.js';

const SERVER_HOST = 'brook-quic.pplx.io';
const SERVER_PORT = 4433;
const PASSWORD = '271828brook';

console.log('=== Diagnosing Multiple QUIC Connections Handshake Concurrency ===\n');

const resolved = await dns.lookup(SERVER_HOST);
console.log(`Resolved ${SERVER_HOST} -> ${resolved.address}`);

async function testConcurrentQuicSessions(concurrency = 8) {
  const udpSocket = dgram.createSocket('udp4');
  const sessionsByCid = new Map();

  udpSocket.on('message', (msg, rinfo) => {
    const u8 = new Uint8Array(msg);
    const dcidHex = getDcidHex(u8);
    if (dcidHex && sessionsByCid.has(dcidHex)) {
      const session = sessionsByCid.get(dcidHex);
      if (session && session.quic) {
        session.quic.feedDatagram(rinfo.address, rinfo.port, u8);
      }
    }
  });

  await new Promise(r => udpSocket.bind(0, r));

  console.log(`\nLaunching ${concurrency} simultaneous QUIC connections to ${SERVER_HOST}:${SERVER_PORT}...`);

  const results = await Promise.allSettled(
    Array.from({ length: concurrency }).map(async (_, idx) => {
      const id = idx + 1;
      const startT = Date.now();
      const quic = new QUICConnection({
        isServer: false,
        hostname: SERVER_HOST,
        alpn: ['h3'],
        keepAlive: 8000,
        idleTimeout: 30000,
        rejectUnauthorized: false
      });

      quic.on('packet', (data) => {
        udpSocket.send(data, SERVER_PORT, resolved.address);
      });

      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          quic.close(0, 'timeout');
          reject(new Error(`[#${id}] Handshake timed out after 5000ms`));
        }, 5000);

        quic.on('connect', async () => {
          clearTimeout(timer);
          const connectT = (Date.now() - startT) / 1000;
          console.log(`  [#${id}] ✅ QUIC Handshake established in ${connectT.toFixed(2)}s`);

          // Now test Brook handshake on stream 0
          const cn = generateNonce();
          const cnCopy = new Uint8Array(cn);
          const ck = deriveKey(PASSWORD, cnCopy, 'brook', false);
          const dstBytes = new Uint8Array([0x03, 0x0e, ...Buffer.from('www.google.com'), 0x01, 0xbb]);
          const header = sealFrame(ck, cnCopy, buildBrookHeader(dstBytes, true, 0));

          let brookResolved = false;
          const brookTimer = setTimeout(() => {
            if (!brookResolved) {
              brookResolved = true;
              quic.close(0, 'timeout');
              reject(new Error(`  [#${id}] ❌ Brook handshake reply timed out after 5000ms`));
            }
          }, 5000);

          quic.on('stream', (streamId, data) => {
            if (!brookResolved && data.length >= 12) {
              brookResolved = true;
              clearTimeout(brookTimer);
              const brookT = (Date.now() - startT) / 1000;
              console.log(`  [#${id}] 🚀 Brook server replied on stream ${streamId} in ${brookT.toFixed(2)}s (total)`);
              resolve({ id, totalTime: brookT });
            }
          });

          quic.sendStream(0, cn, false);
          quic.sendStream(0, header, false);
        });

        quic.on('error', (err) => {
          clearTimeout(timer);
          reject(new Error(`[#${id}] QUIC error: ${err.message}`));
        });

        quic.connect();

        if (quic.context) {
          if (quic.context.my_cids && quic.context.my_cids[0]) {
            const scidHex = Array.from(quic.context.my_cids[0]).map(b => b.toString(16).padStart(2, '0')).join('');
            sessionsByCid.set(scidHex, { quic });
          }
          if (quic.context.original_dcid) {
            const dcidHex = Array.from(quic.context.original_dcid).map(b => b.toString(16).padStart(2, '0')).join('');
            sessionsByCid.set(dcidHex, { quic });
          }
        }
      });
    })
  );

  const succeeded = results.filter(r => r.status === 'fulfilled').length;
  console.log(`\nResult: ${succeeded}/${concurrency} succeeded.`);
  for (const r of results) {
    if (r.status === 'rejected') console.log('  Failure:', r.reason.message);
  }

  udpSocket.close();
}

await testConcurrentQuicSessions(8);
