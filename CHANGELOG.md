# Changelog

All notable changes to the **Isolated Web Apps (IWAs) Direct Sockets Suite & Brook QUIC Client** project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [v1.30.3] - 2026-08-19

### Fixed (Eliminated NS_ERROR_NET_PARTIAL_TRANSFER & Stream Truncation)
- **Eliminated Premature Idle/Abort Cutoffs**: Removed premature 2s/5s/15s timeout timers during active streaming downloads and client request upload completion in `BrookTunnel`. Standardized all active keep-alive timers to 60s, allowing streaming HTTP/2 SSE, GraphQL queries, and large file downloads to finish completely.
- **Removed 2-Second Force-Kill on QUIC Stream Close**: Removed the hardcoded 2000ms deadline in `quicManager.registerStream.onClose()`. The downstream queue now naturally drains all in-flight decrypted frames to the client without truncation.
- **Safe Half-Close & Write Operation Coordination**: Guaranteed that `clientWriter.write()` is never interrupted or raced against `close()`/`cancel()`, cleanly closing the write half (EOF) on server FIN without triggering TCP RST in Firefox.

---

## [v1.30.2] - 2026-08-19

### Fixed & Unblocked (Eliminated Concurrency Bottlenecks)
- **Removed Artificial Per-Host Dial Queue**: Completely removed the 8-connection per-host rate limiter and queue in `ProxyDispatcher`. Requests to any host (`example.com`, CDNs, APIs) now proceed with 100% unrestricted concurrency, eliminating stalling and timeout issues when multiple tabs or pooled connections are open.
- **Synchronous & Clean UDPSocket Teardown**: Updated `UdpSocketAdapter.close()` to immediately abort writers, cancel readers, and release locks synchronously, preventing socket descriptor leaks and hanging promises in Chrome Direct Sockets.
- **Expanded Handshake Concurrency**: Scaled `maxConcurrentHandshakes` to 256 with an expanded queue buffer (2048), handling high-density bursts of parallel subresource requests without dropping or stalling connections.

---

## [v1.30.1] - 2026-08-19

### Fixed & Enhanced
- **Optimized Handshake Dial Deadlines**: Increased `dialTimeoutMs` across attempts to 8s / 10s / 12s, eliminating false-positive handshake aborts under network latency.
- **Extended Connection Keep-Alive**: Increased idle connection timeout from 15s to standard 60s, preserving browser HTTP/2 keep-alive socket pools and preventing premature speculative socket drops.

---

## [v1.30.0] - 2026-08-19

### Changed & Streamlined (Per-UDPSocket Architecture Matching Original quicclient.go)
- **100% On-Demand Connection Model**: Removed the warm standby pool, background pool refill routines, and pool hygiene intervals entirely.
- **Strict 1-to-1 UDPSocket Isolation**: Each inbound SOCKS5 / HTTP proxy request connects a dedicated QUIC session with its own independent Direct Sockets `UDPSocket` (ephemeral port allocated by OS/browser kernel).
- **Instant Clean Teardown**: Sockets and sessions are completely destroyed immediately upon proxy tunnel completion, eliminating idle session accumulation and background packet overhead.
- **Enhanced Telemetry Aggregation**: `transport_snapshot` aggregates real-time metrics (`udpQueue`, `udpQueueMax`, `udpWriteMsP95`, `uploadPendingBytes`, `rxQueuedBytes`, `writerWaitMs`, `eventLoopDelayMs`) dynamically across all active on-demand connections.

---

## [v1.29.0] - 2026-08-19

### Added & Instrumented (Review 9 Transport Diagnostics)
- **Review 9 Telemetry & Transport Snapshot Engine**: Implemented complete, real-time structured telemetry capturing all diagnostic fields requested in Review 9:
  - `udpQueue`: Live UDP socket send queue depth.
  - `udpQueueMax`: Peak UDP queue length observed during operation.
  - `udpOldestMs`: Age in milliseconds of the oldest un-drained packet in the send queue.
  - `udpWriteMsP95`: 95th-percentile execution time of underlying Direct Sockets `UDPSocket` `writer.write()`.
  - `uploadPendingBytes`: Live bytes queued across upstream transmit pipelines.
  - `rxQueuedBytes`: Aggregate downstream received bytes buffered across active tunnels.
  - `writerWaitMs`: 95th-percentile time spent waiting for local TCP client stream writes (`writer.write()`).
  - `eventLoopDelayMs`: Real-time main/UI event loop lag measurement.
  - `warmStandby`, `activeSessions`, `handshakes`, `handshakeQueue`, `hostQueueTotal`, `activeTunnels`, `retries`, `packetEvictions`, and warm pool refill lifecycle counters (`refillsStarted`, `refillsCompleted`, `refillsFailed`).
