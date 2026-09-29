# Brook QUIC IWA Client + Go Server — Full Code Review (Combined: Full + Connect-Stability)

**Date:** 2026-09-13 (combined update)
**Roots:** `brook-quicclient/` (Isolated Web App) + `brook-quicserver.go/` (Go, directory name ends with `.go`)
**Scope:** `index.html`, `app.js`, `manifest.webmanifest`, `styles.css`, `src/core/*`, `src/protocols/*`, `src/server/*`, `src/webtransport/*`, `src/workers/*`, `src/ui/*`, `brook-quicserver.go/main.go`, `server.go`, `quic.go`, `webtransport.go`, `brook_stream.go`, `crypto.go`, `socks5.go`, `limits.go`, `go.mod`, `server_test.go`, `scripts/wt-bridge.go`
**Focus add-on:** Issues that cause **connect broke / fail / unstable** (QUIC/WebTransport session & stream lifecycle, demux, keepalive, retry, timeout, backpressure, worker wiring)

---

## 0. Executive Summary

Two implementations of the Brook proxy protocol over QUIC/WebTransport:

* **Client (IWA):** `TCPServerSocket` → SOCKS5/HTTP parsers → Brook AEAD framing (`AES-256-GCM`) → `WebTransport` bidi streams. Pool of 5 WT sessions multiplexes N TCP connections as N bidi streams (main-thread path). Worker path exists but is dead/unwired.
* **Server (Go):** Single UDP socket serves raw Brook-QUIC and `WebTransport (h3)` on ALPN `h3/brook-quic/brook`, with autocert/self-signed TLS, demux by probing first stream, then `HandleBrookStream` with `withoutBrook` auto-detect, ±120s timestamp check, and bidirectional relay.

**Interop core matches:** `NextNonce` LE-u64 first-8, `HKDF-SHA256(salt=nonce, info="brook")`, `sealFrame 18B+(L+16B)` with `nonce+2`, even-TCP/odd-UDP timestamp rule, and `SHA256(password)` for `withoutBrook` are byte-identical between `brook-quicserver.go/crypto.go:14-31` and `brook-quicclient/src/core/brook-crypto.js:13-28,115-130` / `brook-framing.js:104-126,170-182`.

**Conn-stability verdict:** Several independent kill-switches guarantee broke/unstable under idle, load, or network flap:
1. Server `waitCh + 10s` global timer kills every tunnel >10s (`brook_stream.go:404-419,565-580`) — `#1` broke cause.
2. Server demux `3s` probe + `0x01/0x41` byte heuristic + lost control-stream causes random misclassify/deadlock (`server.go:271-376`) — flaky connect fail.
3. No `KeepAlivePeriod` → NAT idle kills pooled WT sessions silently (`server.go:178-188`).
4. Client publishes not-ready `transport` then kills whole slot on any stream error (`wt-connection-manager.js:208-209,352-358`) → flapping.
5. Per-TCP-connection QUIC handshake storm (worker path spawns pool=1 manager per connection) → overload/UDP loss (`wt-session.worker.js:88-98`, `wt-worker-manager.js:78-96`).
6. Single probe blip → `NetworkMonitor` `ANY 1/3` → mass `dropAllConnections+resetSession` (`network-monitor.js:76-93`, `app.js:69-77`).
7. 30s reaper kills idle-healthy long-lived streams on `BYTES` only (`wt-worker-manager.js:31-42`).
8. Tight client idle timers 10-15-30s + no write timeout cause premature `idle_timeout` and hang on backpressure (`brook-tunnel.js:136-158,425-427`, `wt-stream-adapter.js:60-62`).

**Active vs dead path (client):** `brook-quicclient/app.js:12-13,23-24,29,113-155` imports `WtWorkerManager,ListenerWorkerClient` but never instantiates them. Active path is main-thread `WebTransportConnectionManager + ProxyDispatcher + TcpListener + BrookTunnel + WtStreamSession`. `src/workers/*` and `src/core/dns-resolver.js:1-292` are dead code with latent P0/P1 bugs (but if re-enabled, they become unstable per #5, #7).

---

## 1. Repository Map

```
brook-quicclient/
  index.html, app.js, manifest.webmanifest, styles.css
  src/core/brook-tunnel.js, brook-crypto.js, brook-framing.js, byte-utils.js, dns-resolver.js, network-monitor.js
  src/protocols/socks5-parser.js, http-proxy-parser.js, protocol-detector.js
  src/server/tcp-listener.js, proxy-dispatcher.js, session-tracker.js
  src/webtransport/wt-connection-manager.js, wt-stream-adapter.js
  src/workers/proxy-listener.worker.js, wt-session.worker.js, worker-tunnel-bridge.js, listener-worker-client.js, wt-worker-manager.js
  src/ui/dom-builder.js, trusted-types-policy.js, log-stream.js, ui-controller.js
brook-quicserver.go/
  main.go, server.go, quic.go, webtransport.go, brook_stream.go, crypto.go, socks5.go, limits.go, go.mod, server_test.go
scripts/wt-bridge.go
```

---

## 2. Connect Broke / Fail / Unstable — Root Causes (Dedicated)

Severity: **Critical** = deterministically breaks stable connect; **Major** = breaks under load/flap/idle.

### C0 — Server kills every healthy tunnel after 10s (Critical) — `brook-quicserver.go/brook_stream.go:404-419,565-580`

```go
waitCh := make(chan struct{})
go func(){ wg.Wait(); close(waitCh) }()
select {
case <-waitCh:
case <-time.After(10*time.Second): // started at tunnel START, not teardown
  _ = remote.Close(); _ = client.Close()
  <-waitCh
  if relayErr==nil { relayErr = errors.New("relay teardown timed out after 10s") }
}
```

* `waitCh` closes only when **both** relay legs finish. Timer starts at dial (line 404). Any keep-alive, SSE, long poll, large download, or idle >10s is force-closed. This is the primary "connect broke after 10s" report.
* Duplicated in `handleSimpleBrookStream:565-580`.
* Pre-existing P0 `effectiveTimeout` bug (`259-262` computes `effectiveTimeout=300` when `timeout==0` but encrypted relay uses `timeout` for deadlines) compounds: with `tcpTimeout==0`, legs block forever until this 10s guillotine fires — half-close test `server_test.go:1333` papers over.
* **Fix:** Start 10s timer only after first leg exits (or remove). Use `effectiveTimeout`/per-leg idle deadlines for liveness; teardown grace should be `5s` peer deadline already in `unblockOther:251-256`, not 10s from start. Same fix both funcs.

### C1 — Server demux misclassifies / deadlocks / leaks (Critical) — `brook-quicserver.go/server.go:271-376`

Four sub-bugs:

* **a) 3s probe timeout too tight:** `probeCtx 3s:285` (`context.WithTimeout(s.ctx,3s)`) for both `AcceptUniStream`/`AcceptStream`. Slow H3 control stream / high RTT / loss → `case <-probeCtx.Done(): conn.CloseWithError(0,"probe timeout"):373-375` kills valid conn. Intermittent fail under load.
* **b) Single-byte heuristic collision:** `firstByte==0x01||0x41:343` decides WT vs raw Brook. `0x01`=H3 HEADERS, `0x41`=WT stream frame. Raw Brook nonce is 12B random → `p≈2/256=0.78%` per connection lands here → valid QUIC misrouted to `ServeQUICConn` → hangs/fails. Flaky, explains rare unstable.
* **c) Lost H3 control stream on bidi-wins WT path:** Bidi wins (`325` `case bstr<-bidiChan`) with WT frame: comment `345-346` says "do NOT drain" uni stream, but if probe already accepted `uniChan` value, it sits buffered in channel and is never injected. `ServeQUICConn` then blocks forever waiting for control stream → connect timeout. U-path correctly injects `uniStreams:[ustr]:316-318`, bidi-WT path must do `select{case orphan<-uniChan: uniStreams:[orphan]}else`.
* **d) Orphan drain race + DoS:** `310-314,361-366` `select{case orphan<-chan: default:}` races loser probe goroutine (may not have sent yet → leaked stream). Idle `h3` holds 2 goroutines 3s unbounded → DoS.
* **Fix:** Increase probe to 5-10s or make it `HandshakeIdleTimeout`-aware, harvest buffered `uniChan` non-blockingly for WT, use stronger disambiguation (require second byte / HTTP/3 SETTINGS), cancel loser with `defer cancel()` already done `306,328` but also drain via `if len==1` check, add per-IP probe concurrency limit.

