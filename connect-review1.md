# Connection Termination Review 1 — `both_closed` / `idle_timeout` / fail-as-success

Scope: `brook-quicclient/src/core/brook-tunnel.js`, `brook-quicclient/src/server/proxy-dispatcher.js`, `brook-quicclient/src/workers/wt-session.worker.js`, `brook-quicclient/src/workers/worker-tunnel-bridge.js`, `brook-quicclient/src/workers/wt-worker-manager.js`, `brook-quicclient/src/webtransport/wt-stream-adapter.js`.

## 1. Bugs around `both_closed` and `idle_timeout`

### 1.1 `transport_closed` checked but never emitted
- `brook-tunnel.js:579-584` classifies `transport_closed && totalBytesRecv > 0` as success.
- `proxy-dispatcher.js:372,379` string-matches `transport_closed`.
- No `cleanup('transport_closed')` call exists. Removed in `134dc7f`; `onClose` now does `checkFullClose() + resetIdleTimer(10000)`.
- `scripts/run-all-tests.js:274-286` duplicates the dead branch.
- Result: dead code, misleading tests/logs.

### 1.2 `onClose` conflated with orderly FIN → false `both_closed`
- `brook-tunnel.js:445-452` sets `serverRxClosed = true` on any transport abort.
- `wt-stream-adapter.js:130-140` calls only `onClose()` on abortive close (no FIN data), vs `89-97` which sends `onData(empty,true) + onClose()` on clean EOF.
- Tunnel cannot distinguish. Later client `done` at `519-528` + `232-236` yields `cleanup('both_closed')`.
- Result: network death + user closes tab = logged as clean close.

### 1.3 `onClose` defers teardown to `idle_timeout`
- If `!clientReadClosed` and queue empty, only `resetIdleTimer(10000)` (`450`), client-FIN case `531:15000`.
- Old behavior was immediate `cleanup('transport_closed')` with 2s drain.
- Result: 10-15s resource hold, `activeTunnels` inflated, slow offline/WiFi failover, kind mislabeled as `idle_timeout` (`145`).

### 1.4 Dispatcher quiet-branch unreachable
- `proxy-dispatcher.js:372`: `idle_timeout && session.bytesReceived > 0` inside `if (tunnelError)`.
- Tunnel `584`: `idle_timeout + totalBytesRecv > 0 => success:true => tunnelError=null => break` at `340-342`, never reaches `369`.
- Only reachable via cross-attempt accumulation. `350` uses cumulative `session.bytesReceived`, while `wt-session.worker.js:155` correctly uses per-attempt `outcome.bytesReceived`.
- Current deadness is accidentally safe: failed `0B` speculative expiry takes `375:throw` → `383-385` socket cleanup with log suppressed by `379`. Quiet path would skip `acceptedSocket.close()`.

### 1.5 Bounded half-close extendable
- `425-427` / `542` unconditional `resetIdleTimer()` (30s active) overwrites bounded `401:10000` / `531:15000` on further data.
- Correct while streaming large downloads, but trickle keeps idle bulk connections alive past bound.

## 2. Practical impact

1. **10s hang on transport death:** browser spinner stalls, pool slots held, delayed retry. User-visible on server restart, QUIC idle kill, WiFi switch.
2. **Truncated download reported as success:** death mid-transfer has `totalBytesRecv > 0`, so `idle_timeout => success:true`. Dispatcher breaks as success, `clientWriter.close()` signals clean EOF. No retry (`proxyReplied` true), no error. Partial file looks complete.
3. **Inflated success / wrong reason:** everything becomes `idle_timeout` or false `both_closed`, never `transport_closed`. Hard to diagnose network issues.
4. **No socket leak today, but fragile:** throw-path cleanup is correct only because quiet-branch is dead. Fixing the branch naively would leak `acceptedSocket`.
5. **Retry still works for pre-connect:** `handshake_timeout` / `target_dial_refused` with `0B`, `proxyReplied==false`, `clientDataConsumed==false` still retries 3x. Post-handshake never retries by design (stream already consumed, headers already sent).

## 3. Other fail-as-success

### 3.1 `both_closed` with `0B` via `onClose`
- `onData(fin)` path `390-395` guards `0B → target_dial_refused/failure`.
- `onClose` path `445-448` has no guard. Immediate post-handshake transport death + client close = `both_closed/success` with nothing transferred.

### 3.2 `normal` always success
- `brook-tunnel.js:106,580`: initial `terminationReason='normal'`, counted as success.
- Never explicitly emitted; fallback is `576:loop_exit/failure`. Unreachable today, but any forgotten path defaults to success. Default should be failure.

