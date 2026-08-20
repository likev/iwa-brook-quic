import { createQuicClientSocket } from '../node_modules/quico/src/quic_socket.js';
import { deriveKey, nextNonce } from '../brook-quicclient/src/core/brook-crypto.js';
import { sealFrame, openLength, openPayload, BrookCipher } from '../brook-quicclient/src/core/brook-framing.js';
import dns from 'node:dns/promises';

async function runBrookTest() {
  const password = '271828brook';
  const targetHost = 'httpbin.org';
  const targetPort = 80;

  console.log('Resolving brook-quic.pplx.io...');
  const res = await dns.lookup('brook-quic.pplx.io');
  console.log(`Server IP: ${res.address}:4433`);

  const streamId = 0; // Client bidi stream 0
  const cn = new Uint8Array(12);
  crypto.getRandomValues(cn);
  const cnCopy = new Uint8Array(cn); // To advance with NextNonce

  const ck = deriveKey(password, cnCopy, 'brook');

  // Build target address in SOCKS5 format: ATYP=0x03 (Domain), length, domain, port (2B)
  const hostBytes = new TextEncoder().encode(targetHost);
  const dst = new Uint8Array(1 + 1 + hostBytes.length + 2);
  dst[0] = 0x03; // Domain
  dst[1] = hostBytes.length;
  dst.set(hostBytes, 2);
  dst[2 + hostBytes.length] = (targetPort >> 8) & 0xFF;
  dst[3 + hostBytes.length] = targetPort & 0xFF;

  // Header payload: [uint32 timestamp (even)] + dst
  let nowSec = Math.floor(Date.now() / 1000);
  if (nowSec % 2 !== 0) nowSec += 1;
  const header = new Uint8Array(4 + dst.length);
  header[0] = (nowSec >> 24) & 0xFF;
  header[1] = (nowSec >> 16) & 0xFF;
  header[2] = (nowSec >> 8) & 0xFF;
  header[3] = nowSec & 0xFF;
  header.set(dst, 4);

  let sn = null;
  let sk = null;
  let rxBuffer = new Uint8Array(0);
  let handshakeComplete = false;

  const socket = createQuicClientSocket({
    remoteIp: res.address,
    remotePort: 4433,
    hostname: 'brook-quic.pplx.io',
    alpn: ['h3'],
    rejectUnauthorized: false,
    onConnect(quic, s) {
      console.log('✅ QUIC Connected! Initiating Brook Handshake on stream', streamId);

      // 1. Send client nonce cn
      quic.sendStream(streamId, cn, false);

      // 2. Send sealed header frame
      const sealedHeader = sealFrame(ck, cnCopy, header);
      quic.sendStream(streamId, sealedHeader, false);

      // 3. Listen for incoming stream data
      quic.on('stream', (id, data, fin) => {
        if (id !== streamId) return;

        // Append to rxBuffer
        const merged = new Uint8Array(rxBuffer.length + data.length);
        merged.set(rxBuffer, 0);
        merged.set(data, rxBuffer.length);
        rxBuffer = merged;

        // Step A: Read server nonce (12 bytes)
        if (!handshakeComplete) {
          if (rxBuffer.length < 12) return;
          sn = rxBuffer.slice(0, 12);
          rxBuffer = rxBuffer.slice(12);
          sk = deriveKey(password, sn, 'brook');
          handshakeComplete = true;
          console.log('✅ Brook Handshake Complete! Server Nonce received:', Buffer.from(sn).toString('hex'));

          // Now send HTTP request over the Brook tunnel
          const httpRequest = new TextEncoder().encode('GET /ip HTTP/1.1\r\nHost: httpbin.org\r\nUser-Agent: Brook-IWA-Test\r\nConnection: close\r\n\r\n');
          const sealedReq = sealFrame(ck, cnCopy, httpRequest);
          console.log('📤 Sending sealed HTTP request via Brook tunnel...');
          quic.sendStream(streamId, sealedReq, false);
        }

        // Step B: Read decrypted frames
        while (handshakeComplete && rxBuffer.length >= 18) {
          // Read 18B length chunk
          const chunk18 = rxBuffer.slice(0, 18);
          let payloadLen;
          try {
            payloadLen = openLength(sk, sn, chunk18);
          } catch (e) {
            console.error('❌ Failed to decrypt length:', e);
            return;
          }

          if (rxBuffer.length < 18 + payloadLen + 16) {
            // Need more data
            return;
          }

          const payloadAndTag = rxBuffer.slice(18, 18 + payloadLen + 16);
          rxBuffer = rxBuffer.slice(18 + payloadLen + 16);

          try {
            const plainPayload = openPayload(sk, sn, payloadAndTag);
            const text = new TextDecoder().decode(plainPayload);
            console.log('📥 Decrypted Response from remote server:\n', text);
            console.log('🎉 Brook QUIC Tunnel Test SUCCESSFUL!');
            quic.close(0, 'Done');
            process.exit(0);
          } catch (e) {
            console.error('❌ Failed to decrypt payload:', e);
            return;
          }
        }
      });
    },
    onError(err) {
      console.error('❌ QUIC Socket error:', err);
    }
  });
}

runBrookTest().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
