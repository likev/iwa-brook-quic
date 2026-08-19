# Changelog

All notable changes to the **Isolated Web Apps (IWAs) Direct Sockets Suite & Brook QUIC Client** project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [v1.17.0] - 2026-08-19

### Fixed
- **Structured Outcome Reporting & Retry Integrity**: `BrookTunnel.run()` now returns explicit structured outcome objects (`{ success, kind, bytesSent, bytesReceived, serverHandshakeDone, error }`), eliminating ambiguous promise resolutions where target refusals or dial timeouts were mistakenly treated as successful completions.
- **One-Shot Proxy Reply State Machine**: `ProxyDispatcher` wraps `sendSuccess` and `sendFailure` in a state machine preventing duplicate or misplaced SOCKS5 / HTTP success replies across retry attempts.
- **Correct Response Byte Property Tracking**: Fixed `bytesRecv` to `bytesReceived` check on `SessionTracker` to strictly prevent request retries once downstream data has reached the browser.
- **Authoritative Transport Close Coordination**: When a `QuicSession` or UDP transport closes, stream handlers authoritatively trigger `cleanup('transport_closed')`, cancelling client stream readers and closing writers within a bounded 500ms timeout rather than waiting indefinitely.
- **Downstream Receive Backpressure & Hard Buffer Cap**: Enforced a 2MB hard receive queue limit (`MAX_RX_BUFFER_BYTES = 2MB`) in `BrookTunnel`. If a slow browser client stops reading, excessive buffer growth is caught and terminated with `rx_overflow` instead of memory exhaustion.
- **Coalesced UDP Send Queue Backpressure**: Replaced per-packet timer waiters with a map of coalesced drain waiters in `UdpSocketAdapter`, strictly enforcing the 1024 packet cap even under control-frame heavy bursts.
- **Global Admission Control & Queue Depth Caps**: Added hard capacity limits across all layers:
  - `TcpListener`: capped at 512 active sockets, with automatic Socket Set tracking and parallel batch closure on `stop()`.
  - `ProxyDispatcher`: capped host dial queues at depth 64 (`MAX_HOST_QUEUE_DEPTH`), draining and rejecting all waiters on shutdown.
  - `QuicConnectionManager`: capped handshake permit queues at depth 64 (`MAX_HANDSHAKE_QUEUE`).
- **Complete Handshake Negotiation Deadlines**: Implemented a 10s negotiation deadline in `Socks5Parser` and `HttpProxyParser` ensuring partial or stalled client handshakes cannot hold sockets open indefinitely.
- **Transactional Startup & Rollback**: `app.js` and `ProxyDispatcher.start()` now roll back and clean up all listeners and QUIC managers if any step of startup fails, preventing orphaned sockets and timer leaks.
- **UI Main-Thread Performance Optimization**: Capped active session table rendering in `UiController` to the top 25 most recent sessions, preventing main-thread layout thrashing during heavy concurrency.
- **DNS Resolver Immediate Error Propagation & Reset**: Upstream DNS sends fail immediately on stream write errors, and added `DnsResolver.clear()` for teardown.

### Tests
- Expanded test suite to **75 automated tests (100% pass rate)** covering structured outcomes on target refusal, rx buffer overflow, host dial queue caps and stop draining, UDP control queue saturation, DNS cache clear, and live 20-site concurrent proxy stress testing.

---

## [v1.16.0] - 2026-08-17