### C2 — No QUIC keepalive → NAT kills idle pool (Critical) — `brook-quicserver.go/server.go:178-188`

```go
quicConfig := &quic.Config{
  MaxIdleTimeout: maxIdleTimeout, // 60s default
  // KeepAlivePeriod missing
  // HandshakeIdleTimeout missing (defaults to 5s)
}
```

* No `KeepAlivePeriod` (e.g. `15-20s`). Carrier/NAT mapping expires ~30s. Idle pooled WT sessions die server-side silently (`IdleTimeout` is treated as normal `isNormalStreamClose:45-47`). Client `WtStreamSession`/`slots` still `CONNECTED` → next `createBidirectionalStream` stalls 5s (`wt-connection-manager.js:340-362`) then `slot.transport.close()` kills slot → unstable after idle.
* **Fix:** `KeepAlivePeriod: 15*time.Second, HandshakeIdleTimeout: 10*time.Second`. Client should also probe `transport.closed` and proactively refresh idle slots (existing `327-331` refill helps but not for pooled `CONNECTED` with dead conn).

### C3 — Client publishes not-ready transport (Critical) — `brook-quicclient/src/webtransport/wt-connection-manager.js:208-209,240-243`

```js
localTransport = new WTClass(url, wtOptions);
slot.transport = localTransport; // BEFORE ready
await Promise.race([localTransport.ready, timeoutPromise]);
```

* Concurrent `createSession` (`295-379`) finds `slot.state==CONNECTING` with `slot.transport!=null` not deduped by `190` `slot.connectPromise` check alone (state is CONNECTING but transport already published). It may pick unready transport → `createBidirectionalStream` throws → error path closes whole slot.
* **Fix:** Publish `slot.transport` only after `await ready` succeeds. Keep `connectPromise` single-flight.

### C4 — Any stream error kills whole slot (Critical) — `wt-connection-manager.js:352-358`

```js
} catch(err){
  if(chosenSlot.transport){ chosenSlot.state=DISCONNECTED; chosenSlot.transport.close(); }
  throw err;
}
```

* Transient `MAX_STREAMS`/flow-control/quota error on `createBidirectionalStream` is per-stream, not per-connection. Closing slot cascades to all streams on that QUIC connection → flapping under concurrency.
* **Fix:** Only close slot on transport errors (`NetworkError`, `closed` promise). For stream quota, retry on another slot or backoff.

### C5 — Per-TCP-connection QUIC handshake storm (Critical) — `wt-session.worker.js:88-98` + `wt-worker-manager.js:78-96,114-116`

* Worker path: each inbound TCP (`proxy-listener.worker.js:240-249` `REQUEST_TUNNEL`) spawns `new Worker(wt-session.worker.js)` → new `WebTransportConnectionManager(poolSize:1)` → new QUIC connection + handshake per TCP. No reuse of `app.js:113-132` `poolSize:5`. Browser 6-20 parallel (Douban test, etc.) → 20 handshakes, `dispatchConnection` overload, UDP loss, `All 5 pool connections failed` → unstable under load.
* `wt-worker-manager.js:31-42` `warmStandby:1` lie, `getSnapshot` stub.
* Active main-thread path (`ProxyDispatcher+WtConnectionManager pool 5`) does reuse correctly (`proxy-dispatcher.js:295-306`), but `app.js` dead imports suggest confusion; if workers ever wired, storm returns. Even main path `createSession:310-317` warms slots `1..N` on first request with no jitter → thundering herd.
* **Fix:** Single shared `WebTransportConnectionManager` (pool=5) for all tunnels; workers if used must share one `DedicatedWorker` WT connection or use `SharedWorker`. Add jitter/stagger for warmup.