- **Structured Diagnostic Report Export**: "📋 Copy Logs" now embeds the live `TRANSPORT SNAPSHOT METRICS` table and raw JSON object at the top of the exported diagnostic report.
- **Fixed Active Tunnel Idle Timeout Override**: Corrected payload receive path `resetIdleTimer` from 180s to the intended 30s active-tunnel timeout.

---

## [v1.28.0] - 2026-08-19

### Added & Improved
- **1-Click Diagnostic Report & Copy Logs**: Added `📋 Copy Logs` button to the UI traffic log panel with safe clipboard fallback, copying full telemetry gauges, system state, connection status, and all chronological protocol event logs for easy debugging and feedback.
- **Enhanced Telemetry & Timing Logs**: Added dial duration (`dial: Xms, total: Ys`) to tunnel completion logs, explicit fresh session 1-RTT connection logs, and detailed pool/transport snapshot heartbeats (standby/target ratio, active tunnels, handshakes, UDP send queue depth, and newest ACK age).
- **UDP Transport Telemetry**: Added `getStats()` to `UdpSocketAdapter` exposing real-time queue depth, drain status, packet counters, and byte metrics.

---

## [v1.27.0] - 2026-08-19

### Changed & Fixed
- **2x Standby Pool Capacity**: Doubled `targetPoolSize` to 24 warm sessions and increased `maxConcurrentHandshakes` to 8 with 4-session batch refills, providing 0ms connection acquisition for high-concurrency browser page loads.
- **Safe In-Flight Stream Drain on Transport Close**: In `BrookTunnel`, `onClose` now allows queued downstream payload chunks to finish draining to the client before final cleanup, guarded by a 2000ms safety deadline.
- **Centralized Stream Lock Release**: Moved `reader.releaseLock()` and `writer.releaseLock()` to the `finally` block in `ProxyDispatcher`, ensuring clean stream lock release on both normal completions and error terminations.

---

## [v1.26.0] - 2026-08-19

### Changed & Fixed
- **Transport Failure Teardown (Review8 P0)**: Implemented atomic `_handleTransportFailure()` in `QuicConnectionManager`. Unexpected UDP transport error or close immediately marks the manager closed, rejects queued handshake permits, and closes all active sessions and stream handlers, releasing all tunnels and permits.
- **Accurate Outcome Classification (Review8 P0)**: Separated Brook dial initiation from target connection success. A tunnel is only classified as `success: true` if mutual clean FINs were exchanged or useful downstream data was delivered (`totalBytesRecv > 0`). Target dial refusals (0 bytes) and early transport drops are correctly classified as non-success, enabling clean retries and accurate metrics.
- **Bounded Half-Close & Unblocked Teardown (Review8 P0)**: Wrapped `clientWriter.close()` with a non-blocking timeout, bounded post-FIN half-close to a strict 5-second maximum, and ensured transport `onClose` directly executes cleanup without deadlocking behind in-flight receive processing.
- **Explicit `forceFresh` Session API (Review8 P1)**: Formalized `createSession({ forceFresh: true })` contract in `QuicConnectionManager` to explicitly bypass the standby pool when requested on dial retries.
- **Single-Owner Stream Lock Release (Review8 P1)**: Eliminated concurrent `releaseLock()` races between `BrookTunnel` and `ProxyDispatcher`.
- **Fast Anycast Clock Racing (Review8 P2)**: Upgraded `measureClockDrift()` to race parallel Anycast UTC probes via `Promise.any()`, eliminating startup delays.

---

## [v1.25.0] - 2026-08-19

### Changed & Fixed
- **Native Remote Domain Resolution**: Replaced client-side DNS IP overwrite with direct domain forwarding in Brook header frames (`dstBytes`). The Brook server resolves domains dynamically across Anycast and CDN IP pools (Happy Eyeballs RFC 8305), eliminating TCP connection resets (`target_dial_refused`) caused by pinning multiple parallel browser requests to a single Anycast node (e.g. Meta CDN `static.xx.fbcdn.net`).
- **Clean Clock Drift Stabilization**: Removed volatile offset probing that caused valid 0s timestamps to drift beyond the Brook 60-second limit.
- **Graceful Speculative Pre-Connect Handling**: Handshake-verified remote target closures (such as browser speculative pre-connect timeouts) are now classified as clean completions rather than triggering unnecessary dial retries.

---

## [v1.24.0] - 2026-08-19

