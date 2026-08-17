# Isolated Web Apps (IWAs) — Direct Sockets Demo

A complete demonstration of **Isolated Web Apps (IWAs)** using Chrome's native **Direct Sockets API**:
1. **TCP Listener IWA** — Listens on an OS-assigned **random ephemeral port** (or custom port) using `new TCPServerSocket()`, accepts multiple simultaneous TCP client connections, displays live packet traffic, and supports auto-echo and hex inspection.
2. **TCP Client IWA** — Allows users to input any target **IP address and Port** to establish raw TCP sockets using `new TCPSocket()`, send text/hex payloads, benchmark round-trip latency (RTT), and inspect raw packets.

---

## 🌟 Key Highlights & Features

- **Native Direct Sockets API**: Fully compliant with W3C/WICG Direct Sockets specifications (`TCPServerSocket` and `TCPSocket`).
- **IWA Manifests & Security Headers**: Full `permissions_policy` (`direct-sockets`, `local-network`, `loopback-network`, `cross-origin-isolated`), COOP (`same-origin`), COEP (`require-corp`), and CORP headers.
- **Signed Web Bundle (.swbn) Support**: Pre-configured bundling and signing scripts (`wbn` and `wbn-sign`) using Ed25519 cryptography.
- **Bi-Directional Packet Inspector**: Real-time ASCII and Hex dump modal for any received or transmitted TCP packet.
- **Auto-Echo & RTT Latency Calculator**: Built-in echo server modes and microsecond-level ping latency benchmarks.
- **Interactive Simulator Fallback**: Enables full UI, traffic stream, and hex inspector testing even when running in standard browser tabs without IWA flags enabled.

---

## 📁 Project Architecture

```
/root/downloads/iwa/
├── hub/                          # Hub landing page & setup dashboard
│   ├── index.html
│   └── styles.css
├── listener/                     # TCP Listener Isolated Web App
│   ├── index.html
│   ├── app.js                   # TCPServerSocket implementation
│   ├── styles.css
│   ├── manifest.webmanifest
│   ├── .well-known/manifest.webmanifest
│   └── assets/                  # Icons (PNG 192/512, SVG)
├── client/                       # TCP Client Isolated Web App
│   ├── index.html
│   ├── app.js                   # TCPSocket implementation
│   ├── styles.css
│   ├── manifest.webmanifest
│   ├── .well-known/manifest.webmanifest
│   └── assets/                  # Icons (PNG 192/512, SVG)
├── dist/                         # Compiled Web Bundles (.wbn / .swbn) & Update Manifests
│   ├── listener.swbn            # Web Bundle ID: u2uwu7f3ihcmiqejcwxfkkgbwj5tjkqaxu6ohud2pbu2fbcoxveaaaic
│   ├── listener-v1.12.0.swbn
│   ├── listener-update-manifest.json
│   ├── client.swbn              # Web Bundle ID: n3ywd6x7rc7iqzgiwnobvhldakbliigueenvj2gew5u3bfkp6rcaaaic
│   ├── client-v1.12.0.swbn
│   ├── client-update-manifest.json
│   ├── brook-quicclient.swbn    # Web Bundle ID: 5uad6swnv66tot24df52mjr7nc7pmnmwmmxofkkshietmn3nthqqaaic
│   ├── brook-quicclient-v1.12.0.swbn
│   └── brook-quicclient-update-manifest.json
├── keys/                         # Ed25519 Signing Keys
│   ├── listener.pem
│   └── client.pem
├── scripts/
│   ├── build.js                 # Builds & signs .swbn bundles
│   ├── generate-keys.js         # Generates Ed25519 keys
│   ├── generate-icons.js        # Generates PWA/IWA icons
│   └── test-tcp.js              # External Node.js TCP CLI testing tool
├── server.js                     # Local Dev Server with required IWA headers
└── package.json
```

---

## 🚀 Quick Start

### 1. Start the Local Dev Servers

```bash
npm start
# or
npm run dev
```

This starts:
- **🌐 Hub & Guide**: `http://localhost:8000`
- **👂 TCP Listener IWA**: `http://localhost:8081`
- **⚡ TCP Client IWA**: `http://localhost:8082`

---

## 🔧 Running in Google Chrome / Chromium

