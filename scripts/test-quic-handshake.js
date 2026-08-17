import { createQuicClientSocket } from '../node_modules/quico/src/quic_socket.js';
import dns from 'node:dns/promises';

async function test() {
  console.log('Resolving brook-quic.pplx.io...');
  const res = await dns.lookup('brook-quic.pplx.io');
  console.log('IP:', res.address);

  const socket = createQuicClientSocket({
    remoteIp: res.address,
    remotePort: 4433,
    hostname: 'brook-quic.pplx.io',
    alpn: ['h3'],
    rejectUnauthorized: false,
    onSocket(quic, s) {
      console.log('QUIC socket created, starting handshake...');
    },
    onConnect(quic, s) {
      console.log('✅ QUIC Handshake Connected successfully to brook-quic.pplx.io:4433!');
      quic.close(0, 'Test completed');
      process.exit(0);
    },
    onError(err) {
      console.error('❌ QUIC Error:', err);
      process.exit(1);
    },
    onClose() {
      console.log('QUIC Connection closed');
    }
  });
}

test().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