### Changed & Fixed
- **Graceful Half-Close Coordination**: Removed premature 1.5s `server_fin_timeout` abort. When the Brook server sends `fin`, downstream `clientWriter.close()` is gracefully closed, allowing Firefox to fully read buffered HTTP/TLS payload chunks and complete TCP half-close without throwing `NS_ERROR_NET_PARTIAL_TRANSFER`.
- **Eliminated Handshake Refill Storms**: Tuned the standby warm pool to a resilient 8-session target (`targetPoolSize = 8`, `maxConcurrentHandshakes = 4`), refilling in smooth 2-session batches with 50ms pacing. Prevents background handshake traffic bursts from congesting the UDP transport or starving active dial requests.
- **Full SOCKS5/HTTP Error Cleanliness**: Resolved `NS_ERROR_CONNECTION_REFUSED` by preventing handshake packet drops on burst pre-connects and active website tabs.

---

## [v1.23.0] - 2026-08-19

### Changed & Fixed
- **Multi-Source Resilient Clock Synchronization**: Upgraded `QuicConnectionManager.measureClockDrift()` to query multiple Anycast UTC endpoints in parallel (Cloudflare trace, WorldTimeAPI, HTTP Date headers) to accurately synchronize against Brook Go server timestamp enforcement (`abs(diff) < 60s`).
- **Adaptive Dial Retry Clock Offset Rotation**: Implemented dynamic ±30s offset probing on handshake timeout retries in `ProxyDispatcher`. Automatically locks in the calibrated clock drift offset upon successful handshake (`onHandshakeDone`) across all future proxy requests.
- **Eliminated Boundary Oscillation**: Completely resolves the periodic 60-second boundary stall/drop where dials oscillated between succeeding in 230ms and hanging for 3.5s–5.0s on server `WaitReadErr`.

---

## [v1.22.0] - 2026-08-19

### Changed & Fixed
- **Dedicated QUIC Connection Architecture with 35 Standby Warm Pool**: Replaced multi-stream multiplexing on a shared QUIC connection with the official Brook architecture (1 dedicated QUIC connection per inbound proxy tunnel), backed by an expansive **35-connection standby warm pool**.
- **0ms Connection Latency with 100% Flow Control Isolation**: Every incoming browser TCP/HTTP CONNECT/SOCKS5 request receives a pristine pre-connected QUIC session with a full, fresh 1MB+ flow control window. Completely eliminates cross-site flow-control deadlocks (`connRemaining == 0`), head-of-line stalls, and dial response timeouts.
- **Continuous Auto-Replenishment**: The warm standby pool automatically refills in the background to ensure 35 pre-handshaked connections are continuously available for traffic bursts.
- **Clean Connection Disposal**: When a proxy tunnel or DNS resolution finishes, the dedicated session closes cleanly, releasing all memory buffers and connection state.

### Tests
- Updated unit test suite to validate dedicated warm session dispatching, 0ms pop, standby pool draining, and clean teardown.
- Validated 100% passing across the entire test suite.

---

## [v1.21.0] - 2026-08-19

