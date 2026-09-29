# Race Condition, Deadlock, Memory Leak and Performance Review — Round 2

Scope: `brook-quicserver.go/*.go` (Go unified QUIC + WebTransport server) and `brook-quicclient/src/**/*.js` (Chromium IWA WebTransport client).
Method: manual code read + `go vet ./...` (clean, Go 1.26.7).

No classic Go data-race or mutex-deadlock was found. Issues below are logical stalls, goroutine/memory leaks, async races in JS, and perf bottlenecks.

---

## 1. Go server — races

### 1.1 Safe (verified, no change needed)

* `brook-quicserver.go/server.go:49-76` — `interceptedConn.mu` correctly guards `uniStreams/bidiStreams` for concurrent `Accept*` from `ServeQUICConn`.
* `brook-quicserver.go/brook_stream.go:230,273` — `ca/cn` used only in client->remote leg, `sa/sn` only in remote->client leg after split. No shared AEAD/nonce race.
* `password []byte` shared read-only across streams, never mutated. Safe.
* `quic.Stream` concurrent 1-reader + 1-writer usage in `brook_stream.go:227-322,383-428` matches quic-go contract.

### 1.2 `Server.Close()` vs `ListenAndServe()` race

Files: `brook-quicserver.go/server.go:124,153,160,334,408-421`, `brook-quicserver.go/main.go:97-106`.

`packetConn`, `listener`, `httpServer` are plain fields written during startup and read in `LocalAddr()` / `Close()` from the signal-handler goroutine. If signal arrives during startup, nil/partial read races. In tests `Ready()` channel gives happens-before, but production has no guard.

Fix:

```go
// use atomic.Pointer / sync.RWMutex for packetConn, listener, httpServer
// or sync.Once for close(ready) + startup barrier before signal handler enabled
```

---

## 2. Go server — deadlock / goroutine leak (load-bearing)

### 2.1 `dispatchConnection` blocks forever on bidi-first read

File: `brook-quicserver.go/server.go:258-299`, specifically `server.go:265`:

```go
buf := make([]byte, 1)
n, err := bstr.Read(buf) // no deadline, probeCtx already cancelled
```

`cancel()` is called on winner-path before this `Read`, so the 3s `probeCtx` no longer bounds it. Client that opens a bidi stream and sends 0 bytes leaks one `dispatchConnection` goroutine forever. This is a trivial DoS.

Fix: `bstr.SetReadDeadline(time.Now().Add(3*time.Second))` before peek, clear after; or `io.ReadFull` with context wrapper.

### 2.2 `wg.Wait()` half-close stall

Files: `brook-quicserver.go/brook_stream.go:227-322` (encrypted), `brook_stream.go:383-431` (simple).

Two copy loops each `return` on error/EOF, `wg.Wait()` returns only when both return. There is no close-propagation:

* remote EOF -> remote->client leg returns, client->remote leg still blocked in `client.Read`.
* client FIN -> client->remote leg returns, remote->client leg still blocked in `remote.Read`.

With production default `tcpTimeout=0` (`brook-quicserver.go/main.go:20`), no deadline is set, so stall is infinite: 2 goroutines + `remote net.Conn` + QUIC stream leak per half-closed connection. Tests use `tcpTimeout=10/2` so they pass and mask it.

Also inconsistent: `server.go:137-141` sets `MaxIdleTimeout=UDPTimeout (60s default)`, which will kill idle QUIC conns even when `tcpTimeout=0` promises “no timeout”.

Fix:

```go
// when either leg exits, CancelRead / CloseWrite the peer + SetDeadline(time.Now())
// then Wait with timeout, e.g. 5s, then hard Close
// default tcpTimeout 0 -> 300s idle timeout instead of 0
```

### 2.3 Unbounded goroutine / stream fan-out

Files: `brook-quicserver.go/server.go:191-201`, `brook-quicserver.go/quic.go:39-65`, `brook-quicserver.go/webtransport.go:57-77`.

Every `Accept` and every `AcceptStream` does bare `go`. `quic.Config` in `server.go:137-141` sets no `MaxIncomingStreams / MaxIncomingUniStreams / KeepAlivePeriod`. Defaults in quic-go v0.43.0 are permissive. Single abusive QUIC conn can open thousands of streams -> OOM / FD exhaustion.

