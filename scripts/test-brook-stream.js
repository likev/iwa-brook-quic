import { createQuicClientSocket } from '../node_modules/quico/src/quic_socket.js';
import { gcm } from '@noble/ciphers/aes.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import dns from 'node:dns/promises';

function nextNonce(nonce12) {
  let v = (BigInt(nonce12[0])) |
          (BigInt(nonce12[1]) << 8n) |
          (BigInt(nonce12[2]) << 16n) |
          (BigInt(nonce12[3]) << 24n) |
          (BigInt(nonce12[4]) << 32n) |
          (BigInt(nonce12[5]) << 40n) |
          (BigInt(nonce12[6]) << 48n) |
          (BigInt(nonce12[7]) << 56n);
  v = (v + 1n) & 0xFFFFFFFFFFFFFFFFn;
  for (let i = 0; i < 8; i++) {
    nonce12[i] = Number((v >> BigInt(i * 8)) & 0xFFn);
  }
}

function deriveKey(password, nonce12, info = 'brook') {
  const pwdBytes = typeof password === 'string' ? new TextEncoder().encode(password) : password;
  const infoBytes = typeof info === 'string' ? new TextEncoder().encode(info) : info;
  return hkdf(sha256, pwdBytes, nonce12, infoBytes, 32);
}

function sealFrame(keyBytes, nonce12, payload) {
  const lenBuf = new Uint8Array([ (payload.length >> 8) & 0xFF, payload.length & 0xFF ]);
  const lenCipher = gcm(keyBytes, nonce12);
  const sealedLen = lenCipher.encrypt(lenBuf); // 2 + 16 = 18B
  nextNonce(nonce12);

  const payloadCipher = gcm(keyBytes, nonce12);
  const sealedPayload = payloadCipher.encrypt(payload); // L + 16B
  nextNonce(nonce12);

  const out = new Uint8Array(18 + sealedPayload.length);
  out.set(sealedLen, 0);
  out.set(sealedPayload, 18);
  return out;
}

function openLength(keyBytes, nonce12, chunk18) {
  const lenCipher = gcm(keyBytes, nonce12);
  const lenBuf = lenCipher.decrypt(chunk18);
  nextNonce(nonce12);
  return (lenBuf[0] << 8) | lenBuf[1];
}

function openPayload(keyBytes, nonce12, chunkPayloadAndTag) {
  const payloadCipher = gcm(keyBytes, nonce12);
  const payload = payloadCipher.decrypt(chunkPayloadAndTag);
  nextNonce(nonce12);
  return payload;
}

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