### C6 — False-offline mass kill (Critical) — `brook-quicclient/src/core/network-monitor.js:53-99` + `wt-connection-manager.js:384-425` + `brook-quicclient/app.js:69-80`

* `NetworkMonitor` polls 3 public URLs every 5s, 3s abort; `ANY success→online`, `ALL fail→offline:76`. Under `COEP:require-corp` (`index.html:8`) plain `fetch` without `CORP` headers always fails → false offline. Even without COEP, transient blip / firewall blocking `ipify/open-meteo/catfact` → `isOnline=false` → `app.js:72-73` `dropAllConnections()+resetSession()` kills **all healthy tunnels**. Next 5s flaps back → reconnect storm. `proxy-dispatcher.js:152-157` also drops new inbound on blip.
* `measureClockDrift:404-425` single-source `cloudflare.com/cdn-cgi/trace` plain fetch likely throws in IWA (CORS/CORP) → `0`, drift miscompensation → `request expired` (`brook_stream.go:188`).
* **Fix:** Require N consecutive failures (e.g. 2-3), jitter/backoff, never kill established tunnels on probe fail — only gate **new** dials. Or drop `NetworkMonitor` as gating signal entirely; rely on QUIC idle/transport `closed`. Add `mode:'cors'` + CORP or use `navigator.onLine` + QUIC `closed` as source of truth.

### C7 — Reaper kills idle-healthy long-lived streams (Critical) — `brook-quicclient/src/workers/wt-worker-manager.js:31-42`

```js
if(ageMs>30000) _terminateWorker(id,'worker_reaped')
```

* `lastActivity` only updated on `BYTES:115`. Long-poll/SSE/idle keep-alive with 0B/30s → reaped. Breaks stable idle (complements C0, C8).
* **Fix:** Update `lastActivity` on any `STREAM_DATA/FIN` or disable reaper; use idle timer per stream.

### C8 — Client idle timers too tight (Major) — `brook-quicclient/src/core/brook-tunnel.js:136-158,425-427`

```js
timeout = hasExchangedData?30000:15000; // pre-SN 15s, post-SN 30s
// half-close 10s, client FIN 15s
```

* Slow origin, large gap, video buffering → `cleanup(idle_timeout)` on healthy tunnel. Server `UDPTimeout 60s` vs client `15s` mismatch → client times out first.
* **Fix:** 60-120s idle for established, or disable idle until `serverHandshakeDone` + bytes.

### C9 — Hang on backpressure / no write timeout (Major) — `brook-quicclient/src/webtransport/wt-stream-adapter.js:60-62` + `brook-tunnel.js:191-195,372-380`

* `await writer.write(u8)` (`wt-stream-adapter.js:61`) and `await clientWriter.write(plainPayload)` (`brook-tunnel.js:374`) have no timeout. Flow-control stall → upstream loop stuck; `cleanup:191-195` `await activeWritePromise` with no timeout → worker never posts `DONE`, `ListenerWorkerClient` leaks.
* `isClosed` idempotence is correct (`wt-stream-adapter.js:131`, `brook-tunnel.js:161`), but `activeWritePromise` double-await races with `processRxQueue`.
* **Fix:** Wrap `write` with 10-15s timeout + `cleanup(upstream_write_failed)`. Bound `MAX_RX_BUFFER 16MB` good, but add `MAX_PENDING_BYTES 4MB` handling is correct fail-fast (`wt-stream-adapter.js:72-85`).

### C10 — Overload fail-closed without signal + retry disabled (Major) — `brook-quicserver.go/quic.go:34-41,69-76`, `webtransport.go:67-75`, `proxy-dispatcher.js:325-355`, `wt-session.worker.js:125-158`

* `streamSem cap 2048` vs `MaxIncomingStreams 1024+1024` non-blocking `select default { CancelRead+Close; continue }`. Client hangs to `dialTimeout 4-10s` then retries with jitter but `proxyReplied` set on server nonce (`brook-tunnel.js:303`) blocks retry for mid-stream `decrypt_error/transport_closed` that a fresh stream would fix (`proxy-dispatcher.js:353-355` `if proxyReplied break`).
* **Fix:** Return rate-limit reset error (`0x100`) and client fail-fast; allow retry for transport errors even after `sendSuccess`.

### Additional connect-relevant Majors

* **Stale `connectPromise` resurrection:** `wt-connection-manager.js:164-179` `resetSession` clears `transport` but not in-flight `connectPromise`; late success resurrects dead slot. Cancel with `AbortController`.
* **Initial-read race data loss:** `proxy-dispatcher.js:203-211` + parsers `Promise.race(reader.read(), timeout)` discards late `read()` value → lost coalesced bytes → framing break. Use deadline wrapper not race.
* **Listener→worker backpressure:** `proxy-listener.worker.js:220-227` `await writer.write(chunk)` blocks port loop unbounded; add queue bound.
* **0-byte = failure misclassify:** `brook-tunnel.js:415-422` `target_dial_refused` on any 0B close breaks legitimate empty 204. Only treat 0B as fail if `!serverHandshakeDone`.
* **`BrookCipher` extractable + cache key leak:** `brook-crypto.js:51-66,127` `extractable:true` + raw password hex in `cacheKeyFor` retains creds. Use `extractable:false`.
* **`DnsResolver` nonce desync (dead):** `dns-resolver.js:145-171` advances `sn` before confirming full frame buffered → fragmented desync, plus `session.close()` kills whole pool slot. Delete path (server already resolves `0x03`).

---

## 3. Prioritized Findings (All)

### P0 — Must fix before production / interop claim

