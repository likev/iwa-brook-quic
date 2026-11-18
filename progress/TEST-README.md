# Test Suite Documentation (`TEST-README.md`)

This document outlines the testing architecture, test coverage, and execution instructions for the **Isolated Web Apps (IWAs) Direct Sockets Suite & Brook QUIC Client**.

---

## 📋 Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [Test Suite Architecture](#test-suite-architecture)
  - [Part 1: Unit Tests (36 Tests)](#part-1-unit-tests-36-tests)
  - [Part 2: Live Integration Tests (15 Tests)](#part-2-live-integration-tests-15-tests)
- [External TCP Testing CLI](#external-tcp-testing-cli)
- [Continuous Validation & Diagnostics](#continuous-validation--diagnostics)

---

## 🚀 Quick Start

Run the complete test suite (Unit Tests + Live Integration Tests):

```bash
npm test
# or directly:
node scripts/run-all-tests.js
```

Run external TCP server/client validation:

```bash
npm run test:tcp
```

---

## 🏗️ Test Suite Architecture

The primary test runner is located at [`scripts/run-all-tests.js`](file:///root/downloads/iwa/scripts/run-all-tests.js). It executes two distinct test phases:

```
scripts/run-all-tests.js
├── Phase 1: Unit Tests (Pure in-memory & mocked runtime)
└── Phase 2: Live E2E Integration Tests (Live QUIC transport & proxy listeners)
```

---

### Part 1: Unit Tests (36 Tests)

Unit tests run in an isolated environment without requiring active network connectivity to the remote Brook server.

| Module | Tested Functionality | Assertion Details |
|---|---|---|
| **`brook-crypto.js`** | Key derivation & hashing | `deriveKey` outputs 32-byte AES-256 key; `sha256` produces 32-byte digest |
| **`brook-crypto.js`** | Nonce incrementation | `nextNonce` increments 64-bit counter in Little-Endian byte order |
| **`brook-framing.js`** | AES-256-GCM frame sealing & opening | Sealed frame length is `len + 34B`; decrypted payload matches plaintext |
| **`protocol-detector.js`** | Protocol detection | Correctly identifies `SOCKS5 (0x05)`, `HTTP CONNECT`, and plain `HTTP GET` |
| **`byte-utils.js`** | Host & port parsing | Parses domain names, standard IPv4, and bracketed IPv6 (`[::1]:8080`) |
| **`byte-utils.js`** | IPv6 address encoding | Encodes IPv6 addresses into standard SOCKS5 ATYP `0x04` 16-byte slices (19B total) |
| **`dns-resolver.js`** | RFC 1035 query generation | Generates binary DNS query frames with standard flags (`RD=1`, Type A) |
| **`dns-resolver.js`** | Anycast round-robin & cache bounding | Cycles through multiple Anycast A-records; evicts entries after bounded usage |
| **`quic-engine`** | BBR congestion controller | Enforces 12-packet `min_cwnd` floor, 2 MB/s pacing floor, 24-packet initial cwnd |
| **`udp-socket-adapter.js`** | Queue prioritization & backpressure | Prioritizes and retains Long-Header handshake packets during high queue load |
| **`quic-connection-manager.js`** | Pool sizing & handshake limits | Warm pool target size is 12; handshake concurrency bounded to 6 |
| **`quic-connection-manager.js`** | Handshake priority queue | Interactive proxy requests bypass background refill workers via priority unshift |
| **`quic-connection-manager.js`** | Session liveness tracking | Flags sessions with >20s inactivity as dead; revives upon packet receipt |
| **`proxy-dispatcher.js`** | Per-host concurrency limiter | Enforces max 8 concurrent dials per target host with FIFO queuing |
| **`brook-tunnel.js`** | Deferred handshake success | `sendSuccess` is deferred until `sn` arrival; returns `0x05` on dial timeout |
| **`brook-tunnel.js`** | Fast 0-byte refusal termination | Instantly terminates (0ms) on 0-byte stream FIN without 10s hang |

---

### Part 2: Live Integration Tests (15 Tests)

Live integration tests establish real encrypted QUIC sessions with the live Brook server (`brook-quic.pplx.io:4433` / password `271828brook`) and bind local proxy listeners on loopback ports.

1. **Preflight QUIC Handshake**:
   - Establishes a pure-browser QUIC connection over UDP to `brook-quic.pplx.io:4433` (ALPN `h3`).
2. **Proxy Listeners Lifecycle**:
   - Binds a SOCKS5 proxy listener on `127.0.0.1:19181` and an HTTP/HTTPS CONNECT proxy listener on `127.0.0.1:19185`.
3. **Encrypted Proxy DNS Resolution**:
   - Sends an encrypted RFC 1035 query through the Brook tunnel and verifies resolved A-records.
   - Tests round-robin rotation on subsequent cache hits.
4. **SOCKS5 HTTPS GET Request**:
   - Executes `curl -x socks5h://127.0.0.1:19181 https://www.google.com` and verifies HTTP 200.
5. **HTTP CONNECT HTTPS GET Request**:
   - Executes `curl -x http://127.0.0.1:19185 https://example.com` and verifies HTTP 200.
6. **Remote Exit IP Verification**:
   - Fetches `https://api.ipify.org` through the proxy to confirm the remote exit IP matches the VPS (`45.63.20.230`).
7. **Concurrent Multi-Stream Requests**:
   - Simultaneously fires 5 parallel HTTPS requests across distinct domains (`google.com`, `example.com`, `wikipedia.org`, `duckduckgo.com`, `bing.com`).
8. **Heavy Static Asset Parallel Downloads**:
   - Concurrently downloads Douban and GitHub CDN image/script assets (e.g. 235KB image payloads) over multiplexed tunnels.
9. **20-Site High-Concurrency Burst Storm**:
   - Fires 20 concurrent connections to major global websites in parallel (`google.com`, `github.com`, `wikipedia.org`, `cloudflare.com`, `reddit.com`, `apple.com`, `amazon.com`, `microsoft.com`, `gitlab.com`, etc.) to stress-test handshake permit scheduling, BBR delivery rate estimation, and connection pooling.

---

## 🛠️ External TCP Testing CLI

[`scripts/test-tcp.js`](file:///root/downloads/iwa/scripts/test-tcp.js) provides an independent Node.js CLI utility for testing raw TCP listener and client functionalities:

```bash
# Test local listener on port 8080:
node scripts/test-tcp.js --port 8080 --mode ping

# Test payload throughput:
node scripts/test-tcp.js --port 8080 --mode benchmark --count 100
```

---

## 🔍 Continuous Validation & Diagnostics

When debugging or testing changes locally:

1. **Verify Bundle Integrity**:
   ```bash
   npm run build
   ```
2. **Execute Full Suite with Diagnostics**:
   ```bash
   node scripts/run-all-tests.js
   ```
3. **Expected Output**:
   ```
   ========================================
     TEST RESULTS: 51 PASSED, 0 FAILED
   ========================================
   ```