### Added
- **Fast 2s Keep-Alive PING & 5s Dead-Path Failover**: Configured QUIC connections in [`QuicSession`](file:///root/downloads/iwa/brook-quicclient/src/quic/quic-connection-manager.js) to send transport-level keep-alive PING frames every 2 seconds (`keepAlive: 2000`) and tightened default `isAlive()` threshold to 5 seconds (`maxIdleMs = 5000`), enabling instant failover on unstable mobile/cellular networks.
- **Inbound Datagram Liveness Bumping**: Added `QuicSession.feedDatagram()` and wired incoming datagram routing to update `lastPacketReceivedTime` and `lastActivity` on any inbound packet (including PING ACKs), ensuring healthy active paths stay hot while silent drops are detected in <5s.
- **Accelerated Pool Hygiene Interval**: Reduced pool hygiene check interval from 5s to 2s in [`QuicConnectionManager`](file:///root/downloads/iwa/brook-quicclient/src/quic/quic-connection-manager.js) for near-instant dead session eviction and pool refill.
- **Unit & Integration Tests**: Added test coverage in [`run-all-tests.js`](file:///root/downloads/iwa/scripts/run-all-tests.js) for `isAlive(5000)` default threshold, fast dead-path detection, and `feedDatagram` timestamp bumping on inbound packets.

---

## [v1.15.0] - 2026-08-17

### Fixed
- **Double DNS Resolution Elimination**: Removed redundant 6.0s pre-dial DNS resolution in [`ProxyDispatcher`](file:///root/downloads/iwa/brook-quicclient/src/server/proxy-dispatcher.js), eliminating 6.0s–8.5s unnecessary cold-lookup latency per request.
- **Speculative TCP Connection Idle Hangs**: Added a 10s timeout to initial `reader.read()` in [`ProxyDispatcher`](file:///root/downloads/iwa/brook-quicclient/src/server/proxy-dispatcher.js) so speculative/pre-connect browser TCP connections cleanly close without leaking resources.
- **SOCKS5 IPv6 Target Formatting**: Fixed [`Socks5Parser`](file:///root/downloads/iwa/brook-quicclient/src/protocols/socks5-parser.js) to format IPv6 addresses with proper colon-delimited RFC 5952 bracketed notation (`[2001:db8:85a3:0:0:8a2e:370:7334]:443`) via new [`formatIpv6()`](file:///root/downloads/iwa/brook-quicclient/src/core/byte-utils.js) utility.
- **Retry Corrupted Request Stream Protection**: Added `clientDataConsumed` guard via `onClientDataRead` callback in [`BrookTunnel`](file:///root/downloads/iwa/brook-quicclient/src/core/brook-tunnel.js) and [`ProxyDispatcher`](file:///root/downloads/iwa/brook-quicclient/src/server/proxy-dispatcher.js), ensuring retries only occur if the client stream has not already been partially read/transmitted.
- **Handshake Queue Drain on Shutdown**: [`QuicConnectionManager.close()`](file:///root/downloads/iwa/brook-quicclient/src/quic/quic-connection-manager.js) now drains and rejects all pending handshake queue promises, preventing memory leaks and unhandled promise stalls.
- **Low-GC Stream Buffer Optimization**: Replaced repeated `rxBuffer` full-array copying in [`BrookTunnel`](file:///root/downloads/iwa/brook-quicclient/src/core/brook-tunnel.js) with offset-based subarray slicing, eliminating memory thrashing on large downloads.
- **TCP Listener Single-Connection Crash Protection**: Wrapped `onConnection()` inside [`TcpListener._acceptLoop()`](file:///root/downloads/iwa/brook-quicclient/src/server/tcp-listener.js) in try/catch to ensure individual connection errors do not kill the server listener.
- **Byte-Safe HTTP Header Boundary Detection**: Updated [`HttpProxyParser`](file:///root/downloads/iwa/brook-quicclient/src/protocols/http-proxy-parser.js) to search for `\r\n\r\n` directly in raw byte arrays, eliminating character-to-byte offset drift with multibyte Unicode headers, and adding HTTP 400/431 error replies on parse failures.
- **UDP Send Queue Drain Timeout**: Added a 5s fallback timeout to `_waitForDrain()` in [`UdpSocketAdapter`](file:///root/downloads/iwa/brook-quicclient/src/quic/udp-socket-adapter.js) to prevent permanent thread blocks during socket congestion.

### Changed
- **Expanded QUIC Warm Session Pool**: Increased `targetPoolSize` from 12 to 20 warm sessions in [`QuicConnectionManager`](file:///root/downloads/iwa/brook-quicclient/src/quic/quic-connection-manager.js) to support parallel page-load connection bursts.
- **Higher Handshake Concurrency & Faster Refills**: Increased `maxConcurrentHandshakes` from 6 to 8, increased refill batch size to 6, reduced pool hygiene interval to 5s, and tightened on-demand handshake timeout to 8s.
- **Expanded Test Suite**: Added 11 new unit tests (total 62 tests) verifying IPv6 parsing, HTTP byte boundary detection, drain timeout safety, queue permit rejection, accept loop resiliency, and client data read notifications.

---

## [v1.14.0] - 2026-08-17

### Added
- **Fresh-Session Dial Retry**: Implemented automatic fresh-session recovery in [`ProxyDispatcher`](file:///root/downloads/iwa/brook-quicclient/src/server/proxy-dispatcher.js) with fast 2.0s initial dial timeouts and up to 3 retry attempts before client data transmission, optimized for mobile and unstable networks.
- **Fast 0-Byte Target Dial Refusal Termination**: [`BrookTunnel`](file:///root/downloads/iwa/brook-quicclient/src/core/brook-tunnel.js) instantly terminates (0ms) when a remote server closes the stream with 0 payload bytes instead of waiting for a 10s timeout.
- **Receive-Side BBR Delivery Rate Estimation**: In [`quic-engine.bundle.js`](file:///root/downloads/iwa/brook-quicclient/vendor/quic-engine.bundle.js), added receive-side BBR round sampling triggered directly upon stream payload frame receipt, scaling bandwidth and pacing dynamically during pure downlink transfers.
- **Anycast DNS Round-Robin & Cache Bounding**: [`DnsResolver`](file:///root/downloads/iwa/brook-quicclient/src/core/dns-resolver.js) spreads requests across all resolved A-records round-robin and bounds cache reuse (max 2 uses before eviction) to avoid VPS target IP rate-limiting.
- **Full IPv6 & Bracketed Address Parsing**: [`byte-utils.js`](file:///root/downloads/iwa/brook-quicclient/src/core/byte-utils.js) now supports bracketed IPv6 hosts (`[::1]:port`) and encodes IPv6 targets as standard SOCKS5 ATYP `0x04` 16-byte address slices.
- **Per-Host Active Dial Concurrency Rate Limiter**: Maximum 8 concurrent active connections per host, held for the entire tunnel duration.
- **Handshake Rate Limiter Priority Scheduling**: Interactive user proxy sessions gain priority in the handshake permit queue over background pool refill workers.
- **Comprehensive Test Suite**: 51 unit and live integration tests covering RFC 1035 DNS framing, IPv6 ATYP `0x04`, BBR pacing floors, UDP long-header retention, fresh-session retry, and 20-site concurrent stress testing.

### Changed
- Bumped internal QUIC handshake timeout from 10s to 25s to prevent false timeouts during concurrent bursts.
- Reduced normal stream-FIN idle wait from 10s to 1.5s.
- Clarified logging states: `⚡ Dialing`, `🚀 Server dial initiated (sn verified)`, `🎯 First target byte received`, `🛑 Tunnel finished`.

---

## [v1.13.0] - 2026-08-16

### Added
- **HTTP/2 Multiplexing Support**: Proxy dispatcher handles multiple multiplexed HTTP/2 streams across persistent browser-to-proxy connections.
- **Proxy DNS Resolution over Brook**: Resolves target hostnames through an encrypted DNS query tunnel (RFC 1035 over Brook stream) to prevent plaintext DNS / DoH leaks.
- **Deferred Proxy Handshake Confirmation**: SOCKS5 and HTTP CONNECT success responses are deferred until the Brook server acknowledges the dial with `sn`.
- **BBR Congestion Floors**: Added 12-packet minimum congestion window floor and 2 MB/s pacing floor to prevent connection collapse on asymmetric proxy flows.

### Changed
- Expanded warm QUIC session pool capacity to 12 sessions.
- Configured maximum concurrent QUIC handshakes to 6.

---

## [v1.12.0] - 2026-08-15

### Added
- **Brook QUIC Client IWA (`brook-quicclient`)**:
  - In-browser implementation of the Brook proxy client protocol using pure JavaScript cryptography (`@noble/ciphers`, `@noble/hashes`).
  - Native browser QUIC engine over Direct Sockets `window.UDPSocket`.
  - Local SOCKS5 Proxy listener (`TCPServerSocket` on port 10808).
  - Local HTTP/HTTPS CONNECT Proxy listener (`TCPServerSocket` on port 8080).
  - Web Bundle signing with Ed25519 key `keys/brook.pem` (Bundle ID: `5uad6swnv66tot24df52mjr7nc7pmnmwmmxofkkshietmn3nthqqaaic`).

---

## [v1.0.0] - 2026-08-10

### Added
- **TCP Listener IWA (`listener`)**: Listens on random ephemeral or custom ports using `new TCPServerSocket()`, accepts inbound TCP client connections, auto-echoes traffic, and displays packet hex inspections.
- **TCP Client IWA (`client`)**: Connects to target IP and port using `new TCPSocket()`, sends text/hex payloads, and benchmarks RTT latency.
- **Hub & Guide (`hub`)**: Central navigation dashboard and step-by-step setup guide for Isolated Web Apps on port 8000.
- **Signed Web Bundles & Update Manifests**: Automated build scripts using `wbn` and `wbn-sign` with Ed25519 cryptography.