1. **Server fail-open**: `brook-quicserver.go/main.go:47-48` hardcoded `password="271828brook"` if no env. Must `log.Fatalf` instead.
2. **C0 10s global kill**: `brook_stream.go:404-419,565-580` (see §2 C0). Plus **encrypted relay ignores timeout fallback**: `brook_stream.go:259-262` computes `effectiveTimeout=300` when `timeout==0` but `265-402` uses `timeout` for deadlines. With `tcpTimeout==0` both legs block forever until 10s guillotine. Fix: use `effectiveTimeout` everywhere.
3. **Handshake can block forever**: `brook_stream.go:63-69,72-115` handshake `ReadFull` deadlines are `tcpTimeout` (0 = infinite). Need dedicated handshake timeout (e.g. 10s) independent of `tcpTimeout`.
4. **Accept loop dies**: `brook-quicserver.go/server.go:259-264` any `ln.Accept` error `return err` kills whole server. Must `log+continue` unless `s.ctx` done/`closed`.
5. **`encodeAddress` corruption**: `brook-quicclient/src/core/byte-utils.js:144-177` regex accepts `999.999.999.999`, `Uint8Array` wraps mod 256, and `domainBytes.length>255` truncates `out[1]`. Silent address corruption.
6. **`NextNonce`/HKDF must stay pinned**: `brook-quicclient/src/core/brook-crypto.js:13-28,115-130` vs `brook-quicserver.go/crypto.go:14-31` match today; one-bit drift breaks every stream. Add interop test.
7. **C1 demux + C2 keepalive + C3/C4 slot lifecycle**: see §2.

### P1 — High

8. **Demux races / DoS**: `server.go:288-376` (a) orphan drain race, (b) bidi-wins WT lost control stream, (c) idle `h3` holds 2 goroutines 3s unbounded, (d) misleading `CloseWithError(0,probe timeout)`.
9. **Port truncation**: `brook-quicserver.go/socks5.go:89-94` `Atoi` without `0-65535` check → `70000→4464`, `-1→65535` via `uint16`.
10. **`client/src/core/dns-resolver.js:145-171` nonce desync** (dead code; delete or fix).
11. **Open proxy fallback**: `brook-quicclient/src/server/tcp-listener.js:38-92` tries `127.0.0.1→::1→0.0.0.0`; success on `0.0.0.0` exposes unauthenticated SOCKS5/HTTP to LAN. Require explicit opt-in.
12. **Direct Sockets shape unverified**: `tcp-listener.js:51-56` assumes `new TCPServerSocket(bindAddr,{backlog,localPort})` + `opened->{readable,localAddress,localPort}`. IWA spec has churned; test on target Chrome.
13. **COEP/CORS false offline (C6)**: `brook-quicclient/index.html:8` `COEP:require-corp` + `network-monitor.js:53-99` + `wt-connection-manager.js:384-425` probes without CORP/CORS → always fail → `dropAllConnections+resetSession` (`app.js:69-80`).
14. **Timeout-race data loss (C10)**: `proxy-dispatcher.js:203-211` + parsers `Promise.race(reader.read(), timeout)` discards late `read()` value.
15. **`TCP_TIMEOUT` dead env**: `brook-quicserver.go/main.go:69-74` `if tcpTimeout==0` never true (default 300) so env ignored. `76-81` `if udpTimeout==60` overrides explicit `60`. No range validation. `withoutBrook` flags `57-67` confusing dual alias.

### P2 — Medium

16. Worker latent bugs (if re-enabled): `proxy-listener.worker.js:165-170` drops SOCKS5 `leftover`, `213-232` leaks (`cleanupSession` without `session.close()`), `wt-session.worker.js:87-98` fresh manager per retry defeats pooling, `wt-worker-manager.js:31-43` reaps idle long-lived, `worker-tunnel-bridge.js:12,54-64` 4MB bound + FIN ordering.
17. `http-proxy-parser.js:137-145` forwards `Proxy-*` headers to origin; `socks5-parser.js:71` always replies `NO AUTH 0x00` without checking offer; 8KB cap `http-proxy-parser.js:43` too small.
18. `brook-framing.js:136-142` `openLength` no max-length cap; `brook-tunnel.js:608` `success==='both_closed'` misclassifies keep-alive/idle as failure; `byte-utils.js:61-120` `formatIpv6` uncompressed cosmetic.
19. Server: `server.go:240-243` `CheckOrigin:true`, `249-252` `/` catch-all, no per-IP rate limit, `178-188` `4/16MB` stream / `8/32MB` conn windows → `16GB` theoretical, `brook_stream.go:88` rewind uses full 22B on short read, `184-190` ±120s no nonce replay cache, open egress (`225-234`) with no denylist.
20. Hygiene: `crypto.go:52-55` document no constant-time needed; `limits.go:1-30` no Windows guard, silent `sysctl` failures, called from library `NewServer:133`; `go.mod:5-8` pinned 2024 `quic-go v0.43.0/webtransport-go v0.8.0/x/crypto v0.21.0`; `manifest.webmanifest:4` `1.37.0` vs `app.js:41` `v2.0.0`, duplicate `assets/`+`icons/`; `trusted-types-policy.js:5-17` allow-all passthrough with zero `innerHTML` use; `log-stream.js:20-45` unbounded `allHistoricalLogs`; `ui-controller.js:222-232` plaintext password in `localStorage`; `brook-crypto.js:51-66,127` password-string cache keys + `extractable:true`.

---

## 4. Go Server — File-by-File

### 4.1 `brook-quicserver.go/go.mod:1-23`

`module github.com/likev/brook-quic`, `go1.22`, `quic-go@v0.43.0`, `webtransport-go@v0.8.0`, `x/crypto@v0.21.0`. Pinned 2024; many QUIC/H3 fixes since. No `toolchain` pin, no `replace`. `limits.go` breaks `GOOS=windows`.

### 4.2 `brook-quicserver.go/main.go:1-111`

CLI + env fallback, `NewServer` + `ListenAndServe`, `SIGINT/SIGTERM`.

* `47-48` fail-open default password — must fail closed.
* `18-19,56-67` dual `withoutBrookProtocol/withoutbrook` aliases both default `true`; `false` on either forces `false`. Env only disables, never enables.
* `69-81` timeout env logic inverted (P1-15).
* `37-41,51-54` no `Cert/CertKey` flags (struct has them `server.go:113-114`).
* `98-106` `os.Exit(0)` skips defers, no `signal.Stop`; `ListenAndServe` error at `server.go:418` ignored on `:80` conflict.
* `92-95` `NewServer` never errors today — dead check.

