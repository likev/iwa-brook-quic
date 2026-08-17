import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

function createPng(width, height, getRgba) {
  // PNG signature
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  function crc32(buf) {
    let table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[i] = c >>> 0;
    }
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function createChunk(type, data) {
    const typeBuf = Buffer.from(type, 'ascii');
    const lengthBuf = Buffer.alloc(4);
    lengthBuf.writeUInt32BE(data.length, 0);

    const bodyBuf = Buffer.concat([typeBuf, data]);
    const crcVal = crc32(bodyBuf);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crcVal, 0);

    return Buffer.concat([lengthBuf, bodyBuf, crcBuf]);
  }

  // IHDR
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData.writeUInt8(8, 8); // bit depth 8
  ihdrData.writeUInt8(6, 9); // color type 6 (RGBA)
  ihdrData.writeUInt8(0, 10); // compression 0
  ihdrData.writeUInt8(0, 11); // filter 0
  ihdrData.writeUInt8(0, 12); // interlace 0
  const ihdrChunk = createChunk('IHDR', ihdrData);

  // Scanlines with filter byte 0 (None)
  const rawBytes = Buffer.alloc(height * (width * 4 + 1));
  let offset = 0;
  for (let y = 0; y < height; y++) {
    rawBytes[offset++] = 0; // Filter byte: 0
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = getRgba(x, y, width, height);
      rawBytes[offset++] = r;
      rawBytes[offset++] = g;
      rawBytes[offset++] = b;
      rawBytes[offset++] = a;
    }
  }

  const compressed = zlib.deflateSync(rawBytes);
  const idatChunk = createChunk('IDAT', compressed);
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function writeIconFiles(appDir, svgContent, sampler) {
  const assetsDir = path.resolve(appDir, 'assets');
  const iconsDir = path.resolve(appDir, 'icons');
  fs.mkdirSync(assetsDir, { recursive: true });
  fs.mkdirSync(iconsDir, { recursive: true });

  const png192 = createPng(192, 192, sampler);
  const png512 = createPng(512, 512, sampler);

  // Write to assets/
  fs.writeFileSync(path.join(assetsDir, 'icon.svg'), svgContent, 'utf-8');
  fs.writeFileSync(path.join(assetsDir, 'icon-192.png'), png192);
  fs.writeFileSync(path.join(assetsDir, 'icon-512.png'), png512);

  // Write to icons/
  fs.writeFileSync(path.join(iconsDir, 'icon.svg'), svgContent, 'utf-8');
  fs.writeFileSync(path.join(iconsDir, 'icon-192.png'), png192);
  fs.writeFileSync(path.join(iconsDir, 'icon-512.png'), png512);
}

// Generate Listener Icons (Emerald/Teal Theme with Server/Antenna design)
function generateListenerIcons() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0f172a"/>
      <stop offset="100%" stop-color="#022c22"/>
    </linearGradient>
    <linearGradient id="accent" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#34d399"/>
      <stop offset="100%" stop-color="#059669"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="128" fill="url(#bg)" stroke="#10b981" stroke-width="8"/>
  <rect x="128" y="112" width="256" height="288" rx="24" fill="#1e293b" stroke="#34d399" stroke-width="12"/>
  <line x1="160" y1="184" x2="352" y2="184" stroke="#475569" stroke-width="8" stroke-linecap="round"/>
  <line x1="160" y1="256" x2="352" y2="256" stroke="#475569" stroke-width="8" stroke-linecap="round"/>
  <line x1="160" y1="328" x2="352" y2="328" stroke="#475569" stroke-width="8" stroke-linecap="round"/>
  <circle cx="176" cy="148" r="14" fill="#34d399"/>
  <circle cx="216" cy="148" r="14" fill="#38bdf8"/>
  <circle cx="176" cy="220" r="14" fill="#34d399"/>
  <circle cx="176" cy="292" r="14" fill="#34d399"/>
  <path d="M 330 148 A 40 40 0 0 1 360 178" fill="none" stroke="#34d399" stroke-width="8" stroke-linecap="round"/>
  <path d="M 345 133 A 60 60 0 0 1 390 178" fill="none" stroke="#34d399" stroke-width="8" stroke-linecap="round" opacity="0.6"/>
  <text x="256" y="440" text-anchor="middle" fill="#34d399" font-family="system-ui, sans-serif" font-weight="800" font-size="36" letter-spacing="4">TCP LISTENER</text>
