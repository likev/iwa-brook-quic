/**
 * Synchronous AES-256-GCM frame sealing and opening for Brook stream chunks.
 */

import { gcm, aesUnsafe, ghash } from '../../vendor/quic-engine.bundle.js';
import { nextNonce } from './brook-crypto.js';

/**
 * Pre-expanded AES-256-GCM cipher instance.
 * Avoids recomputing 14-round AES key schedule and H-table on every frame.
 */
export class BrookCipher {
  constructor(keyBytes) {
    this.keyBytes = keyBytes;
    if (aesUnsafe && ghash && typeof aesUnsafe.expandKeyLE === 'function') {
      this.xk = aesUnsafe.expandKeyLE(keyBytes);
      this.authKey = new Uint8Array(16);
      const c0 = new Uint8Array(16);
      aesUnsafe.ctr32(this.xk, false, c0, c0, this.authKey);
      this.useFast = true;
    } else {
      this.useFast = false;
    }
  }

  encrypt(nonce12, plaintext) {
    if (!this.useFast) {
      return gcm(this.keyBytes, nonce12).encrypt(plaintext);
    }
    let pt = plaintext;
    if (pt.byteOffset % 4 !== 0) pt = new Uint8Array(pt);

    const counter = new Uint8Array(16);
    counter.set(nonce12, 0);
    counter[15] = 1;
    const tagMask = aesUnsafe.ctr32(this.xk, false, counter, new Uint8Array(16));

    const out = new Uint8Array(pt.length + 16);
    aesUnsafe.ctr32(this.xk, false, counter, pt, out.subarray(0, pt.length));

    const gh = ghash.create(this.authKey);
    gh.update(out.subarray(0, pt.length));
    const lenBlock = new Uint8Array(16);
    const view = new DataView(lenBlock.buffer, lenBlock.byteOffset, 16);
    view.setBigUint64(8, BigInt(pt.length * 8), false);
    gh.update(lenBlock);
    const tag = gh.digest();
    for (let i = 0; i < 16; i++) tag[i] ^= tagMask[i];
    out.set(tag, pt.length);
    return out;
  }

  decrypt(nonce12, ciphertextAndTag) {
    if (!this.useFast) {
      return gcm(this.keyBytes, nonce12).decrypt(ciphertextAndTag);
    }
    const ptLen = ciphertextAndTag.length - 16;
    let data = ciphertextAndTag.subarray(0, ptLen);
    const passedTag = ciphertextAndTag.subarray(ptLen);

    if (data.byteOffset % 4 !== 0) data = new Uint8Array(data);

    const counter = new Uint8Array(16);
    counter.set(nonce12, 0);
    counter[15] = 1;
    const tagMask = aesUnsafe.ctr32(this.xk, false, counter, new Uint8Array(16));

    const gh = ghash.create(this.authKey);
    gh.update(data);
    const lenBlock = new Uint8Array(16);
    const view = new DataView(lenBlock.buffer, lenBlock.byteOffset, 16);
    view.setBigUint64(8, BigInt(data.length * 8), false);
    gh.update(lenBlock);
    const tag = gh.digest();
    for (let i = 0; i < 16; i++) tag[i] ^= tagMask[i];

    for (let i = 0; i < 16; i++) {
      if (tag[i] !== passedTag[i]) throw new Error('aes-gcm: invalid tag');
    }

    return aesUnsafe.ctr32(this.xk, false, counter, data);
  }
}

function resolveCipher(cipherOrKey) {
  if (cipherOrKey instanceof BrookCipher) return cipherOrKey;
  return new BrookCipher(cipherOrKey);
}

/**
 * Encrypt and frame a payload chunk for transmission over Brook QUIC stream.
 *
 * Wire format:
 * [Encrypted Length (2B)] + [Tag (16B)] + [Encrypted Data (L B)] + [Tag (16B)]
 *
 * @param {Uint8Array|BrookCipher} cipherOrKey - 32-byte AES key or BrookCipher
 * @param {Uint8Array} nonce12 - 12-byte nonce (advanced in place twice)
 * @param {Uint8Array} payload - Plaintext payload to seal
 * @returns {Uint8Array} Sealed frame buffer
 */
export function sealFrame(cipherOrKey, nonce12, payload) {
  const cipher = resolveCipher(cipherOrKey);
  const lenBuf = new Uint8Array([
    (payload.length >> 8) & 0xFF,
    payload.length & 0xFF
  ]);

  // 1. Encrypt Length (2 bytes) with current nonce
  const sealedLen = cipher.encrypt(nonce12, lenBuf); // 2 + 16 = 18 bytes
  nextNonce(nonce12);

  // 2. Encrypt Payload (L bytes) with incremented nonce
  const sealedPayload = cipher.encrypt(nonce12, payload); // L + 16 bytes
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
 * @param {Uint8Array|BrookCipher} cipherOrKey - 32-byte AES key or BrookCipher
 * @param {Uint8Array} nonce12 - 12-byte nonce (advanced in place once)
 * @param {Uint8Array} chunk18 - 18-byte buffer (2B ciphertext + 16B tag)
 * @returns {number} Decrypted payload length
 */
export function openLength(cipherOrKey, nonce12, chunk18) {
  const cipher = resolveCipher(cipherOrKey);
  const lenBuf = cipher.decrypt(nonce12, chunk18);
  nextNonce(nonce12);
  return (lenBuf[0] << 8) | lenBuf[1];
}

/**
 * Decrypt the payload chunk.
 *
 * @param {Uint8Array|BrookCipher} cipherOrKey - 32-byte AES key or BrookCipher
 * @param {Uint8Array} nonce12 - 12-byte nonce (advanced in place once)
 * @param {Uint8Array} payloadAndTag - (L + 16) byte buffer
 * @returns {Uint8Array} Plaintext decrypted payload
 */
export function openPayload(cipherOrKey, nonce12, payloadAndTag) {
  const cipher = resolveCipher(cipherOrKey);
  const plain = cipher.decrypt(nonce12, payloadAndTag);
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