Fix: set explicit limits + global semaphore (e.g. 1000-2000 active `HandleBrookStream`, reject excess with `CloseWithError`).

### 2.4 Probe orphan drains are correct but fragile

Files: `brook-quicserver.go/server.go:221-233,242-248,289-295`.

Loser probe is stopped by `cancel()`, so `default:` drain is usually a no-op. Correct today, but depends on `Accept*(probeCtx)` respecting cancellation promptly. Keep, add comment. Not a leak.

No mutex deadlock: only one mutex (`interceptedConn.mu`), no nesting, no lock-held I/O.

---

## 3. Go server — memory leak / pressure

### 3.1 Per-stream large buffers, no pooling

Files: `brook-quicserver.go/brook_stream.go:236-241`, `brook_stream.go:274-277`:

```go
maxPayload := 2014 // TCP, 65473 UDP
rawBuf := make([]byte, maxPayload)
frameBuf := make([]byte, 2+16+maxPayload+16)
payloadChunk := make([]byte, 65536)
```

~130KB per encrypted stream. 1000 concurrent streams ~130MB churn, GC pressure. `Seal(frameBuf[:0],...)` reuse is correct, no overlap bug.

Fix: `sync.Pool` for `rawBuf/frameBuf/payloadChunk`; use 16KB for TCP, 64KB only for UDP.

### 3.2 UDP buffers never actually raised

File: `brook-quicserver.go/limits.go:11-29`, `brook-quicserver.go/server.go:149-153`.

`RaiseLimits()` runs `sysctl net.core.rmem_max` but `net.ListenUDP` socket keeps OS defaults (often 212KB). Must also `SetsockoptInt(SO_RCVBUF/SO_SNDBUF, 2.5MB)` on the bound socket.

### 3.3 Log contention in hot path

Files: `brook-quicserver.go/quic.go:41,61`, `brook-quicserver.go/server.go:187-188`, `brook-quicserver.go/webtransport.go:48,54`.

`log.Printf` per connection/stream serializes on global logger mutex. Gate behind verbose level / sample.

---

## 4. JS client — async races (single-threaded, no true data-race)

### 4.1 `processRxQueue` lost wakeup

File: `brook-quicclient/src/core/brook-tunnel.js:238-417`.

```js
if (isProcessingRx || isTerminated) return;
isProcessingRx = true;
try { while(rxQueue.length>0) {...} } finally { isProcessingRx=false; }
```

`onData` at `brook-tunnel.js:422-441` calls `processRxQueue()` fire-and-forget. Push between loop-empty check and `finally` clearing the flag calls `processRxQueue`, sees `isProcessingRx==true`, returns early; outer loop already exited -> item stuck until next packet.

Fix: in `finally`, clear flag then `if (rxQueue.length) queueMicrotask(processRxQueue)`.

### 4.2 Single pending-read slot overwrite

File: `brook-quicclient/src/workers/worker-tunnel-bridge.js:48-57`.

`pendingReadResolve` is a single variable. Two concurrent `read()` calls overwrite, first promise never resolves -> hung upstream loop.

Fix: queue of resolvers.

### 4.3 Unbounded pending queues, no backpressure

* `brook-quicclient/src/webtransport/wt-stream-adapter.js:16,29-36` — `_pendingChunks` grows if `registerStream` delayed.
* `brook-quicclient/src/workers/worker-tunnel-bridge.js:7` — `readQueue` unbounded.
* `brook-quicclient/src/server/proxy-dispatcher.js:193-214` — `Promise.race(read,timeout)` leaves pending `read` holding reader lock on timeout path.

Fix: bound queues (e.g. 4MB), propagate `STOP_SENDING` / `STREAM_CANCEL`, use `AbortSignal` timeout.

### 4.4 `stop()` never waits, `dropAllConnections` incomplete

Files: `brook-quicclient/src/server/proxy-dispatcher.js:140-149,381-397`, `brook-quicclient/src/server/session-tracker.js:89-98`.