### 4.3 `brook-quicserver.go/server.go:1-515`

Unified QUIC+WebTransport listener, TLS via autocert/self-signed, ALPN demux.

**Structs:** `isNormalStreamClose:30`, `bufferedStream:55/newBufferedStream:64`, `interceptedConn:74` (`AcceptUni/Stream:81,93`), `Server:106`, `NewServer:132`, `Ready/LocalAddr:152,157`, `ListenAndServe:167`, `dispatchConnection:271`, `setupTLS:379/generateSelfSignedCert:439/cleanAddr:470/Close:488`.

**TLS:** `386-389,424,435` `NextProtos=[h3,brook-quic,brook]` with `h3` first — most clients land in probe path. `439-468` RSA2048 per boot, `SerialNumber=UnixNano` predictable, `IP 0.0.0.0` invalid SAN, `DNSNames=[localhost,s.Domain]` includes `""` when no domain, `DirCache=.letsencrypt` CWD-relative, `httpServer :PORT||:80` may collide with UDP `PORT`, `Transport:212` never stored/closed.

**Demux:** `275-279` exact `brook-quic/brook` → `HandleRawQUICConn`. `282-376` `h3` probe races `AcceptUniStream` vs `AcceptStream` with `3s` `probeCtx:285`; `uni` first → WT, `bidi` first → peek 1B: `343` `0x01/0x41` → WT else raw Brook (`357`). ~0.8% random Brook nonces collide → misclassify. Loser drained via `select/default:310-314,361-367` (race) and `uniChan` control stream dropped on bidi-wins WT (`345-346` wrong). Idle `h3` holds goroutines 3s unbounded; `373-375` `CloseWithError(0,probe timeout)` misleading. **See C1 for connect-fail impact.**

**QUIC config:** `178-188` `MaxIncoming{,Uni}Streams=1024`, windows `4/16MB` / `8/32MB` → `16GB` per conn; `147,234` global `streamSem cap 2048` non-blocking drop (`quic.go:35,70`, `webtransport.go:68`) but unauthenticated streams hold slots until `tcpTimeout` (300s) → exhaustion. Unbounded `go dispatchConnection:267`. **Missing keepalive → C2.**

**Lifecycle:** `260-264` kills server on transient `Accept` error. `249-252` `/+/brook+/ws+/webtransport` all → `HandleUpgrade`. `240-243` `CheckOrigin:true`. `isNormalStreamClose:30-53` treats `IdleTimeout` as normal; string matching `50-52`.

### 4.4 `brook-quicserver.go/quic.go:1-96`

Raw Brook-over-QUIC: each QUIC bidi stream = one Brook TCP/UDP proxy stream. `RawQUICStreamConn:11-23`, `HandleRawQUICConn:26-96` handles `firstStream:33-59` then `AcceptStream` loop `63-67` with `go HandleBrookStream:70`.

* `37-40` dropping `firstStream` on `sem` pressure abandons whole conn (coarse but caller closes).
* `62` `ctx:=conn.Context()` not `s.ctx` → `Close` cannot interrupt loop; leak.
* Closure `go func(c StreamConn)` correctly captures; `remoteAddr` shared read-only ok.

### 4.5 `brook-quicserver.go/webtransport.go:1-95`

WT upgrade + per-stream `HandleBrookStream`. `WTStreamConn:12-24`, `NewWebTransportHandler:36-45`, `HandleUpgrade:47-95` (`Upgrade:49`, `AcceptStream:62`, sem `67`, `go HandleBrookStream:83`).

* `49-53` `WriteHeader(500)` after `Upgrade` may have written headers — just `return`.
* No session tracking/max-streams-per-session/timeouts; `Close` doesn't close sessions; datagrams ignored.

### 4.6 `brook-quicserver.go/brook_stream.go:1-582`

Core Brook framing, dial + relay, pools. **Contains C0 global 10s kill.**

* `15-25` `brookInfo="brook"`, `buf64kPool` 64KB.
* `27-53` `StreamConn`, `bufferedStreamConn:39`.
* `56-96` `HandleBrookStream`: deadlines `59-61,99-101` (0 = infinite), `passHash=SHA256(password)` unless `len==32:65-69`, `first12:72-75`, simple-mode detect `78-91`, else `handleEncrypted:95`.
* `98-421` `handleEncryptedBrookStream`: reads `cn:104-109`, `lenBuf18:112-115`, auto-detect `124-134`, `plainLen:150-154`, `NextNonce:162`, `headerLen>2048:164`, `payloadBuf:169-177`, `len<7:179`, `ts±120s + even/odd:184-196`, `ParseBrookDestination:200-203` zero allowlist → open proxy, `GenerateNonce+DeriveKey:206-217` same `info="brook"` both directions (separated only by random nonces), `Write(sn):219`, `Dial 10s:225-234`, relay `237-257` `WG+errOnce+doneOnce/unblockOther 5s`, `259-262` `effectiveTimeout` unused in encrypted relay (P0), `265-334` server→client batching `2014/65473`, `41-45`-`batch 32768/65507<65536` correct, `Seal` in-place correct, single `Write` ok for QUIC/WT, `329` `client.Close()` on EOF ok, `337-402` client→remote `l==0:373` keepalive/fragments fragile, `377` `l>len(payloadChunk)-16 (65520)` good, `342-349` pooled buffers safe, `404-420` `waitCh+10s` global timeout (C0) adds latency but kills >10s healthy.
* `423-582` `handleSimpleBrookStream`: same but correctly uses `effectiveTimeout:481-484,513`, same `565-580` global 10s kill.

**Auth errors** `158-160` generic `auth error` (no oracle, good), `sn` withheld on failure.

### 4.7 `brook-quicserver.go/crypto.go:1-55`

`NextNonce:14-21` LE first-8 +1, `DeriveKey:24-31` `HKDF-SHA256(nonce as salt, info="brook")`, `NewGCMCipher:34-40`, `GenerateNonce:43-49`, `SHA256Bytes:52-55`. Interop-critical; verify against upstream `txthinking/brook`.

