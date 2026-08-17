import crypto from './browser-crypto-shim.js';

function testCrypto() {
  const key = new Uint8Array(16);
  crypto.randomBytes(16).forEach((b, i) => key[i] = b);
  const iv = new Uint8Array(12);
  crypto.randomBytes(12).forEach((b, i) => iv[i] = b);
  const aad = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  const plaintext = new TextEncoder().encode('Hello QUIC world 1234567890');

  // Encrypt
  const cipher = crypto.createCipheriv('aes-128-gcm', key, iv);
  cipher.setAAD(aad);
  const enc1 = cipher.update(plaintext);
  const enc2 = cipher.final();
  const tag = cipher.getAuthTag();
  const ct = new Uint8Array(enc1.length + enc2.length);
  ct.set(enc1, 0);
  ct.set(enc2, enc1.length);

  console.log('Encrypted CT len:', ct.length, 'Tag len:', tag.length);

  // Decrypt
  const decipher = crypto.createDecipheriv('aes-128-gcm', key, iv);
  decipher.setAuthTag(tag);
  decipher.setAAD(aad);
  const dec1 = decipher.update(ct);
  const dec2 = decipher.final();
  const pt = new Uint8Array(dec1.length + dec2.length);
  pt.set(dec1, 0);
  pt.set(dec2, dec1.length);

  console.log('Decrypted PT:', new TextDecoder().decode(pt));
  if (new TextDecoder().decode(pt) === 'Hello QUIC world 1234567890') {
    console.log('✅ AES-GCM Encrypt & Decrypt Match!');
  } else {
    console.error('❌ Mismatch!');
    process.exit(1);
  }
}

testCrypto();