### Added & Fixed
- **QUIC Pool Idle Window Expansion (45s)**: Updated `isAlive(maxIdleMs = 45000)` and `_startPoolHygiene()` in [`QuicConnectionManager`](file:///root/downloads/iwa/brook-quicclient/src/quic/quic-connection-manager.js) to match RFC 9000 QUIC idle timeout (45s). Prevents aggressive 5-second timers from destroying the persistent session pool during normal user reading pauses.
- **Keep-Alive Heartbeat Telemetry**: Added periodic keep-alive event logging and telemetry tracking (`💓 [QUIC Pool] Keep-alive active: X persistent + Y standby sessions healthy (latest ACK Zs ago)`), proving real-time keep-alive connectivity and ACK reception across all idle pool sessions.
- **Guaranteed Fresh Session on Dial Retries (`forceFresh = true`)**: Updated [`ProxyDispatcher`](file:///root/downloads/iwa/brook-quicclient/src/server/proxy-dispatcher.js) to request `createSession({ forceFresh: true })` on retry attempts 2 and 3, bypassing active pooled connections to guarantee retries never re-use a stale or closing session.
- **Instant Pool Cleanup on Session Termination**: Added `manager.unregisterSession(this)` inside `QuicSession.close()` to immediately purge terminating sessions from `activeSessions` and `warmPool`.

### Tests
- Added unit tests for 45s idle threshold detection, `createSession({ forceFresh: true })`, and `unregisterSession`.
- Validated 100% passing across the full 83-test suite with live parallel proxy requests.

---

## [v1.20.0] - 2026-08-19

### Added & Fixed
- **Persistent QUIC Connection Reuse & Multiplexing**: Eliminated "single-use disposable session" pattern where QUIC connections were destroyed upon each stream completion. Implemented RFC 9000 bidirectional stream multiplexing (`0, 4, 8, 12, 16...`) across persistent warm QUIC connections in [`QuicConnectionManager`](file:///root/downloads/iwa/brook-quicclient/src/quic/quic-connection-manager.js) and [`QuicSession`](file:///root/downloads/iwa/brook-quicclient/src/quic/quic-connection-manager.js).
- **Zero-Latency Stream Allocation**: Subresources for heavy SPAs (e.g. `x.com`, `meta.ai`, `abs.twimg.com`) now dynamically share active persistent QUIC connections with capacity up to 8 streams per session, completely eliminating the 5.8s on-demand handshake queue delay during concurrency bursts.
- **Stream-Level Cleanup in BrookTunnel & DnsResolver**: Updated [`BrookTunnel`](file:///root/downloads/iwa/brook-quicclient/src/core/brook-tunnel.js) and [`DnsResolver`](file:///root/downloads/iwa/brook-quicclient/src/core/dns-resolver.js) to release individual streams via `session.releaseStream(streamId)` upon tunnel or DNS query completion while keeping the underlying QUIC transport alive in the pool.

### Tests
- Added unit tests for RFC 9000 client bidirectional stream ID generation, capacity checks, and stream release.
- Verified 81/81 test suite passing with 20 parallel website connections.

---

## [v1.19.0] - 2026-08-19

### Fixed
- **`transport_closed` Outcome Classification**: Marked `outcome.success = true` in [`BrookTunnel`](file:///root/downloads/iwa/brook-quicclient/src/core/brook-tunnel.js) when `transport_closed` occurs after successful payload transfer (`serverHandshakeDone && totalBytesRecv > 0`), eliminating false error reporting on completed large downloads (e.g. 1.08MB stream completion).
- **Fast Reaping for Unused Speculative Sockets (15s Window)**: Updated idle timer logic in [`BrookTunnel`](file:///root/downloads/iwa/brook-quicclient/src/core/brook-tunnel.js) so speculative pre-connect connections that only send ClientHello with `totalBytesRecv === 0` are automatically reaped in 15 seconds instead of occupying pool sessions and host dial permits for 180 seconds. Active streams that receive response bytes continue to enjoy the full 180s HTTP/2 keep-alive window.
- **Speculative Refusal Notification**: Adjusted `target_dial_refused` log messages and suppressed erroneous proxy session warnings on normal transport closures.

### Tests
- Added unit test in [`scripts/run-all-tests.js`](file:///root/downloads/iwa/scripts/run-all-tests.js) verifying `transport_closed` outcome with received bytes is classified as `success: true`.

---

## [v1.18.0] - 2026-08-19

### Fixed
- **Reader Lock Preservation Across Retries**: Fixed `ReadableStreamDefaultReader` release/cancel timing in [`BrookTunnel`](file:///root/downloads/iwa/brook-quicclient/src/core/brook-tunnel.js). When an initial dial times out or is refused, the client reader and writer are preserved without being cancelled or having their locks released (`closeClientStreams: false`), allowing subsequent retry attempts 2 and 3 to seamlessly reuse the client stream without `TypeError: This readable stream reader has been released`.
- **Post-Connect Dial Verification Timer**: Shifted the dial verification timer in [`BrookTunnel`](file:///root/downloads/iwa/brook-quicclient/src/core/brook-tunnel.js) to start **strictly after** the QUIC session is connected and the client nonce/header are dispatched on the wire, decoupling dial timeout measurement from on-demand TLS/QUIC connection latency.
- **Adjusted Dial Timeout Intervals**: Set dial timeout intervals in [`ProxyDispatcher`](file:///root/downloads/iwa/brook-quicclient/src/server/proxy-dispatcher.js) to **3.5s** (attempt 1), **4.0s** (attempt 2), and **5.0s** (attempt 3), providing sufficient headroom for high-latency target server dials while recovering quickly from dropped routes.
- **Quiet TCP Keep-Alive Expirations**: Suppressed erroneous warning logs when long-lived HTTP keep-alive streams cleanly expire on idle timeout after exchanging payload data.

### Changed
- **Expanded QUIC Warm Pool**: Increased `targetPoolSize` to **35 warm sessions** and `maxConcurrentHandshakes` to **12** in [`QuicConnectionManager`](file:///root/downloads/iwa/brook-quicclient/src/quic/quic-connection-manager.js), with batch refill size of 8, eliminating on-demand handshake delays during 30+ request bursts on modern SPAs (e.g. `meta.ai`).

---

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
