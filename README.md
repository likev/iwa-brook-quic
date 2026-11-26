# Brook QUIC / WebTransport IWA & Direct Sockets Suite

A production-grade **Isolated Web App (IWA)** proxy client and unified Go server built on Chrome's **Direct Sockets API**, **WebTransport (HTTP/3 QUIC)**, and automatic **WebSocket-over-TLS (`/brook-ws`) TCP fallback**, plus reference Direct Sockets TCP Listener & Client IWAs.

1. **Brook WebTransport Client IWA (`v1.42.0`)** (`brook-quicclient/`) — In-browser **SOCKS5** (`127.0.0.1:10808`), **HTTP/HTTPS CONNECT** (`127.0.0.1:8080`), or unified auto-detect local proxy using `TCPServerSocket`, tunneling AES-256-GCM Brook streams over **WebTransport (HTTP/3 QUIC)** with automatic fallback to multiplexed **WebSocket (`wss://.../brook-ws`)** when UDP is blocked or throttled.
2. **Unified Brook Server (`brook-quicserver.go/`)** — Single-binary Go server (`quic-go v0.64.1`, `webtransport-go v0.13.0`, `gorilla/websocket`) serving **Raw Brook QUIC**, **WebTransport (`/brook`)**, and **multiplexed WebSocket (`/brook-ws`)** on the same port (`:4433` UDP + TCP) with automatic Let's Encrypt TLS and per-stream `WithoutBrook` auto-detection.
3. **TCP Listener IWA (`v1.37.0`)** (`listener/`) — Listens on a custom or OS-assigned ephemeral port using `TCPServerSocket`, with live packet inspection and auto-echo.
4. **TCP Client IWA (`v1.37.0`)** (`client/`) — Connects raw TCP sockets via `TCPSocket`, with text/hex send, RTT benchmarking, and packet inspection.

---

## 🌟 Key Highlights & Stability Architecture

### Transport & Fallback (WebTransport Primary → WebSocket TCP Fallback)
- **WebTransport (HTTP/3 QUIC) First:** Always prefers `https://<host>:<port>/brook` over UDP/QUIC when available.
- **Automatic `/brook-ws` TCP Fallback:** After `2` consecutive QUIC handshake failures, the client transparently switches to a pooled (`2` connections), stream-multiplexed `wss://<host>:<port>/brook-ws` transport on the **same port (`4433/tcp`)** using the same TLS certificate.
- **Automatic Background QUIC Recovery:** While on WebSocket fallback, a background probe tests WebTransport every `60s` when online. Once UDP/QUIC recovers, new streams immediately switch back to HTTP/3 QUIC while in-flight WebSocket streams finish and drain cleanly.
- **5-Byte Binary WebSocket Mux Protocol:** `[1B frameType][4B streamId BE][payload]` (`OPEN`, `DATA`, `FIN`, `RST`, `PING`, `PONG`) providing 0-RTT stream opens, true independent half-close (`FIN`), bounded 4 MB per-stream buffers, and `WithoutBrook` parity with WebTransport.