`activeHandlers` holds `{socket,cancel}`, `stop()` does `Promise.allSettled(Array.from(activeHandlers))` on non-promises -> resolves immediately, restart races old tunnels. `dropAllConnections` only closes `acceptedSocket`, not `reader/writer/quicSession`.

Fix: store handler promises in `activeHandlers`, `cancel()` must cancel reader/writer + close `quicSession`.

---

## 5. JS client — stalls / memory

* No lock deadlock. Worst stall is `brook-tunnel.js:565-567 await completionPromise` after client FIN: holds tunnel until `idleTimer` 10-15s (`brook-tunnel.js:135-149,399-402`). Expected, but accounts for lingering resources.
* `brook-tunnel.js:252-263,370-373` — `rxBuffer = subarray(); new Uint8Array(len+len).set()` is O(n²) per fragment and `subarray` retains the large backing store. Use chunk list or `slice()` copy of remainder only.
* `brook-tunnel.js:125` — `MAX_RX_BUFFER_BYTES=256MB` per tunnel, `globalMetrics` has no global cap. 100 tunnels can OOM. Reduce per-tunnel to 4-16MB and rely on QUIC flow control.
* `brook-quicclient/src/server/session-tracker.js:100-115` — `Array.from(sessions)` + snapshot every 500ms is O(n) per tick; fine at <1k sessions, paginate if larger.

---

## 6. Performance — what to change first

### Go (server)

1. Add probe-read deadline (`server.go:265`), half-close propagation + `Wait` timeout, default idle timeout 300s when `tcpTimeout==0`.
2. `sync.Pool` buffers; 16KB TCP / 32-64KB UDP instead of always 64KB.
3. `quic.Config{MaxIncomingStreams:256, MaxIncomingUniStreams:256, KeepAlivePeriod:15s}` + active-stream semaphore + `pprof`/metrics.
4. Set `SO_RCVBUF/SO_SNDBUF` on UDP socket; keep `RaiseLimits`.
5. Remove per-stream logs from hot path.

### JS (client) — ordered by impact

1. **Worker pool fan-out bug** — `brook-quicclient/src/workers/wt-session.worker.js:86-102` creates `new WebTransportConnectionManager` with default `poolSize=5` (`wt-connection-manager.js:32`) per proxy connection. One request = 5 QUIC handshakes. Pass `poolSize:1` in worker; keep pooled manager only on main thread.
2. **Chunk size** — `brook-tunnel.js:476,540` uses `16384`. Measured `crypto.subtle` throughput: 16KB ~19MB/s vs 64KB ~62MB/s vs 256KB ~109MB/s. Move upstream/`leftover` to 32-64KB. Each `sealFrame` (`brook-framing.js:104-126`) costs 2 `subtle.encrypt` calls; larger chunks halve call count.
3. **Connection storm** — `wt-connection-manager.js:270-289` connects all pool slots in parallel via `allSettled`. Lazy-connect 1, warm rest in background.
4. **Nonce + key setup** — `brook-crypto.js:14-26 nextNonce` uses `BigInt` per byte in hot path; replace with fast `DataView`/number LE inc (mirror `crypto.go:15`). `deriveKey` costs ~955µs (`sha256+importKey+deriveKey`); cache imported HKDF baseKey per password.
5. Reuse `BrookCipher` instance (already done via `resolveCipher` at `brook-framing.js:88-91` when passed a `BrookCipher`); never pass raw keys per frame.
6. Fix `rxBuffer` merge + `MessagePort` transfer: `worker-tunnel-bridge.js:73-78` already zero-copy when aligned; avoid `subarray` views that force the copy path — always send standalone buffers.

---

## 7. Suggested verification

```bash
cd brook-quicserver.go
go test -race -short ./...
go test -run 'TestConnectionCleanup|TestProbeTimeout|TestManyConnections' -v
# add: concurrent half-close test with tcpTimeout=0, assert goroutines return to baseline
# add: bidi-open-no-data test, assert dispatchConnection exits within 5s
```

```js
// add: back-to-back processRxQueue stress (100x 1KB pushes with no await)
// add: double-read on port bridge, assert both resolve
// assert: wt-session.worker creates exactly 1 WT session per tunnel
```
