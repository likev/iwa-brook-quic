import { QUICConnection } from '../dist/test-quic-bundle.js';
import dgram from 'node:dgram';
import dns from 'node:dns/promises';

async function test() {
  const res = await dns.lookup('brook-quic.pplx.io');
  const udpSocket = dgram.createSocket('udp4');
  let quic = null;

  udpSocket.on('message', (msg, rinfo) => {
    console.log(`[UDP RX] ${msg.length} bytes from ${rinfo.address}:${rinfo.port}`);
    try {
      quic.feedDatagram(rinfo.address, rinfo.port, new Uint8Array(msg));
    } catch (e) {
      console.error('❌ Exception in feedDatagram:', e);
    }
  });

  udpSocket.bind(0, () => {
    quic = new QUICConnection({
      isServer: false,
      hostname: 'brook-quic.pplx.io',
      alpn: ['h3'],
      rejectUnauthorized: false
    });

    quic.on('packet', (data) => {
      console.log(`[UDP TX] ${data.length} bytes`);
      udpSocket.send(data, 4433, res.address);
    });

    quic.on('connect', () => {
      console.log('🎉 CONNECTED!');
      process.exit(0);
    });

    quic.on('error', (err) => {
      console.error('❌ QUIC Error:', err);
      process.exit(1);
    });

    quic.connect();
  });
}

test();