### Unstable-Network Resilience
- **Health-Scored Pool & Zombie Eviction:** Tracks per-slot consecutive failures and EWMA dial RTT; deprioritizes failing slots, routes retries to untried slots (`excludeSlotIds`), and evicts zombie sessions after 2 consecutive failures.
- **Adaptive, Staggered Pool Warming:** Starts with `2` staggered warm sessions (`baseWarmSlots = 2`) to avoid tripping ISP UDP burst policing, scaling up to `5` only under heavy concurrent stream load (`>32` active streams).
- **10 s Handshake Timeout & Slot Racing:** Races up to 2 pool slots with round-robin rotation (`Promise.any`) instead of pinning cold connects to slot `#1`, with jittered exponential backoff and 5 s deduplicated pool-down warning logs.
- **Hedged Pre-Handshake Retries:** On idempotent dials (`SOCKS5`/`HTTPS CONNECT`) with ≥2 healthy slots, fires a hedged dial on a different slot after `2.5s` if the server nonce (`sn`) hasn't arrived, using an atomic `claimClient()` gate so at most one racer ever touches local TCP streams.
- **Client-Side Lightweight NAT Keepalive:** Sends a 1-byte WebTransport datagram (or WebSocket `PING`) every `20s` on idle warm sessions to keep carrier/home NAT bindings alive while letting the server reclaim vanished clients via `MaxIdleTimeout`.
- **Non-Destructive Active Network Monitor:** Probes 3 verified HTTP/3 + CORS endpoints (`dog.ceo`, `catfact.ninja`, `api.cdnjs.com`) every `5s` with 2-strike asymmetric hysteresis and a Brook traffic liveness signal. When probes go offline, it **only pauses TCP listening and QUIC retries**—never closing already-working QUIC sessions or active tunnels.
- **Zero-Copy Server ALPN Dispatch (`quic-go v0.64.1`):** Routes `brook-quic`/`brook` directly to Raw Brook QUIC and `h3` directly to `webtransport.Server.ServeQUICConn` with `InitialPacketSize: 1200` (safe MTU for PPPoE/cellular links) and `EnableStreamResetPartialDelivery: true`.

---

## 📁 Project Architecture

```
/root/downloads/iwa/
├── brook-quicclient/             # Brook WebTransport + WS Fallback Client IWA (v1.42.0)
│   ├── app.js                    # Bootstrap, NetworkMonitor, WebTransport/WS & Dispatcher wiring
│   ├── index.html                # IWA dashboard, live telemetry, session table, log stream
│   ├── manifest.webmanifest      # Direct Sockets & IWA permissions policy
│   └── src/
│       ├── core/                 # Brook crypto/framing, BrookTunnel, NetworkMonitor, DNS
│       ├── protocols/            # SOCKS5, HTTP/HTTPS proxy parsers & auto-detector
│       ├── server/               # TcpListener (pause/resume), ProxyDispatcher, SessionTracker
│       ├── webtransport/         # WebTransportConnectionManager, WebSocketConnectionManager, adapters
│       └── ui/                   # UiController, LogStream, Trusted Types policy
├── brook-quicserver.go/          # Unified Go Server (QUIC + WebTransport + /brook-ws TCP)
│   ├── main.go                   # CLI flags, env vars, graceful shutdown
│   ├── server.go                 # Dual UDP (QUIC/H3) + TCP (HTTPS/WS) listener & ALPN dispatch
│   ├── webtransport.go           # WebTransport upgrade handler + datagram keepalive drain
│   ├── websocket.go              # Multiplexed /brook-ws handler & WSMuxStream (StreamConn)
│   ├── quic.go                   # Raw Brook QUIC handler
│   ├── brook_stream.go           # Brook encrypted/simple stream relay & WithoutBrook auto-detect
│   └── server_test.go            # Go integration, leak, idle-timeout, FIN, and /brook-ws tests
├── listener/                     # TCP Listener IWA (v1.37.0)
├── client/                       # TCP Client IWA (v1.37.0)
├── hub/                          # Hub landing page & setup dashboard
├── dist/                         # Signed Web Bundles (.swbn) & IWA Update Manifests
│   ├── brook-quicclient.swbn     # Web Bundle ID: 5uad6swnv66tot24df52mjr7nc7pmnmwmmxofkkshietmn3nthqqaaic
│   ├── brook-quicclient-v1.42.0.swbn
│   ├── brook-quicclient-update-manifest.json
│   ├── listener.swbn             # Web Bundle ID: u2uwu7f3ihcmiqejcwxfkkgbwj5tjkqaxu6ohud2pbu2fbcoxveaaaic
│   ├── client.swbn               # Web Bundle ID: n3ywd6x7rc7iqzgiwnobvhldakbliigueenvj2gew5u3bfkp6rcaaaic
│   └── manifest-summary.json
├── keys/                         # Ed25519 IWA Signing Keys
├── scripts/
│   ├── build.js                  # Builds & signs .swbn bundles and update manifests
│   ├── run-all-tests.js          # Full JS unit + live WebTransport E2E + Go test suite
│   ├── generate-keys.js          # Generates Ed25519 keys
│   ├── generate-icons.js         # Generates PWA/IWA icons
│   └── test-tcp.js               # External Node.js TCP CLI testing tool
├── server.js                     # Local Dev Server with required IWA headers
└── package.json
```

