# Brook QUIC Client IWA (`brook-quicclient-README.md`)

An in-browser implementation of the **Brook Proxy Protocol** multiplexed over **QUIC (RFC 9000)** using pure JavaScript cryptography and the W3C/WICG **Direct Sockets API** (`window.UDPSocket` and `window.TCPServerSocket`).

---

## 📋 Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [Architecture & Protocol Pipeline](#architecture--protocol-pipeline)
  - [1. Inbound Proxy Handshakes (SOCKS5 & HTTP CONNECT)](#1-inbound-proxy-handshakes-socks5--http-connect)
  - [2. Encrypted Proxy DNS & Anycast Rotation](#2-encrypted-proxy-dns--anycast-rotation)
  - [3. Cryptography & Brook Framing](#3-cryptography--brook-framing)
  - [4. QUIC Engine & Connection Pooling](#4-quic-engine--connection-pooling)
  - [5. Resilience, Dial Retries & Congestion Control](#5-resilience-dial-retries--congestion-control)
- [Installation & Quick Start](#installation--quick-start)
  - [Prerequisites](#prerequisites)
  - [Option A: Install via Chrome Dev Mode](#option-a-install-via-chrome-dev-mode)
  - [Option B: Install via Signed Web Bundle (.swbn)](#option-b-install-via-signed-web-bundle-swbn)
- [Configuring Client Applications](#configuring-client-applications)
- [Vendor Engine & Node.js to IWA Porting](#-vendor-engine--nodejs-to-iwa-porting)
  - [1. Node.js vs. Browser IWA Runtime Paradigm](#1-nodejs-vs-browser-iwa-runtime-paradigm)
  - [2. Pre-Bundled QUIC Stack (vendor/quic-engine.bundle.js)](#2-pre-bundled-quic-stack-vendorquic-enginebundlejs)
  - [3. UDP Socket Backpressure & Queue Prioritization](#3-udp-socket-backpressure--queue-prioritization)
- [Testing & Validation](#testing--validation)
- [Project Directory Structure](#project-directory-structure)

---

## 🌟 Overview

The **Brook QUIC Client IWA** accepts local incoming proxy traffic from any web browser or application via **SOCKS5** (default: `127.0.0.1:10808`) or **HTTP/HTTPS CONNECT** (default: `127.0.0.1:8080`), encrypts the payload using authenticated AES-256-GCM frames, and tunnels the traffic over low-latency **QUIC datagrams** to a remote Brook QUIC server.

Because it runs completely inside an **Isolated Web App (IWA)**, no native binary installations, root permissions, or kernel drivers are required.

---

## ⚡ Key Features

- **Pure-Browser QUIC Transport**: Full QUIC v1 stack with TLS 1.3 handshake (ALPN `h3`) running directly over browser `UDPSocket`.
- **Dual Proxy Protocols**: Seamlessly accepts both SOCKS5 and HTTP/HTTPS CONNECT proxy requests.
- **Encrypted Tunnel DNS**: Resolves hostnames via encrypted RFC 1035 frames through the Brook tunnel, preventing local DNS and DoH leaks.
- **Anycast Round-Robin Load Balancing**: Spreads concurrent connections across all resolved Anycast A-records with bounded cache usage (2 uses per entry before eviction).
- **Fresh-Session Dial Recovery**: Automatically recovers from stalled target dials (fast 2.0s timeout on attempt 1, 2.2s on attempt 2, 2.5s on attempt 3) by acquiring a fresh QUIC session and rotating the target Anycast IP.
- **Fast 0-Byte Refusal Termination**: Immediately terminates (0ms) when a target host rejects a connection, eliminating 10-second browser hangs.
- **Receive-Side BBR Congestion Sampling**: Dynamically scales BBR delivery rate and pacing tokens during pure downlink transfers.
- **Strict Host Dial Concurrency Limits**: Limits concurrent active dials to a maximum of 8 per target host to protect against edge rate-limiting.

---

## 🏗️ Architecture & Protocol Pipeline

```
[ Browser / App ]
       │
       ▼ (Local TCP)
[ TCPServerSocket (10808 / 8080) ]
       │
       ▼
[ Protocol Detector & Parsers ] ──► [ SOCKS5Parser / HttpProxyParser ]
       │
       ▼
[ ProxyDispatcher ] ──────────────► [ DnsResolver (RFC 1035 over Brook) ]
       │                                  │
       │                                  ▼ (Anycast Round-Robin A-Records)
       ▼
[ QuicConnectionManager ] ────────► [ Warm Session Pool (12 Sessions) ]
       │                                  │
       ▼                                  ▼
[ BrookTunnel ] ──────────────────► [ AES-256-GCM Framing (sk, sn, ck, cn) ]
       │
       ▼
[ UdpSocketAdapter ] ─────────────► [ window.UDPSocket ]
                                          │
                                          ▼ (Encrypted QUIC Datagrams)
                               [ Remote Brook Server (4433) ]
```

---

### 1. Inbound Proxy Handshakes (SOCKS5 & HTTP CONNECT)

- **SOCKS5 (`socks5-parser.js`)**: Implements RFC 1928 authentication negotiation (`NO_AUTH = 0x00`), CONNECT command (`0x01`), and address parsing for IPv4 (`0x01`), Domain (`0x03`), and IPv6 (`0x04`).
- **HTTP CONNECT (`http-proxy-parser.js`)**: Parses standard `CONNECT host:port HTTP/1.1` request lines and headers.
- **Deferred Success Confirmation**: Proxy success replies (`0x05 0x00 ...` / `HTTP/1.1 200 Connection Established`) are deferred until the Brook server acknowledges the dial with its 12-byte Server Nonce (`sn`).

---

### 2. Encrypted Proxy DNS & Anycast Rotation

- Resolves domain names locally by transmitting binary RFC 1035 query frames to `8.8.8.8:53` through an encrypted Brook stream.
- When multiple A-records are returned (e.g. Google, Cloudflare, GitHub Anycast IPs), `DnsResolver` stores them in a round-robin rotation queue.
- To prevent VPS egress throttling, cache entries are bounded to **2 uses maximum** before eviction, ensuring fresh IP distribution across edge nodes.

---

### 3. Cryptography & Brook Framing

- **Key Derivation**: Computes 32-byte AES-256 keys using SHA-256:
  $$\text{Key} = \text{SHA256}(\text{password} \parallel \text{nonce} \parallel \text{"brook"})$$
- **Nonce Progression**: Increments a 64-bit Little-Endian counter in the first 8 bytes of the 12-byte nonce for each encrypted frame.
- **Framing**:
  1. **Length Frame**: 2-byte payload length encrypted in an 18-byte AES-256-GCM block.
  2. **Payload Frame**: Raw application stream encrypted in an $(N + 16)$-byte AES-256-GCM block.

---

### 4. QUIC Engine & Connection Pooling

- **Connection Pool**: Maintains a warm pool of 12 pre-connected QUIC sessions to eliminate handshake latency on new proxy dials.
- **Handshake Rate Limiter**: Limits concurrent handshakes to 6 to prevent UDP queue overflow. Interactive proxy requests unshift to the front of the queue for priority scheduling.
- **Dead-Session Detection**: Sessions with >20 seconds of silence without packet receipt are automatically purged and replaced.

---

### 5. Resilience, Dial Retries & Congestion Control

- **Fresh-Session Retry**: If an initial dial attempt fails or times out (3.5s), `ProxyDispatcher` acquires a fresh QUIC session, rotates to the next Anycast IP, and re-dials.
- **0-Byte Refusal Handling**: If the remote server sends `sn` and closes the stream with 0 payload bytes (target TCP reset/refusal), the tunnel closes immediately (0ms).
- **BBR Congestion Floors**:
  - `min_cwnd` floor: 12 packets
  - `pacing_rate` floor: 2,000,000 bytes/sec (2 MB/s)
  - `initial_cwnd`: 24 packets
  - Receive-side round sampling enabled during heavy downloads.

---

## 🚀 Installation & Quick Start

### Prerequisites

- **Google Chrome** (version 120 or higher) with Isolated Web App developer flags enabled:
  1. Navigate to `chrome://flags/#enable-isolated-web-apps` &rarr; **Enabled**
  2. Navigate to `chrome://flags/#enable-isolated-web-app-dev-mode` &rarr; **Enabled**
  3. Restart Chrome.

---

### Option A: Install via Chrome Dev Mode

1. Start the local server:
   ```bash
   npm start
   ```
2. Open `chrome://web-app-internals` in Google Chrome.
3. In the **"Install Isolated Web App from Dev Server"** section:
   - Enter `http://localhost:8083`
   - Click **Install**
4. Launch **Brook QUIC Client** from your application menu or desktop!

---

### Option B: Install via Signed Web Bundle (`.swbn`)

1. Build the production signed web bundles:
   ```bash
   npm run build
   ```
2. Open `chrome://web-app-internals` in Chrome.
3. In the **"Install Isolated Web App from Signed Web Bundle"** section, select:
   ```
   dist/brook-quicclient-v1.20.0.swbn
   ```

---

## 🌐 Configuring Client Applications

Once the Brook QUIC Client IWA is running and the proxy service is started:

### SOCKS5 Proxy Configuration

- **Protocol**: SOCKS5 (with remote DNS resolution / `socks5h`)
- **Host**: `127.0.0.1`
- **Port**: `10808`

**cURL Example**:
```bash
curl -v -x socks5h://127.0.0.1:10808 https://www.google.com
```

### HTTP / HTTPS CONNECT Proxy Configuration

- **Protocol**: HTTP Proxy
- **Host**: `127.0.0.1`
- **Port**: `8080`

**cURL Example**:
```bash
curl -v -x http://127.0.0.1:8080 https://example.com
```

---

## 📦 Vendor Engine & Node.js to IWA Porting

To run a high-performance QUIC proxy client entirely inside an in-browser Isolated Web App, several fundamental architecture shifts and engine patches were implemented.

### 1. Node.js vs. Browser IWA Runtime Paradigm

| Domain | Traditional Node.js CLI / Proxy | In-Browser IWA Direct Sockets |
|---|---|---|
| **TCP Listener** | `net.createServer()` with EventEmitter | `new TCPServerSocket()` with Web Streams (`readable.getReader()`) |
| **TCP Connection** | `net.Socket` emitting `'data'`, `'end'`, `'error'` | `new TCPSocket()` with `ReadableStream` & `WritableStream` (`Uint8Array`) |
| **UDP Transport** | `dgram.createSocket('udp4')` | `new UDPSocket()` (`readable.getReader()` & `writable.getWriter()`) |
| **Cryptography** | Node.js OpenSSL C++ binding (`crypto`) | Pure JavaScript/Wasm crypto via `@noble/ciphers` & `@noble/hashes` |
| **Concurrency Model** | Node thread pool / libuv event loop | Chromium single-threaded microtask queue with Web Streams backpressure |
| **Packaging & Security** | Binary executable or npm module | Signed Web Bundle (`.swbn`) with strict Permissions-Policy headers |

---

### 2. Pre-Bundled QUIC Stack (`vendor/quic-engine.bundle.js`)

The core QUIC protocol engine is pre-compiled via `esbuild` into a single standalone bundle [`vendor/quic-engine.bundle.js`](file:///root/downloads/iwa/brook-quicclient/vendor/quic-engine.bundle.js). It implements RFC 9000 (QUIC v1) and TLS 1.3 key exchange without any Node standard library shims (`Buffer`, `process`, `EventEmitter`, `setImmediate`).

#### Key Modifications & Patches in `quic-engine.bundle.js`:

1. **BBR-lite Congestion Controller Overhaul**:
   - **Asymmetric Proxy Throughput Estimator**: Replaced standard single-direction upload ACK rate estimator with `effectiveGoodput = Math.max(roundDelivered, roundReceived)`.
   - **Receive-Side Delivery Rate Sampling**: Directly inside `flushStream` upon stream payload receipt, BBR round bandwidth samples are computed in real time. This allows downstream downloads to immediately expand `bbr_btlbw` and token pacing without waiting for client return ACKs.
   - **Congestion & Pacing Floors**: Enforced `min_cwnd = 12 packets` and a pacing floor of `2,000,000 bytes/sec (2 MB/s)` to prevent connection collapse on 140–200ms VPS round-trips. Configured `initial_cwnd = 24 packets`.
2. **App-Space ACK Coalescing & Flood Mitigation**:
   - Resolved aggressive per-packet ACK amplification by coalescing 1-RTT ACKs to once every 25ms (or every 2–4 packets) and clearing pending ACK ranges to avoid repeated redundant ranges in packet flights.
3. **Resilient Handshake Timer**:
   - Increased the internal QUIC connection handshake timer from 10s to 25s (`handshakeTimeout: 25000`) to prevent premature aborts during concurrent bursts.
4. **DCID Datagram Demultiplexing**:
   - Implemented 8-byte DCID routing across both Long Headers (Initial/Handshake) and Short Headers (1-RTT), multiplexing all QUIC sessions over a single underlying `window.UDPSocket`.

---

### 3. UDP Socket Backpressure & Queue Prioritization

In the browser, calling `UDPSocket.writable.getWriter().write()` produces microtask promise queues that can saturate under burst traffic. [`UdpSocketAdapter`](file:///root/downloads/iwa/brook-quicclient/src/quic/udp-socket-adapter.js) introduces:
- A **1,024-packet priority queue** with asynchronous drain loops.
- **Long-Header Retention**: Under backpressure, control packets (Initial, Handshake, Path Challenge) are retained and prioritized while disposable data frames absorb backpressure.

---

## 🧪 Testing & Validation

Run the complete 51-test suite (Unit Tests + Live Remote Integration Tests):

```bash
npm test
# or
node scripts/run-all-tests.js
```

---

## 📁 Project Directory Structure

```
/root/downloads/iwa/brook-quicclient/
├── app.js                          # Main application entrypoint
├── index.html                      # UI layout & status dashboard
├── styles.css                      # Modern dark theme styles
├── manifest.webmanifest            # IWA manifest & Direct Sockets permissions
├── .well-known/
│   └── manifest.webmanifest        # Isolated Web App identity manifest
├── assets/                         # Application icons & branding
├── vendor/
│   └── quic-engine.bundle.js       # Bundled pure-browser QUIC v1 stack
└── src/
    ├── core/
    │   ├── brook-crypto.js         # AES-256-GCM & SHA-256 routines
    │   ├── brook-framing.js        # Length/payload frame packing & opening
    │   ├── brook-tunnel.js         # Bidirectional streaming tunnel & timers
    │   ├── byte-utils.js           # IPv4/IPv6 parsers & address encoders
    │   └── dns-resolver.js         # Encrypted RFC 1035 DNS resolver
    ├── protocols/
    │   ├── http-proxy-parser.js    # HTTP CONNECT parser & response generator
    │   ├── protocol-detector.js    # SOCKS5 vs HTTP preamble detector
    │   └── socks5-parser.js        # SOCKS5 handshake & request parser
    ├── quic/
    │   ├── quic-connection-manager.js # Connection pool & handshake scheduler
    │   ├── quic-session.js         # Individual QUIC stream manager
    │   └── udp-socket-adapter.js   # Queue backpressure & priority buffer
    ├── server/
    │   ├── proxy-dispatcher.js     # Master request router & retry manager
    │   ├── proxy-listener.js       # TCPServerSocket listener wrapper
    │   └── session-tracker.js      # Active connection & bandwidth monitor
    └── ui/
        └── ui-controller.js        # Real-time traffic UI dashboard
```
