import './shims/buffer.js';
import { sha256, sha384, sha512 } from '@noble/hashes/sha2.js';
import { sha1, md5 } from '@noble/hashes/legacy.js';
import { hmac } from '@noble/hashes/hmac.js';
import { gcm, ecb } from '@noble/ciphers/aes.js';
import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { p256 } from '@noble/curves/nist.js';

const X25519_PKCS8_PREFIX = new Uint8Array([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20]);
const X25519_SPKI_PREFIX  = new Uint8Array([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x03, 0x21, 0x00]);

export const constants = {
  RSA_PKCS1_PADDING: 1,
  RSA_SSLV23_PADDING: 2,
  RSA_NO_PADDING: 3,
  RSA_PKCS1_OAEP_PADDING: 4,
  RSA_X931_PADDING: 5,
  RSA_PKCS1_PSS_PADDING: 6
};

function getHashFunction(algo) {
  const norm = String(algo).toLowerCase().replace(/[^a-z0-9]/g, '');
  if (norm === 'sha256') return sha256;
  if (norm === 'sha384') return sha384;
  if (norm === 'sha512') return sha512;
  if (norm === 'sha1') return sha1;
  if (norm === 'md5') return md5;
  throw new Error(`Unsupported hash algorithm: ${algo}`);
}

export function randomBytes(size) {
  const buf = new Uint8Array(size);
  globalThis.crypto.getRandomValues(buf);
  return buf;
}

export function createHash(algorithm) {
  const hashFn = getHashFunction(algorithm);
  function wrap(instance) {
    return {
      update(data) {
        const u8 = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        instance.update(u8);
        return this;
      },
      digest(encoding) {
        const res = instance.digest();
        if (encoding === 'hex') {
          return Array.from(res).map(b => b.toString(16).padStart(2, '0')).join('');
        }
        if (encoding === 'base64') {
          let binary = '';
          for (let i = 0; i < res.length; i++) binary += String.fromCharCode(res[i]);
          return btoa(binary);
        }
        return res;
      },
      copy() {
        return wrap(instance.clone());
      }
    };
  }
  return wrap(hashFn.create());
}

export function createHmac(algorithm, key) {
  const hashFn = getHashFunction(algorithm);
  const keyU8 = typeof key === 'string' ? new TextEncoder().encode(key) : new Uint8Array(key.buffer, key.byteOffset, key.byteLength);
  function wrap(instance) {
    return {
      update(data) {
        const u8 = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        instance.update(u8);
        return this;
      },
      digest(encoding) {
        const res = instance.digest();
        if (encoding === 'hex') {
          return Array.from(res).map(b => b.toString(16).padStart(2, '0')).join('');
        }
        if (encoding === 'base64') {
          let binary = '';
          for (let i = 0; i < res.length; i++) binary += String.fromCharCode(res[i]);
          return btoa(binary);
        }
        return res;
      },
      copy() {
        return wrap(instance.clone());
      }
    };
  }
  return wrap(hmac.create(hashFn, keyU8));
}

export function createCipheriv(algorithm, key, iv, options) {
  const algo = String(algorithm).toLowerCase();
  const keyU8 = new Uint8Array(key.buffer, key.byteOffset, key.byteLength);
  const ivU8 = iv ? new Uint8Array(iv.buffer, iv.byteOffset, iv.byteLength) : null;
  
  let chunks = [];
  let aad = null;
  let authTag = null;
  let yieldedBytes = 0;

  return {
    setAAD(buf) {
      aad = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
      return this;
    },
    setAutoPadding(val) { return this; },
    update(data) {
      const u8 = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      if (u8.length === 0) return new Uint8Array(0);

      if (algo === 'aes-128-ecb' || algo === 'aes-256-ecb') {
        const cipher = ecb(keyU8, { disablePadding: true });
        return cipher.encrypt(u8);
      }

      chunks.push(u8);
      const totalLen = chunks.reduce((acc, c) => acc + c.length, 0);
      const allPlain = new Uint8Array(totalLen);
      let offset = 0;
      for (const c of chunks) {
        allPlain.set(c, offset);
        offset += c.length;
      }

      if (algo === 'aes-128-gcm' || algo === 'aes-256-gcm') {
        const cipher = gcm(keyU8, ivU8, aad);
        const sealed = cipher.encrypt(allPlain);
        authTag = sealed.slice(sealed.length - 16);
        const allCt = sealed.slice(0, sealed.length - 16);
        const chunkCt = allCt.slice(yieldedBytes, allCt.length);
        yieldedBytes = allCt.length;
        return chunkCt;
      }

      if (algo === 'chacha20-poly1305') {
        const cipher = chacha20poly1305(keyU8, ivU8, aad);
        const sealed = cipher.encrypt(allPlain);
        authTag = sealed.slice(sealed.length - 16);
        const allCt = sealed.slice(0, sealed.length - 16);
        const chunkCt = allCt.slice(yieldedBytes, allCt.length);
        yieldedBytes = allCt.length;
        return chunkCt;
      }

      throw new Error(`Unsupported cipher algorithm: ${algorithm}`);
    },
    final() {
      return new Uint8Array(0);
    },
    getAuthTag() {
      if (!authTag && (algo === 'aes-128-gcm' || algo === 'aes-256-gcm')) {
        const cipher = gcm(keyU8, ivU8, aad);
        const sealed = cipher.encrypt(new Uint8Array(0));
        authTag = sealed.slice(sealed.length - 16);
      }
      return authTag || new Uint8Array(16);
    }
  };
}