---

## 🚀 Quick Start

### 1. Build & Run the Unified Go Server

```bash
cd brook-quicserver.go
go build -trimpath -o brook-quic .

# Listens on UDP :4433 (Raw QUIC + WebTransport /brook) AND TCP :4433 (WebSocket /brook-ws)
./brook-quic -l :4433 -p "your-secret-password" -domain your.domain.com
```

Make sure both **UDP** and **TCP** are allowed on your server port (default `4433`):
- `quic://<domain>:4433` (Raw Brook QUIC)
- `https://<domain>:4433/brook` (WebTransport over HTTP/3)
- `wss://<domain>:4433/brook-ws` (Multiplexed WebSocket over TLS/TCP fallback)

### 2. Build Signed IWA Bundles (`.swbn`)

```bash
npm install
npm run build
```

This generates signed bundles and update manifests in `dist/` (including `dist/brook-quicclient-v1.42.0.swbn`).

### 3. Run Local Dev Servers (Optional)

```bash
npm start
# or
npm run dev
```

Starts:
- **🌐 Hub & Guide**: `http://localhost:8000`
- **👂 TCP Listener IWA**: `http://localhost:8081`
- **⚡ TCP Client IWA**: `http://localhost:8082`

---

## 🔧 Installing in Google Chrome / Chromium

Isolated Web Apps and Direct Sockets require Chrome 120+ with IWA flags enabled:

1. Open Chrome and enable:
   - `chrome://flags/#enable-isolated-web-apps` &rarr; **Enabled**
   - `chrome://flags/#enable-isolated-web-app-dev-mode` &rarr; **Enabled**
2. Restart Chrome and navigate to `chrome://web-app-internals`.
3. Install `dist/brook-quicclient.swbn` (or `dist/brook-quicclient-v1.42.0.swbn`) via **"Install Isolated Web App from Signed Web Bundle"** (or install via Update Manifest URL `https://t.iread.fun/downloads/iwa/dist/brook-quicclient-update-manifest.json`).
4. Launch **Brook QUIC Client**, configure your server (`https://<domain>:4433/brook`) and password, click **Start Proxy**, and verify:

```bash
curl -x socks5h://127.0.0.1:10808 https://httpbin.org/ip
curl -x http://127.0.0.1:8080 https://httpbin.org/ip
```

---

## 🧪 Automated Testing

```bash
# Run full JS unit tests (117 assertions), live WebTransport E2E proxy tests, and Go checks
npm test

# Run full Go server test suite (QUIC, WebTransport, /brook-ws TCP mux, leak & timeout checks)
cd brook-quicserver.go && go test -v -count=1 ./...

# External TCP CLI tools for Listener / Client IWAs
npm run test:tcp-client 49215 127.0.0.1
npm run test:tcp-server 8080
```

---

## 📜 Manifest Permissions Policy Configuration

Inside `brook-quicclient/manifest.webmanifest` (and `.well-known/manifest.webmanifest`):

```json
{
  "name": "Brook QUIC Client",
  "short_name": "Brook QUIC",
  "version": "1.42.0",
  "id": "/",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "permissions_policy": {
    "direct-sockets": ["self"],
    "direct-sockets-private": ["self"],
    "cross-origin-isolated": ["self"],
    "local-network": ["self"],
    "loopback-network": ["self"]
  }
}
```