</svg>`;

  const listenerSampler = (x, y, w, h) => {
    const nx = (x / w) * 2 - 1;
    const ny = (y / h) * 2 - 1;
    const r2 = nx * nx + ny * ny;
    if (r2 > 0.95) return [0, 0, 0, 0];

    let bgR = Math.floor(15 + (x / w) * 10);
    let bgG = Math.floor(23 + (y / h) * 45);
    let bgB = Math.floor(42 - (y / h) * 20);

    if (x >= w * 0.25 && x <= w * 0.75 && y >= h * 0.22 && y <= h * 0.78) {
      if (
        x <= w * 0.25 + 6 || x >= w * 0.75 - 6 ||
        y <= h * 0.22 + 6 || y >= h * 0.78 - 6
      ) {
        return [52, 211, 153, 255];
      }
      return [30, 41, 59, 255];
    }

    return [bgR, bgG, bgB, 255];
  };

  writeIconFiles('listener', svg, listenerSampler);
}

// Generate Client Icons (Cyan/Blue Theme with Signal/Packet design)
function generateClientIcons() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="bg-client" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#082f49"/>
      <stop offset="100%" stop-color="#0f172a"/>
    </linearGradient>
    <linearGradient id="accent-client" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#38bdf8"/>
      <stop offset="100%" stop-color="#0284c7"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="128" fill="url(#bg-client)" stroke="#0284c7" stroke-width="8"/>
  <path d="M 140 160 L 260 256 L 140 352 Z" fill="url(#accent-client)" stroke="#38bdf8" stroke-width="8"/>
  <path d="M 270 160 L 390 256 L 270 352 Z" fill="#38bdf8" stroke="#7dd3fc" stroke-width="8"/>
  <circle cx="390" cy="256" r="16" fill="#f8fafc"/>
  <text x="256" y="440" text-anchor="middle" fill="#38bdf8" font-family="system-ui, sans-serif" font-weight="800" font-size="36" letter-spacing="4">TCP CLIENT</text>
</svg>`;

  const clientSampler = (x, y, w, h) => {
    const nx = (x / w) * 2 - 1;
    const ny = (y / h) * 2 - 1;
    const r2 = nx * nx + ny * ny;
    if (r2 > 0.95) return [0, 0, 0, 0];

    let bgR = Math.floor(15 + (x / w) * 5);
    let bgG = Math.floor(23 + (y / h) * 35);
    let bgB = Math.floor(42 + (y / h) * 40);

    if (x >= w * 0.3 && x <= w * 0.7 && Math.abs(y - h * 0.5) <= (x - w * 0.25) * 0.6) {
      return [56, 189, 248, 255];
    }

    return [bgR, bgG, bgB, 255];
  };

  writeIconFiles('client', svg, clientSampler);
}

// Generate Brook QUIC Client Icons (Blue/Indigo Theme with Lightning Bolt)
function generateBrookIcons() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="bg-brook" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0b0f19"/>
      <stop offset="100%" stop-color="#1e1b4b"/>
    </linearGradient>
    <linearGradient id="accent-brook" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#60a5fa"/>
      <stop offset="100%" stop-color="#2563eb"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="128" fill="url(#bg-brook)" stroke="#3b82f6" stroke-width="8"/>
  <polygon points="280,80 160,280 260,280 230,432 360,220 260,220" fill="url(#accent-brook)" stroke="#93c5fd" stroke-width="8"/>
  <text x="256" y="468" text-anchor="middle" fill="#60a5fa" font-family="system-ui, sans-serif" font-weight="800" font-size="34" letter-spacing="4">BROOK QUIC</text>
</svg>`;

  const brookSampler = (x, y, w, h) => {
    const nx = (x / w) * 2 - 1;
    const ny = (y / h) * 2 - 1;
    const r2 = nx * nx + ny * ny;
    if (r2 > 0.95) return [0, 0, 0, 0];

    let bgR = Math.floor(11 + (x / w) * 20);
    let bgG = Math.floor(15 + (y / h) * 15);
    let bgB = Math.floor(25 + (y / h) * 55);

    if (x >= w * 0.35 && x <= w * 0.65 && y >= h * 0.2 && y <= h * 0.8) {
      if (Math.abs(x - y * 0.3 - w * 0.3) < w * 0.1) {
        return [96, 165, 250, 255];
      }
    }

    return [bgR, bgG, bgB, 255];
  };

  writeIconFiles('brook-quicclient', svg, brookSampler);
}

console.log('Generating IWA icons for assets/ and icons/ ...');
generateListenerIcons();
generateClientIcons();
generateBrookIcons();
console.log('Icons generated successfully.');