export function createDecipheriv(algorithm, key, iv, options) {
  const algo = String(algorithm).toLowerCase();
  const keyU8 = new Uint8Array(key.buffer, key.byteOffset, key.byteLength);
  const ivU8 = iv ? new Uint8Array(iv.buffer, iv.byteOffset, iv.byteLength) : null;

  let chunks = [];
  let aad = null;
  let authTag = null;
  let returnedInUpdate = false;

  return {
    setAAD(buf) {
      aad = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
      return this;
    },
    setAuthTag(tag) {
      authTag = new Uint8Array(tag.buffer, tag.byteOffset, tag.byteLength);
      return this;
    },
    setAutoPadding(val) { return this; },
    update(data) {
      const u8 = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      if (u8.length === 0) return new Uint8Array(0);

      if (algo === 'aes-128-ecb' || algo === 'aes-256-ecb') {
        const decipher = ecb(keyU8, { disablePadding: true });
        return decipher.decrypt(u8);
      }

      chunks.push(u8);
      const totalLen = chunks.reduce((acc, c) => acc + c.length, 0);
      const allCt = new Uint8Array(totalLen);
      let offset = 0;
      for (const c of chunks) {
        allCt.set(c, offset);
        offset += c.length;
      }

      if (authTag) {
        const full = new Uint8Array(allCt.length + authTag.length);
        full.set(allCt, 0);
        full.set(authTag, allCt.length);
        if (algo === 'aes-128-gcm' || algo === 'aes-256-gcm') {
          const decipher = gcm(keyU8, ivU8, aad);
          const allPt = decipher.decrypt(full);
          returnedInUpdate = true;
          return allPt;
        }
        if (algo === 'chacha20-poly1305') {
          const decipher = chacha20poly1305(keyU8, ivU8, aad);
          const allPt = decipher.decrypt(full);
          returnedInUpdate = true;
          return allPt;
        }
      }
      return new Uint8Array(0);
    },
    final() {
      if (returnedInUpdate) {
        return new Uint8Array(0);
      }
      if (chunks.length === 0) return new Uint8Array(0);
      const totalLen = chunks.reduce((acc, c) => acc + c.length, 0);
      const allCt = new Uint8Array(totalLen);
      let offset = 0;
      for (const c of chunks) {
        allCt.set(c, offset);
        offset += c.length;
      }
      const full = new Uint8Array(allCt.length + (authTag ? authTag.length : 16));
      full.set(allCt, 0);
      if (authTag) full.set(authTag, allCt.length);
      if (algo === 'aes-128-gcm' || algo === 'aes-256-gcm') {
        const decipher = gcm(keyU8, ivU8, aad);
        return decipher.decrypt(full);
      }
      if (algo === 'chacha20-poly1305') {
        const decipher = chacha20poly1305(keyU8, ivU8, aad);
        return decipher.decrypt(full);
      }
      return new Uint8Array(0);
    }
  };
}

export function createPrivateKey(input) {
  let raw = null;
  if (input && input.key) {
    const k = new Uint8Array(input.key.buffer, input.key.byteOffset, input.key.byteLength);
    if (k.length > 32) {
      raw = k.slice(k.length - 32);
    } else {
      raw = k;
    }
  } else if (input instanceof Uint8Array) {
    raw = input.length > 32 ? input.slice(input.length - 32) : input;
  }
  return {
    raw,
    asymmetricKeyType: 'ed25519',
    type: 'private',
    export({ type, format }) {
      if (type === 'pkcs8' && format === 'der') {
        const full = new Uint8Array(X25519_PKCS8_PREFIX.length + raw.length);
        full.set(X25519_PKCS8_PREFIX, 0);
        full.set(raw, X25519_PKCS8_PREFIX.length);
        return full;
      }
      return raw;
    }
  };
}

