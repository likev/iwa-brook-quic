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
  const low = (nonce12[0] | (nonce12[1] << 8) | (nonce12[2] << 16) | (nonce12[3] << 24)) >>> 0;
  const newLow = (low + 1) >>> 0;
  nonce12[0] = newLow & 0xFF;
  nonce12[1] = (newLow >>> 8) & 0xFF;
  nonce12[2] = (newLow >>> 16) & 0xFF;
  nonce12[3] = (newLow >>> 24) & 0xFF;
  if (newLow === 0) {
    const high = (nonce12[4] | (nonce12[5] << 8) | (nonce12[6] << 16) | (nonce12[7] << 24)) >>> 0;
    const newHigh = (high + 1) >>> 0;
    nonce12[4] = newHigh & 0xFF;
    nonce12[5] = (newHigh >>> 8) & 0xFF;
    nonce12[6] = (newHigh >>> 16) & 0xFF;
    nonce12[7] = (newHigh >>> 24) & 0xFF;
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

const baseKeyCache = new Map(); // cacheKey -> CryptoKey
const baseKeyPending = new Map(); // cacheKey -> Promise<CryptoKey>
const MAX_BASE_KEY_CACHE = 8;

function cacheKeyFor(password, withoutBrook) {
  if (typeof password === 'string') return `s:${password}:${withoutBrook}`;
  if (password instanceof Uint8Array) {
    // Passwords are small (<128B); hex prefix + length is cheap and collision-safe
    // for the cache key (cryptographic safety comes from the key itself, not the key string).
    let hex = '';
    const n = Math.min(password.length, 64);
    for (let i = 0; i < n; i++) hex += password[i].toString(16).padStart(2, '0');
    return `b:${password.length}:${hex}:${withoutBrook}`;
  }
  return `o:${String(password)}:${withoutBrook}`;
}

async function getBaseKey(password, withoutBrook) {
  const cacheKey = cacheKeyFor(password, withoutBrook);
  const hit = baseKeyCache.get(cacheKey);
  if (hit) {
    // LRU refresh
    baseKeyCache.delete(cacheKey);
    baseKeyCache.set(cacheKey, hit);
    return hit;
  }
  const inflight = baseKeyPending.get(cacheKey);
  if (inflight) return inflight;
  const p = (async () => {
    try {
      let pwdBytes = typeof password === 'string' ? new TextEncoder().encode(password) : password;
      if (withoutBrook) {
        pwdBytes = await sha256(pwdBytes);
      }
      const k = await globalThis.crypto.subtle.importKey(
        'raw',
        pwdBytes,
        'HKDF',
        false,
        ['deriveKey', 'deriveBits']
      );
      if (baseKeyCache.size >= MAX_BASE_KEY_CACHE) {
        const oldest = baseKeyCache.keys().next().value;
        baseKeyCache.delete(oldest);
      }
      baseKeyCache.set(cacheKey, k);
      return k;
    } finally {
      baseKeyPending.delete(cacheKey);
    }
  })();
  baseKeyPending.set(cacheKey, p);
  return p;
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
  const infoBytes = typeof info === 'string' ? new TextEncoder().encode(info) : info;
  const baseKey = await getBaseKey(password, withoutBrook);
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
  const infoBytes = typeof info === 'string' ? new TextEncoder().encode(info) : info;
  const baseKey = await getBaseKey(password, withoutBrook);
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
