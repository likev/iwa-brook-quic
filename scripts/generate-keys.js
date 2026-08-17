import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const keysDir = path.resolve('keys');
fs.mkdirSync(keysDir, { recursive: true });

function ensureKey(name) {
  const keyPath = path.join(keysDir, `${name}.pem`);
  if (!fs.existsSync(keyPath)) {
    console.log(`Generating Ed25519 private key for ${name}...`);
    const { privateKey } = crypto.generateKeyPairSync('ed25519', {
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });
    fs.writeFileSync(keyPath, privateKey, 'utf-8');
    console.log(`Saved key to ${keyPath}`);
  } else {
    console.log(`Existing key found at ${keyPath}`);
  }
  return keyPath;
}

ensureKey('listener');
ensureKey('client');
ensureKey('brook');
console.log('Key generation complete.');
