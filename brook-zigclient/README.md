# Brook Zig Client

Single-binary native TCP-over-WebSocket bridge written in **Zig 0.17.1** (zero external dependencies) paired with a **Dedicated Web Worker** browser proxy engine.

Replaces Chrome Isolated Web App (IWA) Direct Sockets (`TCPServerSocket`) with a lightweight native Zig host binary while reusing the entire Brook WebTransport (HTTP/3 QUIC) + `/brook-ws` TCP fallback, AES-256-GCM Brook crypto, SOCKS5, HTTP/HTTPS CONNECT, Unified Auto-Detect, and NetworkMonitor stack in any modern browser (**Chrome, Edge, or Firefox**).

---

## Architecture

```
Local Apps (curl / Firefox / System Proxy)
   │  TCP (SOCKS5 :10808, HTTP :8080, or :1080 / auto-detect)
   ▼
brook-zigclient (Single Static Zig Binary — Linux & Windows 10)
   ├── Embedded Web UI HTTP Server  http://127.0.0.1:<random-port>/?token=<hex>
   ├── Persisted Config API         GET/POST /api/config?token=<hex>
   └── Local WebSocket TCP Bridge   ws://127.0.0.1:<random-port>/ws?token=<hex>
          │  5-byte binary mux [type][connId][payload] + credit WINDOW flow control
          ▼
Browser Tab (Lightweight UI Shell)
   └── Dedicated Module Web Worker (src/workers/proxy-engine.worker.js)
          ├── WsBridgeClient + TcpListener drop-in adapter
          ├── ProxyDispatcher (SOCKS5 + HTTP CONNECT + Auto-Detect + Hedged Retries)
          ├── BrookTunnel (AES-256-GCM / SHA-256 WithoutBrook)
          ├── NetworkMonitor (3-endpoint active HTTP/3 probe + pause/resume)
          └── WebTransportConnectionManager (HTTP/3 QUIC pool + /brook-ws TCP fallback)
```

### Security & Stability Highlights
- **Per-Launch Random Token + Origin Check:** Every launch generates a 128-bit random hex token (`?token=...`) and validates both token and `Origin` on `/ws` and `/api/config` to prevent Cross-Site WebSocket Hijacking (CSWSH).
- **Dedicated Web Worker Engine:** All networking, timers, keepalives, and NetworkMonitor probes run inside a Web Worker to avoid background browser tab timer throttling.
- **Credit-Based Backpressure (`WINDOW` frames):** Each local TCP connection uses a 1 MiB initial window with 256 KiB credit replenishment so fast loopback uploads cannot flood browser memory.
- **Persistent Config Across Random Ports:** Settings are stored on disk via `/api/config` (`~/.config/brook-zigclient/config.json` on Linux, `%APPDATA%\brook-zigclient\config.json` on Windows) so random HTTP ports never lose saved settings.
- **No Port Blocklist:** Native OS TCP sockets allow binding any permitted port (including `1080`).

---

## Building

Requires **Zig 0.17.1+**:

```bash
cd brook-zigclient

# Run Zig unit tests
zig build test

# Build native debug binary (zig-out/bin/brook-zigclient)
zig build

# Cross-compile single static release binaries for Linux x86_64 and Windows 10 x86_64
zig build release-all
```

Release binaries are written to:
- `zig-out/release/brook-zigclient-linux-x86_64`
- `zig-out/release/brook-zigclient-windows-x86_64.exe`

---

## Usage

```bash
# Default: bind random localhost HTTP/WS port and open browser UI
./zig-out/release/brook-zigclient-linux-x86_64

# Open in Chrome/Edge standalone app window and auto-start proxy
./zig-out/release/brook-zigclient-linux-x86_64 --app-mode --auto-start

# Override server / password / ports via CLI
./zig-out/release/brook-zigclient-linux-x86_64 \
  --server https://your.domain.com:4433/brook \
  --password "your-secret-password" \
  --socks5 1080 \
  --http 8080 \
  --auto-start
```

On Windows 10, double-click `brook-zigclient-windows-x86_64.exe` or run from PowerShell/CMD with the same flags.

### Automated Verification

```bash
node brook-zigclient/test-e2e.mjs
```