### 4.8 `brook-quicserver.go/socks5.go:1-106`

`ToAddress:17-42`, `ParseBrookDestination:49-81`, `ParseAddress:83-106`.

* `63-72` domain heuristic `len==domainLen+1` works but ambiguous; no `>255`/charset checks.
* `89-94` port truncation bug (P1-9).

### 4.9 `brook-quicserver.go/limits.go:1-30`

`RaiseLimits` raises `RLIMIT_NOFILE`, `sysctl rmem_max`. Ignores errors, may set `Inf` in containers, `rmem_max` only, `exec.Command` without context timeout, requires root, called from library `NewServer:133` (should be `main`-only), no Windows build tag.

### 4.10 `brook-quicserver.go/server_test.go:1-1736`

Echo-backed integration: raw QUIC+WT, `WithoutBrook`, 20× multiplex, 25+25 dual, autodetect, cleanup, `bidi-no-data:1280`, `half-close timeout0:1333`, benchmarks `1469,1621`. Covers transports/modes/concurrency/leaks but no negative tests for `headerLen>2048`, expired `ts`, bad `ATYP`, truncated payload, `l==0`, port range, `InsecureSkipVerify` only, ignored `Write/Read` errors mask failures, leak asserts `baseline+20/30/50` brittle with `5s` sleeps. **Tests never exercise >10s steady-state (`totalBytes 10MB` bursts), so C0 not caught.**

---

## 5. IWA Client — File-by-File

### 5.1 `brook-quicclient/index.html:1-183`

Dashboard: config form (`https://brook-quic.pplx.io:4433/brook:42`, `271828brook:47`, `10808/8080`), telemetry grid, session table, log stream, hex modal. `<meta http-equiv>` `COOP/COEP/CORP/Permissions-Policy:10` includes invalid `cross-origin-isolated=(self)` and proposal tokens. `COEP:require-corp:8` without CSP `connect-src` breaks probes unless endpoints send `CORP:cross-origin`.

### 5.2 `brook-quicclient/app.js:1-206`

Bootstrap: `initTrustedTypesPolicy`, `LogStream`, `SessionTracker`, `UiController`, `WebTransportConnectionManager(pool=5)`, `ProxyDispatcher`, `NetworkMonitor`.

* `55-176` `onStart`: `monitor.start→measureClockDrift→manager.connect` (tolerates `129-132`) → `dispatcher.start→updateBoundPorts`. Offline `69-80` `dropAllConnections+resetSession` (C6); online `81-101` re-measures drift + `connect()` but never restarts listeners. Rollback `160-175` stops monitor/dispatcher/manager.
* Dead: `12-13,23-24,29` `WtWorkerManager/ListenerWorkerClient/HAS_WORKER_SUPPORT` unused.
* `118` `serverCertificateHashes` never produced by `UiController.getConfig()` → self-signed pinning unreachable; WT wants `[{algorithm,value}]` not strings.

### 5.3 `brook-quicclient/manifest.webmanifest:1-47`

IWA manifest `id/scope/start_url /:6-8`, `isolated_storage:true:46`, `permissions:direct-sockets:41-45`. Duplicate icons `assets/:13-22` + `icons/:23-32`; `version:1.37.0:4` vs `app.js:41` `v2.0.0`; `update_manifest_url:5` external.

### 5.4 `brook-quicclient/styles.css:1-608`

Pure theme; no logic. `.hidden:606-608` used for `group-http-port` auto-detect.

### 5.5 `brook-quicclient/src/core/brook-crypto.js:1-155`

`generateNonce:34-38`, `sha256:45-49`, `nextNonce:13-28` LE-u64 bytes 0-7 with wrap, `deriveKey:115-130` `HKDF-SHA256→AES-GCM` (`salt=nonce12, info="brook"`), `deriveKeyBytes:141-155`, LRU `baseKeyCache max 8:51-53`. Issues: endianness pinned, `cacheKeyFor:55-66` retains raw password hex; `deriveKey:127` `extractable:true` could be `false`.

### 5.6 `brook-quicclient/src/core/brook-framing.js:1-182`

`BrookCipher:11-86`, `sealFrame:104-126`, `openLength:136-142`, `openPayload:152-157`, `buildBrookHeader:170-182` (`BE32 timestamp + dstBytes`, even TCP / odd UDP, `+clockOffsetSec`). `141` no max-length check → `65535` stalls; `171` `Math.round` redundant.

### 5.7 `brook-quicclient/src/core/brook-tunnel.js:1-619` — most critical client file

Full-duplex tunnel: register WT stream, send `cn+seal(header)+seal(leftover)`, await `sn`, then upstream `clientReader→seal→sendStreamData` + downstream `rxQueue→openLength/openPayload→clientWriter`, handshake/idle timers, 16MB `rxQueue`, `globalMetrics`.

* Correct: `cn` vs `cnCopy:111-112,494-503` split, `sendSuccess` after `sn:303-309`, retry-safe `closeClientStreams:207,326`, `handshakeTimer` after frames on wire `519-526`, upstream gated on `serverHandshakeDone:537`.
* **C8/C9:** `608` `success==='both_closed'` misclassifies idle as failure; `checkFullClose:241-257` stale `rxBuffer` without trim; `uploadPendingBytes:566,580,584` undercounts `leftover:506-516`, `hasExchangedData:true` on `leftover:507` extends idle; `cleanup:198-203` tight coupling; `activeWritePromise:192-195` vs `processRxQueue` race handled as cleanup but needs write timeout.
* **Idle:** `136-158` 15s/30s timeout (C8), `425-427` 10s half-close.

### 5.8 `brook-quicclient/src/core/byte-utils.js:1-217`

`concat`, `read/writeU16/32BE`, `hex`, `parseIpv6/formatIpv6:61-120`, `parseHostPort:122-142`, `encodeAddress:144-177` (`0x01 IPv4/0x04 IPv6/0x03 domain`). P0 bugs at `144-177`.

### 5.9 `brook-quicclient/src/core/dns-resolver.js:1-292` — dead + P0 bug + connect-risk if enabled

