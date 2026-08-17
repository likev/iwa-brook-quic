import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const HUB_PORT = parseInt(process.env.HUB_PORT, 10) || 8000;
const LISTENER_PORT = parseInt(process.env.LISTENER_PORT, 10) || 8081;
const CLIENT_PORT = parseInt(process.env.CLIENT_PORT, 10) || 8082;
const BROOK_PORT = parseInt(process.env.BROOK_PORT, 10) || 8083;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.swbn': 'application/signed-web-bundle',
  '.wbn': 'application/webbundle'
};

function createStaticServer(name, rootDir, port, isIwa = false) {
  const server = http.createServer((req, res) => {
    let reqPath = req.url.split('?')[0];
    if (reqPath === '/') reqPath = '/index.html';

    const filePath = path.join(rootDir, reqPath);

    // Security check
    if (!filePath.startsWith(rootDir)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    fs.stat(filePath, (err, stats) => {
      if (err || !stats.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end(`Not Found: ${reqPath}`);
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';

      const headers = {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Access-Control-Allow-Origin': '*'
      };

      // IWA required security headers
      if (isIwa) {
        headers['Cross-Origin-Opener-Policy'] = 'same-origin';
        headers['Cross-Origin-Embedder-Policy'] = 'require-corp';
        headers['Cross-Origin-Resource-Policy'] = 'same-origin';
        headers['Permissions-Policy'] = 'direct-sockets=(self), direct-sockets-private=(self), cross-origin-isolated=(self), local-network=(self), loopback-network=(self)';
        headers['Content-Security-Policy'] = "base-uri 'none'; default-src 'self' 'wasm-unsafe-eval' https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; connect-src 'self' https: wss:;";
      }

      res.writeHead(200, headers);
      fs.createReadStream(filePath).pipe(res);
    });
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`🚀 [${name}] serving on http://localhost:${port}`);
  });

  return server;
}

console.log('=== Starting Isolated Web Apps (IWA) Dev Servers ===\n');

// 1. Hub Dashboard
createStaticServer('Hub Dashboard', path.resolve('hub'), HUB_PORT, false);

// 2. TCP Listener IWA
createStaticServer('TCP Listener IWA', path.resolve('listener'), LISTENER_PORT, true);

// 3. TCP Client IWA
createStaticServer('TCP Client IWA', path.resolve('client'), CLIENT_PORT, true);

// 4. Brook QUIC Client IWA
createStaticServer('Brook QUIC Client IWA', path.resolve('brook-quicclient'), BROOK_PORT, true);

console.log('\nAll servers running:');
console.log(`- 🌐 Hub & Guide:            http://localhost:${HUB_PORT}`);
console.log(`- 👂 TCP Listener IWA:       http://localhost:${LISTENER_PORT}`);
console.log(`- ⚡ TCP Client IWA:         http://localhost:${CLIENT_PORT}`);
console.log(`- ⚡ Brook QUIC Client IWA:  http://localhost:${BROOK_PORT}\n`);
