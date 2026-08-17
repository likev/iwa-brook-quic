import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const distDir = path.resolve('dist');
fs.mkdirSync(distDir, { recursive: true });

console.log('=== Building Isolated Web Apps (IWAs) with Update Manifests ===\n');

// 1. Ensure keys and icons
execSync('node scripts/generate-keys.js', { stdio: 'inherit' });
execSync('node scripts/generate-icons.js', { stdio: 'inherit' });

// 2. Pre-bundle vendor QUIC engine for brook-quicclient
console.log('\n--- Pre-bundling QUIC engine for brook-quicclient ---');
const banner = `var Buffer = globalThis.Buffer || {
  isBuffer: v => v instanceof Uint8Array || (v && v.buffer instanceof ArrayBuffer),
  from: (v, e) => {
    if (typeof v === 'string') {
      if (e === 'hex') {
        const c = v.replace(/[^0-9a-fA-F]/g, '');
        const b = new Uint8Array(Math.floor(c.length / 2));
        for (let i = 0; i < b.length; i++) b[i] = parseInt(c.substr(i * 2, 2), 16);
        return b;
      }
      if (e === 'base64') {
        const bin = atob(v);
        const b = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
        return b;
      }
      return new TextEncoder().encode(v);
    }
    return v instanceof Uint8Array ? v : new Uint8Array(v || 0);
  },
  alloc: s => new Uint8Array(s),
  allocUnsafe: s => new Uint8Array(s),
  concat: l => {
    const t = l.reduce((a, b) => a + (b ? b.length : 0), 0);
    const r = new Uint8Array(t);
    let o = 0;
    for (const b of l) {
      if (!b) continue;
      r.set(b, o);
      o += b.length;
    }
    return r;
  }
};
globalThis.Buffer = Buffer;
if (typeof globalThis.process === 'undefined') {
  globalThis.process = { env: {}, nextTick: (f, ...a) => queueMicrotask(() => f(...a)), browser: true };
}
var process = globalThis.process;`;

execSync(`npx esbuild scripts/vendor-entry.js --bundle --format=esm --platform=browser \
  --banner:js="${banner.replace(/\n/g, ' ')}" \
  --inject:./scripts/shims/buffer.js \
  --alias:node:crypto=./scripts/browser-crypto-shim.js \
  --alias:crypto=./scripts/browser-crypto-shim.js \
  --alias:node:events=./scripts/shims/events.js \
  --alias:events=./scripts/shims/events.js \
  --alias:node:buffer=./scripts/shims/buffer.js \
  --alias:buffer=./scripts/shims/buffer.js \
  --alias:node:dgram=./scripts/shims/empty.js \
  --alias:dgram=./scripts/shims/empty.js \
  --alias:node:net=./scripts/shims/empty.js \
  --alias:net=./scripts/shims/empty.js \
  --alias:node:tls=./scripts/shims/empty.js \
  --alias:tls=./scripts/shims/empty.js \
  --alias:node:stream=./scripts/shims/empty.js \
  --alias:stream=./scripts/shims/empty.js \
  --alias:node:fs=./scripts/shims/empty.js \
  --alias:fs=./scripts/shims/empty.js \
  --alias:node:path=./scripts/shims/empty.js \
  --alias:path=./scripts/shims/empty.js \
  --outfile=brook-quicclient/vendor/quic-engine.bundle.js`, { stdio: 'inherit' });

const IWA_BASE_URL = process.env.IWA_BASE_URL || 'https://t.iread.fun/downloads/iwa/dist';