DNS-over-TCP via Brook to `8.8.8.8:53`, A-record parse, TTL cache round-robin. `onData:145-171` advances `sn` before confirming full frame buffered → fragmented nonce desync. Only first frame read; `onClose:177-180` resolves `[]` masking errors; `session.close():199-203` closes whole pool slot. No caller (`proxy-dispatcher.js:12` import unused); server already resolves `0x03`. Delete or fully fix.

### 5.10 `brook-quicclient/src/core/network-monitor.js:1-124`

Polls 3 URLs every 5s, 3s abort `16-20,53-99`; `ANY success→online`, `ALL fail→offline`. Under `COEP:require-corp` probes fail → false offline (C6). Re-entrancy guard `54` returns stale `isOnline`. No jitter/backoff.

### 5.11 `brook-quicclient/src/protocols/socks5-parser.js:1-160`

`handleHandshake` method negotiate → `NO AUTH 0x00:71` → CONNECT `125` `dstBytes=buf.slice(3,totalReqLen)` → `sendSuccess:130-138` / `sendFailure:140-150`. Always `0x00` without checking offer; `MAX_SOCKS5_BUF=1024:28`; timeout race; no `domainLen==0/>255` validation.

### 5.12 `brook-quicclient/src/protocols/http-proxy-parser.js:1-179`

`CONNECT` tunnel `leftover=body:103` and plain `GET http://…` (rewrites to origin-form `137-145`). `findHeaderEnd:9-19` correct but 8KB cap `43` too small; forwards `Proxy-*` headers (`138` leaks creds).

### 5.13 `brook-quicclient/src/protocols/protocol-detector.js:1-47`

First-byte `0x05→socks5:36-38`, `C/G/P/H/D/O/T→http:41-43`, else `unknown`. `0x04` SOCKS4 / `0x16` TLS → `unknown` → `proxy-dispatcher.js:257` throw without proxy reply and close (correct).

### 5.14 `brook-quicclient/src/server/tcp-listener.js:1-168`

Wraps `globalThis.TCPServerSocket`: tries `127.0.0.1→::1→0.0.0.0:38-92` else ephemeral; `maxConnections=512:107-110`; `_acceptLoop:100-136`; `stop:138-167`. Issues: shape unverified (`51-56`), open-proxy `0.0.0.0` fallback, `CHROME_RESTRICTED_PORTS:8-13` includes `1080` (UI migrates `1080→10808`).

### 5.15 `brook-quicclient/src/server/proxy-dispatcher.js:1-421`

`start:60-135` auto vs split listeners, atomic rollback `130-134`, `dropAllConnections:140-149`, `_handleClient:151-178` `activeHandlers`, `_processClient:180-395` 10s initial read `206` anti-unhandled, protocol dispatch `240-258`, one-shot `sendSuccess/SendFailureOnce:262-271`, 3-attempt retry `dialTimeout 6/8/10s:308`, `createSession:297`, `BrookTunnel.run:312-339`, no-retry if `clientDataConsumed||proxyReplied||bytesReceived>0||client_abort|rx_overflow:353-355`, `stop:397-420`.

* **Connect wounds:** Initial-read race `203-211` (C10), retry reuses `reader/writer` with `closeClientStreams=false` on attempts 1-2 `326` (fragile), `quicSession.close:333-336,348-350` idempotent, stubs `getHostQueueTotal/getStats:39-49` feed `getSnapshot` as real metrics. `dropAllConnections` is C6 kill-switch.

### 5.16 `brook-quicclient/src/server/session-tracker.js:1-124`

`createSession/recordBytes/closeSession`, 500ms ticker `eventLoopDelayMs:35-59`, `getStats:100-115` merges transport snapshot.

### 5.17 `brook-quicclient/src/webtransport/wt-connection-manager.js:1-446` — connect pool heart

Pool 5 WT sessions `43-51`, `connect:270-289` `allSettled` needs ≥1, `createSession:295-379` lazy `slot0` + background warm `311-317` + refill `327-331`, least-loaded pick `334-335`, 5s stream timeout `340-362`, `_connectSlot:184-265` single-flight `190`, 5s `ready` race `240`, `resetSession:164-179`, `measureClockDrift:384-425` single `cloudflare` + `Promise.any`, `getSnapshot:121-155`.

* **Connect wounds:** C3 premature publish, C4 slot-kill, C5 storm, C6 gating, fake `streamId=(nextStreamSeq+=4):337`, `serverCertificateHashes:199-202` needs `{algorithm,value}` objects (always `[]`), `measureClockDrift` CORS/CORP fail → `0`, no auto-reconnect on `closed:212-232`.

### 5.18 `brook-quicclient/src/webtransport/wt-stream-adapter.js:1-152`

Adapts one `WebTransportBidirectionalStream` to `{allocateStreamId,registerStream,sendStreamData,ensureConnected,close}` for `BrookTunnel`. Read pump `70-128` delivers `onData(value,false)` / `onData(empty,true)+onClose`; 4MB `109-112` fail-fast overflow; `sendStreamData:55-68` `writer.close()` on `fin`. **C9** no write timeout.

### 5.19 Workers — latent (not wired) but would be unstable if enabled (C5, C7, C10)

* `proxy-listener.worker.js:1-318` accept+handshake+`MessageChannel` handoff `REQUEST_TUNNEL` with `port2` transfer `241-249`, zero-copy `252-275`. Bugs: drops SOCKS5 `leftover:165-170`, leaks on `STREAM_FAILED/FIN/ERROR/CANCEL:213-232`, empty-initial-read `150-155` half-open, global `isRunning:254` pump.
* `wt-session.worker.js:1-232` per-connection WT worker, 3-attempt `BrookTunnel.run` with fresh `poolSize:1` manager per attempt `87-98` (defeats pooling), dual timeouts `attemptTimeoutMs 4/6/8s:84` vs `dialTimeoutMs:126`.
* `worker-tunnel-bridge.js:1-162` `MessagePort↔{clientReader,clientWriter}` 4MB bound `12,46-49` `abortInbound`, zero-copy `116-122`, `CLIENT_FIN:54-64` `isClosed` immediate correct via ordering, `cancel:98-109` resolves pending reads as `done`.
* `listener-worker-client.js:1-113` / `wt-worker-manager.js:1-199` supervisors; `Worker('./proxy-listener.worker.js',{type:'module'}):30-31` must be bundled + `script-src` allowlisted; `REQUEST_TUNNEL:61-74` transfer `event.ports[0]:62`; reaper `31-43` (C7) kills idle >30s on `BYTES:115` only, stub `getSnapshot:51-61` (`warmStandby:1` lie).

