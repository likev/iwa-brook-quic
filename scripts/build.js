import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const distDir = path.resolve('dist');
fs.mkdirSync(distDir, { recursive: true });

console.log('=== Building Isolated Web Apps (IWAs) with Update Manifests ===\n');

// 1. Ensure keys and icons
execSync('node scripts/generate-keys.js', { stdio: 'inherit' });
execSync('node scripts/generate-icons.js', { stdio: 'inherit' });

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
