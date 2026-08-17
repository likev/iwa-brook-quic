/**
 * Synchronous AES-256-GCM frame sealing and opening for Brook stream chunks.
 */

import { gcm } from '../../vendor/quic-engine.bundle.js';
import { nextNonce } from './brook-crypto.js';

/**
 * Encrypt and frame a payload chunk for transmission over Brook QUIC stream.
 *
 * Wire format:
 * [Encrypted Length (2B)] + [Tag (16B)] + [Encrypted Data (L B)] + [Tag (16B)]
 *
 * @param {Uint8Array} keyBytes - 32-byte AES key
 * @param {Uint8Array} nonce12 - 12-byte nonce (advanced in place twice)
 * @param {Uint8Array} payload - Plaintext payload to seal
 * @returns {Uint8Array} Sealed frame buffer
 */
export function sealFrame(keyBytes, nonce12, payload) {
  const lenBuf = new Uint8Array([
    (payload.length >> 8) & 0xFF,
    payload.length & 0xFF
  ]);

  // 1. Encrypt Length (2 bytes) with current nonce
  const lenCipher = gcm(keyBytes, nonce12);
  const sealedLen = lenCipher.encrypt(lenBuf); // 2 + 16 = 18 bytes
  nextNonce(nonce12);

  // 2. Encrypt Payload (L bytes) with incremented nonce
  const payloadCipher = gcm(keyBytes, nonce12);
  const sealedPayload = payloadCipher.encrypt(payload); // L + 16 bytes
  nextNonce(nonce12);

  // 3. Assemble full frame
  const out = new Uint8Array(18 + sealedPayload.length);
  out.set(sealedLen, 0);
  out.set(sealedPayload, 18);
  return out;
}

/**
 * Decrypt the 18-byte length prefix frame.
 *
 * @param {Uint8Array} keyBytes - 32-byte AES key
 * @param {Uint8Array} nonce12 - 12-byte nonce (advanced in place once)
 * @param {Uint8Array} chunk18 - 18-byte buffer (2B ciphertext + 16B tag)
 * @returns {number} Decrypted payload length
 */
export function openLength(keyBytes, nonce12, chunk18) {
  const lenCipher = gcm(keyBytes, nonce12);
  const lenBuf = lenCipher.decrypt(chunk18);
  nextNonce(nonce12);
  return (lenBuf[0] << 8) | lenBuf[1];
}

/**
 * Decrypt the payload chunk.
 *
 * @param {Uint8Array} keyBytes - 32-byte AES key
 * @param {Uint8Array} nonce12 - 12-byte nonce (advanced in place once)
 * @param {Uint8Array} payloadAndTag - (L + 16) byte buffer
 * @returns {Uint8Array} Plaintext decrypted payload
 */
export function openPayload(keyBytes, nonce12, payloadAndTag) {
  const payloadCipher = gcm(keyBytes, nonce12);
  const plain = payloadCipher.decrypt(payloadAndTag);
  nextNonce(nonce12);
  return plain;
}

/**
 * Construct Brook destination header body with timestamp.
 *
 * Timestamp rule:
 * - TCP: forced to even (if now % 2 !== 0, now += 1)
 * - UDP: forced to odd (if now % 2 !== 1, now += 1)
 *
 * @param {Uint8Array} dstBytes - SOCKS5 destination bytes [ATYP, ADDR..., PORT (2B)]
 * @param {boolean} isTcp - Whether this is a TCP connection
 * @returns {Uint8Array} Header buffer: [uint32 timestamp] + dstBytes
 */
export function buildBrookHeader(dstBytes, isTcp = true, clockOffsetSec = 0) {
  let nowSec = Math.floor(Date.now() / 1000) + Math.round(clockOffsetSec || 0);
  if (isTcp && nowSec % 2 !== 0) nowSec += 1;
  if (!isTcp && nowSec % 2 !== 1) nowSec += 1;

  const header = new Uint8Array(4 + dstBytes.length);
  header[0] = (nowSec >> 24) & 0xFF;
  header[1] = (nowSec >> 16) & 0xFF;
  header[2] = (nowSec >> 8) & 0xFF;
  header[3] = nowSec & 0xFF;
  header.set(dstBytes, 4);
  return header;
}
