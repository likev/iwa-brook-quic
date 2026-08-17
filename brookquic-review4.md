# Brook QUIC Client IWA — Review 4: Anycast Spreading & Concurrency Optimization

## 1. TL;DR
The root cause of the "20+ parallel dials dying simultaneously" (specifically to large domains like Google and GitHub) has been identified and mitigated in `v1.14.0`. The issue was **Target-Side Anycast Rate Limiting**.

Because HTTP/1.1 and early connections from the browser fan out to 12-20 parallel TCP connections, the previous DNS cache logic resolved the domain once and returned the **exact same Anycast IP** for all 20 connections. The remote Brook VPS then dialed that *single* target IP 20 times simultaneously. Modern edge providers (Cloudflare, Fastly, Google) interpret 20 simultaneous TCP SYN packets from a single datacenter IP to a single edge node as a DDoS or bot attempt, and instantly drop or RST the connections.

By forcing local DNS rotation (a 2-use max cache limit), the client now spreads those 20 parallel dials across the target's entire Anycast IP pool. The target edge nodes now see only 1-2 connections each, entirely bypassing their rate-limiting thresholds.

## 2. The HTTP/2 Multiplexing vs. Initial Browser Behavior
The user correctly noted that HTTP/2 and HTTP/3 support multiplexing over a single connection. So why does the browser make 20 parallel dials?
- **Pre-HTTP/2 Discovery:** Browsers do not know a site supports HTTP/2 until the initial TLS ALPN handshake is complete. For initial page loads, browsers often aggressively open 6 parallel TCP connections per hostname (e.g., `github.com`, `api.github.com`, `avatars.githubusercontent.com`), easily totaling 20+ connections across a modern page.
- **Proxy Translation:** The browser sends these as individual SOCKS5 or HTTP CONNECT requests. The proxy translates each into a separate `QuicSession` and a separate Brook dial.
- **The Anycast Bottleneck:** Before v1.14.0, all 6 connections for `github.com` resolved to the same IP. The VPS slammed that one IP with 6 rapid TCP SYNs.

## 3. The `v1.14.0` Solution: DNS IP Rotation
We implemented a strict rotation mechanism in `DnsResolver` (`src/core/dns-resolver.js`):
- **2-Use Cache Limit:** The LRU cache now tracks `remainingUses`. After 2 hits, the IP is evicted.
- **Randomized Anycast Selection:** `_resolveViaBrook` now picks a random IP from the returned A records (`ips[Math.floor(Math.random() * ips.length)]`) instead of always taking `ips[0]`.
- **Result:** When the browser requests 6 connections to `github.com`, the client queries DNS 3 times and returns 3 different IPs (2 uses each). The VPS dials 3 distinct GitHub edge nodes, completely dodging the anti-bot triggers.

## 4. Current Codebase State & Concurrency Tuning
The codebase has been heavily tuned to support this high-concurrency model:
- **SessionPool Capacity:** `targetWarm` increased to 12, allowing the client to instantly absorb the browser's initial connection storm without waiting for 6000ms QUIC handshakes.
- **Permit-based Handshakes:** limits simultaneous handshakes to prevent overwhelming the local Direct Sockets UDP send queue.
- **UDP Send Queue Safety:** As established in Review 3, the `udp-socket-adapter.js` now uses a high-watermark heuristic that preserves critical control packets (Initial/Handshake) while shedding redundant ACKs.

## 5. Outstanding QUIC Engine Inefficiencies (BBR-Lite & ACK Floods)
While the structural dial failures are fixed, the underlying QUIC engine (`vendor/quic-engine.bundle.js`) still has two significant performance ceilings that affect long-running downloads:
1. **ACK Floods:** The engine sends immediate ACKs for every `ackEliciting` frame but fails to clear `pending_ack.app`. This causes duplicate ACKs to be piggybacked into outgoing bursts, inflating packet rates.
2. **BBR-Lite Proxy Collapse:** Because BBR-Lite calculates bottleneck bandwidth (`bbr_btlbw`) based purely on *outbound* ACKed bytes, it registers near-zero bandwidth for a proxy client (which mostly receives data). This collapses the pacing rate and congestion window to their absolute floors (12 KB/s, 2400 B), slowing down the uplink.

## 6. Conclusion
The v1.14.0 update fundamentally solves the "target-side rejection" issue. By acting as a load-balancer that spreads dials across Anycast pools, the Brook QUIC Client now effectively mimics the behavior of a massive, distributed user base rather than a single datacenter scraper, dramatically improving reliability for heavy sites.