### 5.20 `brook-quicclient/src/ui/*`

* `dom-builder.js:17-48` `createElement/textContent/appendChild` only — TT-safe.
* `trusted-types-policy.js:5-17` creates `default` passthrough `string=>string` (defeats TT if any `innerHTML` appears; codebase uses zero `innerHTML` — remove or make it throw).
* `log-stream.js:20-45` unbounded `allHistoricalLogs` (500 cap only on display `35-37`) → OOM; `61-64` clipboard joins entire history.
* `ui-controller.js:1-351` `getConfig:234-259` strips prefixes, splits path, `parseHostPort` handles `[v6]:port`; port guards `265-276` + `1080→10808:206-208`; `_saveSettings:222-232` plaintext password in `localStorage`; `btnCopyLogs:82-146` excludes password but includes targets; `updateConnectionState:333-351` handles `reconnecting` string not in `ConnectionState` enum.

---

## 6. Security Notes

* Server is an open proxy by design (`ParseBrookDestination:49-81` zero allowlist). Document and optionally add egress denylist (RFC1918/link-local/metadata `169.254.169.254`).
* `server.go:240-243` `CheckOrigin:true` + `249-252` `/` catch-all → any site driving victim browser can drive proxy (password still required but brute-force surface).
* `server.go:178-188` large windows + `147,234` shared `streamSem` without handshake timeout → sem exhaustion; add per-IP throttling.
* `brook_stream.go:184-190` ±120s window with no nonce replay cache → capture within window can open new egress to same target. Consider nonce cache.
* IWA client: no default password, no `localStorage` password, no `0.0.0.0` bind, strip `Proxy-*`, reject `domain>255`, enforce `0-65535` ports, remove TT passthrough, fix `extractable:false`.

---

## 7. Recommended Fix Order (Connect-Stability First)

1. **Server 10s guillotine + timeout fallback**: `brook_stream.go:259-262,404-419,481-484,565-580` use `effectiveTimeout` everywhere, remove global 10s or start after first leg exit; add 10s handshake deadline.
2. **QUIC keepalive + demux**: `server.go:178-188` add `KeepAlivePeriod:15s, HandshakeIdleTimeout:10s`; `271-376` fix probe races, harvest `uniChan` control stream, increase probe to 5-10s, stronger `0x01/0x41` disambiguation, per-IP probe limit; `260-264` `continue` on transient Accept; `212,488` track/close `Transport`.
3. **Client pool & slot**: `wt-connection-manager.js:184-265,352-358` publish transport after `ready`, don't kill slot on stream errors, add `AbortController` for `connectPromise` resurrection, stagger warmup. Decide single path: keep main-thread (`ProxyDispatcher`) and delete workers, or share one manager across workers.
4. **False offline & reaper**: `network-monitor.js:53-99` + `app.js:69-80` require 2-3 consecutive fails, jitter, never kill established tunnels; or remove as kill-switch. `wt-worker-manager.js:31-43` fix `lastActivity` or disable reaper.
5. **Idle/write**: `brook-tunnel.js:136-158,425-427` extend idle to 60-120s; `wt-stream-adapter.js:60-62` + `brook-tunnel.js:372-380` add write timeouts with fail-fast.
6. **Remaining P0/P1**: `main.go:47-48` fail-closed; `socks5.go:89-94` port validation; `byte-utils.js:144-177` octet/domain validation; `brook-framing.js:141` `openLength` cap; `tcp-listener.js:38-92` verify Direct Sockets shape, remove `0.0.0.0` fallback; `proxy-dispatcher.js:203-211` deadline wrapper; `http-proxy-parser.js:138` strip `Proxy-*`; `socks5-parser.js:71` check method offer.
7. **Hygiene**: delete/fix `dns-resolver.js:145-171`; delete/finish `src/workers/*`; credentials hardening; `limits.go` Windows/`sysctl`; bump `go.mod` deps; reconcile `manifest`/`app.js` versions; cap `log-stream.js` history.

---

## 8. Verification Checklist

* [ ] Long-lived (>60s) idle keep-alive / SSE does **not** die at 10s (server `waitCh` fix) and NAT 60s does not kill pool (keepalive).
* [ ] `go test -race -count=100` no demux leak; 0.78% nonce collision test passes; slow H3 control stream (>3s) connects.
* [ ] `TCP_TIMEOUT=0` env effective; `tcpTimeout==0` handshake 10s, relay 300s fallback; `ln.Accept` transient error does not kill server; `Close()` closes `Transport`/sessions.
* [ ] Client: concurrent 20 streams on one pool slot succeed; transient `MAX_STREAMS` does not kill slot; `createSession` before `ready` does not race.
* [ ] Network flap (block probes) does **not** `dropAllConnections`; 30s idle with 0B not reaped; `clientWriter.write` backpressure times out cleanly.
* [ ] `encodeAddress("999.999.999.999")` and `domain 256B` rejected; `70000/-1` ports rejected; `headerLen>2048`, expired `ts`, bad `ATYP`, truncated `payloadChunk`, `l==0` frame handled; `write/read` errors not ignored in tests.
* [ ] IWA `TCPServerSocket` bind succeeds on target Chrome; `0.0.0.0` fallback removed or flagged; `COEP:require-corp` probes succeed (CORS+CORP) or monitor not gating.
* [ ] End-to-end Brook interop: SOCKS5 + HTTP CONNECT + plain HTTP proxy via WT and raw QUIC, `withoutBrook` true/false, steady-state 16MB+ transfer, half-close `timeout0`, Douban-concurrency (N=20) stable.