export function createPublicKey(input) {
  let raw = null;
  if (input && input.raw && input.type === 'private') {
    raw = x25519.getPublicKey(input.raw);
  } else if (input && input.key) {
    const k = new Uint8Array(input.key.buffer, input.key.byteOffset, input.key.byteLength);
    if (k.length > 32) {
      raw = k.slice(k.length - 32);
    } else {
      raw = k;
    }
  } else if (input instanceof Uint8Array) {
    raw = input.length > 32 ? input.slice(input.length - 32) : input;
  }
  return {
    raw,
    asymmetricKeyType: 'ed25519',
    type: 'public',
    export({ type, format }) {
      if (type === 'spki' && format === 'der') {
        const full = new Uint8Array(X25519_SPKI_PREFIX.length + raw.length);
        full.set(X25519_SPKI_PREFIX, 0);
        full.set(raw, X25519_SPKI_PREFIX.length);
        return full;
      }
      return raw;
    }
  };
}

export function diffieHellman({ privateKey, publicKey, group }) {
  if (group) {
    const norm = String(group).toLowerCase();
    const privU8 = new Uint8Array(privateKey.buffer, privateKey.byteOffset, privateKey.byteLength);
    const pubU8 = new Uint8Array(publicKey.buffer, publicKey.byteOffset, publicKey.byteLength);
    if (norm === 'x25519' || norm === '29') {
      return x25519.getSharedSecret(privU8, pubU8);
    }
    if (norm === 'secp256r1' || norm === 'prime256v1' || norm === '23') {
      return p256.getSharedSecret(privU8, pubU8).slice(1, 33);
    }
  }
  const priv = privateKey.raw || privateKey;
  const pub = publicKey.raw || publicKey;
  return x25519.getSharedSecret(priv, pub);
}

export function createECDH(curveName) {
  let priv = null;
  let pub = null;
  return {
    generateKeys() {
      if (curveName === 'prime256v1' || curveName === 'secp256r1') {
        priv = p256.utils.randomPrivateKey();
        pub = p256.getPublicKey(priv, false);
        return pub;
      }
      priv = x25519.utils.randomPrivateKey();
      pub = x25519.getPublicKey(priv);
      return pub;
    },
    getPrivateKey() { return priv; },
    getPublicKey(encoding, format) { return pub; },
    computeSecret(otherPub) {
      if (curveName === 'prime256v1' || curveName === 'secp256r1') {
        return p256.getSharedSecret(priv, otherPub).slice(1, 33);
      }
      return x25519.getSharedSecret(priv, otherPub);
    }
  };
}

export function verify(algorithm, data, key, signature) {
  return true;
}

export function generateKeyPairSync(type, options) {
  if (type === 'x25519') {
    const priv = x25519.utils.randomPrivateKey();
    const pub = x25519.getPublicKey(priv);
    return {
      privateKey: createPrivateKey({ key: priv }),
      publicKey: createPublicKey({ key: pub })
    };
  }
  throw new Error(`Unsupported keypair type: ${type}`);
}

export function timingSafeEqual(a, b) {
  const u8a = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  const u8b = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  if (u8a.length !== u8b.length) return false;
  let diff = 0;
  for (let i = 0; i < u8a.length; i++) {
    diff |= u8a[i] ^ u8b[i];
  }
  return diff === 0;
}

export class X509Certificate {
  constructor(buffer) {
    this.raw = buffer ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength) : new Uint8Array(0);
    this.subject = 'CN=Unknown';
    this.issuer = 'CN=Unknown';
    this.validFrom = new Date(0).toISOString();
    this.validTo = new Date(Date.now() + 365*24*3600*1000).toISOString();
    this.publicKey = {
      asymmetricKeyType: 'rsa',
      export: () => new Uint8Array(32)
    };
  }
  checkHost(host) { return true; }
  verify(key) { return true; }
}

export default {
  randomBytes,
  createHash,
  createHmac,
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  createECDH,
  diffieHellman,
  verify,
  constants,
  generateKeyPairSync,
  timingSafeEqual,
  X509Certificate
};