function buildApp(name, keyName = null) {
  console.log(`\n--- Bundling ${name} ---`);
  const appDir = path.resolve(name);
  const manifestPath = path.join(appDir, 'manifest.webmanifest');
  const manifestData = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  const version = manifestData.version || '1.0.0';

  const unsignedWbn = path.join(distDir, `${name}.wbn`);
  const signedSwbn = path.join(distDir, `${name}.swbn`);
  const versionedSwbn = path.join(distDir, `${name}-v${version}.swbn`);
  const keyPath = path.resolve('keys', `${keyName || name}.pem`);

  // Package into unsigned wbn with proper base URL for IWA resource resolution
  console.log(`Packaging ${appDir} -> ${unsignedWbn}`);
  execSync(`npx wbn -d "${appDir}" -b "/" -o "${unsignedWbn}"`, { stdio: 'inherit' });

  // Sign with private key
  console.log(`Signing ${unsignedWbn} with ${keyPath} -> ${signedSwbn}`);
  execSync(`npx wbn-sign sign "${unsignedWbn}" "${keyPath}" -o "${signedSwbn}"`, {
    stdio: 'inherit'
  });

  // Copy to versioned .swbn file
  fs.copyFileSync(signedSwbn, versionedSwbn);
  console.log(`Copied to versioned bundle: ${versionedSwbn}`);

  // Extract Web Bundle ID
  const infoOutput = execSync(`npx wbn-sign info "${signedSwbn}"`, { encoding: 'utf-8' });
  const idMatch = infoOutput.match(/Web bundle ID:\s*([a-z0-9]+)/i);
  const bundleId = idMatch ? idMatch[1].trim() : 'Unknown';

  // Generate Update Manifest
  const updateUrl = `${IWA_BASE_URL}/${name}-v${version}.swbn`;
  const updateManifest = {
    versions: [
      {
        version: version,
        src: updateUrl,
        channels: ["default"]
      }
    ]
  };

  // Write update manifest files
  const updateManifestFlat = path.join(distDir, `${name}-update-manifest.json`);
  fs.writeFileSync(updateManifestFlat, JSON.stringify(updateManifest, null, 2), 'utf-8');

  // Also support short name manifest (e.g. brook-update-manifest.json)
  if (name === 'brook-quicclient') {
    fs.writeFileSync(path.join(distDir, 'brook-update-manifest.json'), JSON.stringify(updateManifest, null, 2), 'utf-8');
  }

  const appDistDir = path.join(distDir, name);
  fs.mkdirSync(appDistDir, { recursive: true });
  const updateManifestNested = path.join(appDistDir, 'update_manifest.json');
  fs.writeFileSync(updateManifestNested, JSON.stringify(updateManifest, null, 2), 'utf-8');

  console.log(`✅ Successfully built: ${signedSwbn}`);
  console.log(`   Versioned File:     ${versionedSwbn}`);
  console.log(`   Web Bundle ID:      ${bundleId}`);
  console.log(`   IWA Origin:         isolated-app://${bundleId}/`);
  console.log(`   Update URL (src):   ${updateUrl}`);
  console.log(`   Update Manifest:    ${updateManifestFlat}\n`);

  return {
    name,
    version,
    bundleId,
    origin: `isolated-app://${bundleId}/`,
    bundlePath: signedSwbn,
    versionedBundlePath: versionedSwbn,
    updateUrl,
    updateManifestPath: updateManifestFlat,
    updateManifest
  };
}

const apps = [
  buildApp('listener', 'listener'),
  buildApp('client', 'client'),
  buildApp('brook-quicclient', 'brook')
];

const summaryPath = path.join(distDir, 'manifest-summary.json');
fs.writeFileSync(summaryPath, JSON.stringify(apps, null, 2), 'utf-8');

console.log('=== All Signed Web Bundles and Update Manifests Built Successfully! ===');
apps.forEach(app => {
  console.log(`- ${app.name.toUpperCase()} (v${app.version}):`);
  console.log(`  Bundle:          ${app.versionedBundlePath}`);
  console.log(`  Origin:          ${app.origin}`);
  console.log(`  Update URL:      ${app.updateUrl}`);
  console.log(`  Update Manifest: ${app.updateManifestPath}`);
});
