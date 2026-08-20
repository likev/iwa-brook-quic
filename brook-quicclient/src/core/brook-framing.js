/**
 * Hardware-Accelerated AES-256-GCM frame sealing and opening for Brook stream chunks.
 * Implemented using the standard W3C Web Crypto API (globalThis.crypto.subtle).
 */

import { nextNonce } from './brook-crypto.js';

/**
 * High-performance AES-256-GCM cipher instance wrapping a native CryptoKey.
 */
export class BrookCipher {
  constructor(key) {
    this._cryptoKeyPromise = null;
    this.cryptoKey = null;

    if (key instanceof CryptoKey) {
      this.cryptoKey = key;
    } else if (key instanceof Uint8Array || key instanceof ArrayBuffer) {
      const raw = key instanceof Uint8Array ? key : new Uint8Array(key);
      this._cryptoKeyPromise = globalThis.crypto.subtle.importKey(
        'raw',
        raw,
        'AES-GCM',
        false,
        ['encrypt', 'decrypt']
      ).then((k) => {
        this.cryptoKey = k;
        return k;
      });
    } else if (key && typeof key.then === 'function') {
      this._cryptoKeyPromise = key.then((k) => {
        if (k instanceof CryptoKey) {
          this.cryptoKey = k;
          return k;
        }
        const raw = k instanceof Uint8Array ? k : new Uint8Array(k);
        return globalThis.crypto.subtle.importKey(
          'raw',
          raw,
          'AES-GCM',
          false,
          ['encrypt', 'decrypt']
        ).then((ck) => {
          this.cryptoKey = ck;
          return ck;
        });
      });
    }
  }

  async getCryptoKey() {
    if (this.cryptoKey) return this.cryptoKey;
    if (this._cryptoKeyPromise) return await this._cryptoKeyPromise;
    throw new Error('BrookCipher: No valid key provided');
  }

  async encrypt(nonce12, plaintext) {
    const key = await this.getCryptoKey();
    const u8Plain = plaintext instanceof Uint8Array ? plaintext : new Uint8Array(plaintext);
    const ct = await globalThis.crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: nonce12,
        tagLength: 128
      },
      key,
      u8Plain
    );
    return new Uint8Array(ct);
  }

  async decrypt(nonce12, ciphertextAndTag) {
    const key = await this.getCryptoKey();
    const u8Cipher = ciphertextAndTag instanceof Uint8Array ? ciphertextAndTag : new Uint8Array(ciphertextAndTag);
    const pt = await globalThis.crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: nonce12,
        tagLength: 128
      },
      key,
      u8Cipher
    );
    return new Uint8Array(pt);
  }
}

function resolveCipher(cipherOrKey) {
  if (cipherOrKey instanceof BrookCipher) return cipherOrKey;
  return new BrookCipher(cipherOrKey);
}

/**
 * Encrypt and frame a payload chunk for transmission over Brook stream.
 *
 * Wire format:
 * [Encrypted Length (2B)] + [Tag (16B)] + [Encrypted Data (L B)] + [Tag (16B)]
 *
 * @param {Uint8Array|CryptoKey|BrookCipher} cipherOrKey - AES key or BrookCipher
 * @param {Uint8Array} nonce12 - 12-byte nonce (advanced in place twice)
 * @param {Uint8Array} payload - Plaintext payload to seal
 * @returns {Promise<Uint8Array>} Sealed frame buffer
 */
export async function sealFrame(cipherOrKey, nonce12, payload) {
  const cipher = resolveCipher(cipherOrKey);
  const lenBuf = new Uint8Array([
    (payload.length >> 8) & 0xFF,
    payload.length & 0xFF
  ]);

  // 1. Encrypt Length (2 bytes) with current nonce
  const iv1 = new Uint8Array(nonce12);
  nextNonce(nonce12);
  const sealedLen = await cipher.encrypt(iv1, lenBuf); // 2 + 16 = 18 bytes

  // 2. Encrypt Payload (L bytes) with incremented nonce
  const iv2 = new Uint8Array(nonce12);
  nextNonce(nonce12);
  const sealedPayload = await cipher.encrypt(iv2, payload); // L + 16 bytes

  // 3. Assemble full frame
  const out = new Uint8Array(18 + sealedPayload.length);
  out.set(sealedLen, 0);
  out.set(sealedPayload, 18);
  return out;
}

/**
 * Decrypt the 18-byte length prefix frame.
 *
 * @param {Uint8Array|CryptoKey|BrookCipher} cipherOrKey - AES key or BrookCipher
 * @param {Uint8Array} nonce12 - 12-byte nonce (advanced in place once)
 * @param {Uint8Array} chunk18 - 18-byte buffer (2B ciphertext + 16B tag)
 * @returns {Promise<number>} Decrypted payload length
 */
export async function openLength(cipherOrKey, nonce12, chunk18) {
  const cipher = resolveCipher(cipherOrKey);
  const iv = new Uint8Array(nonce12);
  nextNonce(nonce12);
  const lenBuf = await cipher.decrypt(iv, chunk18);
  return (lenBuf[0] << 8) | lenBuf[1];
}

/**
 * Decrypt the payload chunk.
 *
 * @param {Uint8Array|CryptoKey|BrookCipher} cipherOrKey - AES key or BrookCipher
 * @param {Uint8Array} nonce12 - 12-byte nonce (advanced in place once)
 * @param {Uint8Array} payloadAndTag - (L + 16) byte buffer
 * @returns {Promise<Uint8Array>} Plaintext decrypted payload
 */
export async function openPayload(cipherOrKey, nonce12, payloadAndTag) {
  const cipher = resolveCipher(cipherOrKey);
  const iv = new Uint8Array(nonce12);
  nextNonce(nonce12);
  return await cipher.decrypt(iv, payloadAndTag);
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
