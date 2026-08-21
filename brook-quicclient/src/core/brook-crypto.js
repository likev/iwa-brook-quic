/**
 * Brook cryptographic key derivation, SHA-256 hashing, and nonce progression.
 * Implemented using the standard W3C Web Crypto API (globalThis.crypto.subtle).
 */

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
 * Compute SHA-256 hash using Web Crypto API.
 * @param {string|Uint8Array} data
 * @returns {Promise<Uint8Array>} 32-byte digest
 */
export async function sha256(data) {
  const u8 = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', u8);
  return new Uint8Array(digest);
}

/**
 * Derive an AES-GCM CryptoKey using HKDF-SHA256 via Web Crypto API.
 *
 * @param {string|Uint8Array} password - Server password
 * @param {Uint8Array} nonce12 - 12-byte nonce (salt)
 * @param {string|Uint8Array} info - HKDF info string (default: "brook")
 * @param {boolean} [withoutBrook=true] - Whether to pre-hash password with SHA-256 (default: true)
 * @returns {Promise<CryptoKey>} Derived AES-GCM CryptoKey
 */
export async function deriveKey(password, nonce12, info = 'brook', withoutBrook = true) {
  let pwdBytes = typeof password === 'string' ? new TextEncoder().encode(password) : password;
  if (withoutBrook) {
    pwdBytes = await sha256(pwdBytes);
  }
  const infoBytes = typeof info === 'string' ? new TextEncoder().encode(info) : info;
  const baseKey = await globalThis.crypto.subtle.importKey(
    'raw',
    pwdBytes,
    'HKDF',
    false,
    ['deriveKey', 'deriveBits']
  );
  return await globalThis.crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: nonce12,
      info: infoBytes
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
}

/**
 * Derive raw 32-byte key bits using HKDF-SHA256 via Web Crypto API.
 *
 * @param {string|Uint8Array} password - Server password
 * @param {Uint8Array} nonce12 - 12-byte nonce (salt)
 * @param {string|Uint8Array} info - HKDF info string (default: "brook")
 * @param {boolean} [withoutBrook=true] - Whether to pre-hash password with SHA-256 (default: true)
 * @returns {Promise<Uint8Array>} 32-byte raw key buffer
 */
export async function deriveKeyBytes(password, nonce12, info = 'brook', withoutBrook = true) {
  let pwdBytes = typeof password === 'string' ? new TextEncoder().encode(password) : password;
  if (withoutBrook) {
    pwdBytes = await sha256(pwdBytes);
  }
  const infoBytes = typeof info === 'string' ? new TextEncoder().encode(info) : info;
  const baseKey = await globalThis.crypto.subtle.importKey(
    'raw',
    pwdBytes,
    'HKDF',
    false,
    ['deriveBits']
  );
  const bits = await globalThis.crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: nonce12,
      info: infoBytes
    },
    baseKey,
    256
  );
  return new Uint8Array(bits);
}