### 3.3 `client_read_error + bytes > 0 => success` (`514,583`)
- Asymmetric with `client_write_error` (`362`), `upstream_write_failed` (`561`), `decrypt_error` (`319`), all failure with bytes.
- Browser abort mid-upload after partial download counted success. Masks client aborts in metrics.
- `client_abort + bytes > 0` (`582`) is unsatisfiable (`client_abort` implies `!serverHandshakeDone` per `514,522`, hence `bytes==0`), dead but wrong intent.

### 3.4 `idle_timeout` with partial frame
- Fires even if `expectedPayloadLen != -1` / `rxBuffer` holds incomplete frame (`307-367`). Partial discarded, still `success`. No FIN / framing-completeness check.

### 3.5 `CLIENT_ABORT == FIN` in bridge
- `worker-tunnel-bridge.js:60-66` (`CLIENT_ABORT`) resolves `read()->{done:true}` identically to `50-59` (`CLIENT_FIN`).
- Tunnel `519-533` treats explicit abort as clean `clientReadClosed`, leading to `both_closed` / `idle_timeout` success, never `client_abort` failure.

### 3.6 Silent reaper / flush
- `wt-worker-manager.js:31-42` reaps stalled workers after 30s inactivity, `67-80` flushes on offline, only `sessionTracker.closeSession()`, no failure outcome. Stalls disappear from success-rate denominator.

### 3.7 Early `sendSuccess`
- `brook-tunnel.js:282-288` sends SOCKS/HTTP `200 OK` on server nonce, before payload. Later `decrypt_error`/truncation cannot be revoked to browser. Backend `success:false` but browser sees truncated success. Inherent after headers-sent; metrics should stay failure (true today except for `idle_timeout` case above).

## 4. Suggested fixes

1. Split `serverFin` vs `transportDead`; restore prompt `cleanup('transport_closed')` when queue drained, keep bounded wait only when data still in flight.
2. Guard `both_closed`: require `serverHandshakeDone`, `totalBytesRecv > 0` or explicit FIN flag (not `onClose`), and no pending partial frame.
3. Default `terminationReason='unknown'` (failure); explicitly whitelist clean FIN.
4. Make `client_read_error + bytes` failure for consistency, or document accounting vs transport success separately.
5. Make `CLIENT_ABORT` reject `read()` (throw) so tunnel records `client_abort`, not `done`.
6. Use per-attempt `outcome.bytesReceived` in dispatcher retry guard (match worker), check `outcome.kind` not `message.includes()`.
7. Record reaper/flush terminations as explicit failure outcomes.

## 5. Server side — same effect, different mechanism

Scope: `brook-quicserver.go/brook_stream.go`, `server.go`, `quic.go`, `webtransport.go`, `main.go`.

### 5.1 No `success` bool, but `return nil` = success
- `brook_stream.go:380-387,512-518` relay always `return nil` after `wg.Wait()`, regardless of which leg failed, `0B` vs `1GB`, decrypt-auth fail (`341-343,359-362:return`), `remote.Write` fail, truncated `ReadFull`.
- Caller `quic.go:53-56`, `webtransport.go:87-90` only logs if `err != nil && !isNormalStreamClose()`.
- Mid-stream failure → `nil` → silent normal. Direct analog of client `idle_timeout+bytes => success`.

### 5.2 `isNormalStreamClose` too broad
- `server.go:30-42`: substring match `closed/cancel/done/EOF/Application error 0x0/no recent network activity` suppresses log.
- E.g. `read client nonce failed: EOF`, `read header length failed: EOF` (auth/truncation) hide as normal.

### 5.3 FIN vs abort conflated
- `brook_stream.go:347-350`: `l==0 → continue` (no FIN accounting); any `ReadFull` error (`337-339,355-357`) → bare `return`.
- Clean half-close and reset look identical. No `both_closed` tracking at all.

### 5.4 Timeout mismatch holds server resources
- Server `effectiveTimeout=300s` (`brook_stream.go:249-252,448-451`, `main.go:20:tcp-timeout 300`) vs client `30s/15s/10s`.
- Client `idle_timeout` closes QUIC stream; server `client.Read` then errors, `241-247,456-462:unblockOther(5s)` + `382,514:10s` fallback cleans `remote`. Works, but vanished client without FIN holds `remote` + 2 goroutines up to `timeout+10s` (~310s). Client holds 10s, server holds 5min.
- Server does have the prompt teardown the client lacks (`unblockOther` + 10s `remote.Close/client.Close` fallback); client should mirror it instead of only re-arming idle timer.