Isolated Web Apps and Direct Sockets require enabling developer flags in Chrome 120+:

### Step 1: Enable Chrome Flags
1. Open Chrome and navigate to:
   - `chrome://flags/#enable-isolated-web-apps` &rarr; **Enabled**
   - `chrome://flags/#enable-isolated-web-app-dev-mode` &rarr; **Enabled**
2. Restart Chrome.

### Step 2: Install via Dev Mode Proxy
1. In Chrome, navigate to `chrome://web-app-internals`.
2. Scroll to the **"Install Isolated Web App from Dev Server"** section.
3. **Install Listener**: Enter `http://localhost:8081` &rarr; Click **Install**.
4. **Install Client**: Enter `http://localhost:8082` &rarr; Click **Install**.
5. Launch both apps from your desktop / Chrome app launcher!

### Step 3 (Optional): Install via Signed Web Bundle (`.swbn`)
1. Run the build script:
   ```bash
   npm run build
   ```
2. In `chrome://web-app-internals`, use the **"Install Isolated Web App from Signed Web Bundle"** file picker to select `dist/listener.swbn` or `dist/client.swbn`.

---

## 💻 API Implementations Explained

### 1. TCP Listener (`TCPServerSocket`) on Random Port

```javascript
// Step 1: Instantiate TCPServerSocket with random port (localPort: 0)
const serverSocket = new TCPServerSocket('0.0.0.0', {
  backlog: 100
  // localPort is omitted or 0 to let OS assign an available random port
});

// Step 2: Await opening to get assigned localPort
const { readable, localAddress, localPort } = await serverSocket.opened;
console.log(`Server listening on ${localAddress}:${localPort}`);

// Step 3: Accept incoming client connections from the stream
const reader = readable.getReader();
while (true) {
  const { value: clientSocket, done } = await reader.read();
  if (done) break;
  
  // clientSocket is a TCPSocket instance
  handleClient(clientSocket);
}

// Step 4: Communicate with accepted client socket
async function handleClient(clientSocket) {
  const { readable, writable, remoteAddress, remotePort } = await clientSocket.opened;
  
  // Read data from client
  const clientReader = readable.getReader();
  const { value: bytes } = await clientReader.read(); // Uint8Array
  
  // Send data / echo back
  const clientWriter = writable.getWriter();
  await clientWriter.write(new TextEncoder().encode("Hello from IWA Listener!\r\n"));
}
```

### 2. TCP Client (`TCPSocket`) with User Input IP & Port

```javascript
// Step 1: Instantiate TCPSocket to target host & port
const targetIp = '127.0.0.1';
const targetPort = 49215; // User inputted port

const socket = new TCPSocket(targetIp, targetPort, {
  noDelay: true // TCP_NODELAY
});

// Step 2: Await opening to access readable and writable streams
const { readable, writable, remoteAddress, remotePort, localAddress, localPort } = await socket.opened;
console.log(`Connected to ${remoteAddress}:${remotePort} (Local: ${localAddress}:${localPort})`);

// Step 3: Write payload
const writer = writable.getWriter();
await writer.write(new TextEncoder().encode("Hello TCP Server!\r\n"));

// Step 4: Read responses
const reader = readable.getReader();
while (true) {
  const { value: uint8Array, done } = await reader.read();
  if (done) break;
  console.log("Received:", new TextDecoder().decode(uint8Array));
}
```

---

## 🧪 Testing with External CLI TCP Tools

You can test socket communication between external command-line utilities and the browser IWAs using the included Node.js test script:

```bash
# Connect to the browser's TCP Listener IWA:
npm run test:tcp-client 49215 127.0.0.1

# Run an external TCP server for the browser's TCP Client IWA to connect to:
npm run test:tcp-server 8080
```

---

## 📜 Manifest Permissions Policy Configuration

Inside `/.well-known/manifest.webmanifest`:

```json
{
  "name": "TCP Listener - Isolated Web App",
  "short_name": "TCP Listener",
  "version": "1.0.0",
  "id": "/",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "permissions_policy": {
    "cross-origin-isolated": ["self"],
    "direct-sockets": ["self"],
    "local-network": ["self"],
    "loopback-network": ["self"]
  }
}
```
