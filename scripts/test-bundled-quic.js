import { QUICConnection } from '../dist/test-quic-bundle.js';
import dgram from 'node:dgram';
import dns from 'node:dns/promises';

async function test() {
  console.log('Resolving brook-quic.pplx.io...');
  const res = await dns.lookup('brook-quic.pplx.io');
  console.log('IP:', res.address);

  const udpSocket = dgram.createSocket('udp4');
  let quic = null;

  udpSocket.on('message', (msg, rinfo) => {
    console.log(`[UDP RX] ${msg.length} bytes from ${rinfo.address}:${rinfo.port}`);
    if (quic) quic.feedDatagram(rinfo.address, rinfo.port, new Uint8Array(msg));
  });

  udpSocket.bind(0, () => {
    console.log('UDP Socket bound, creating QUICConnection from browser bundle...');
    quic = new QUICConnection({
      isServer: false,
      hostname: 'brook-quic.pplx.io',
      alpn: ['h3'],
      rejectUnauthorized: false
    });

    quic.on('packet', (data) => {
      console.log(`[UDP TX] ${data.length} bytes to ${res.address}:4433`);
      udpSocket.send(data, 4433, res.address);
    });

    quic.on('connect', () => {
      console.log('🎉 BUNDLED QUIC Connection successfully handshaked with Brook server!');
      quic.close(0, 'Done');
      udpSocket.close();
      process.exit(0);
    });

    quic.on('error', (err) => {
      console.error('❌ QUIC Bundle Error:', err);
      udpSocket.close();
      process.exit(1);
    });

    quic.on('close', () => {
      console.log('QUIC Connection closed');
    });

    console.log('Calling quic.connect()...');
    quic.connect();
  });
}

test().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
