/**
 * Brook cryptographic key derivation and nonce progression.
 */

import { hkdf, sha256 } from '../../vendor/quic-engine.bundle.js';

/**
 * Increment the 12-byte nonce according to Brook's specification:
 * The first 8 bytes are treated as a Little-Endian unsigned 64-bit integer,
 * incremented by 1 with 64-bit overflow wrapping.
 *
 * @param {Uint8Array} nonce12 - 12-byte nonce modified in place
 */
export function nextNonce(nonce12) {
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

/**
 * Generate 12 cryptographically secure random bytes for client nonce.
 * @returns {Uint8Array}
 */
export function generateNonce() {
  const nonce = new Uint8Array(12);
  globalThis.crypto.getRandomValues(nonce);
  return nonce;
}

/**
 * Derive 32-byte AES key using HKDF-SHA256.
 *
 * @param {string|Uint8Array} password - Server password
 * @param {Uint8Array} nonce12 - 12-byte nonce (salt)
 * @param {string|Uint8Array} info - HKDF info string (default: "brook")
 * @param {boolean} withoutBrook - Whether to pre-hash password with SHA-256
 * @returns {Uint8Array} 32-byte derived key
 */
export function deriveKey(password, nonce12, info = 'brook', withoutBrook = false) {
  let pwdBytes = typeof password === 'string' ? new TextEncoder().encode(password) : password;
  if (withoutBrook) {
    pwdBytes = sha256(pwdBytes);
  }
  const infoBytes = typeof info === 'string' ? new TextEncoder().encode(info) : info;
  return hkdf(sha256, pwdBytes, nonce12, infoBytes, 32);
}
