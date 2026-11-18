# Architectural Refactoring & Migration Plan: Upgrading `brook-quic` to `quic-go v0.64` & `webtransport-go v0.13`

**Target Components:**
* `github.com/quic-go/quic-go` (v0.47.0 ➔ **v0.64.1**)
* `github.com/quic-go/webtransport-go` (v0.8.0 ➔ **v0.13.0**)
* Target Source Tree: [`/root/downloads/iwa/brook-quicserver.go`](file:///root/downloads/iwa/brook-quicserver.go)

---

## 1. Executive Summary & Problem Analysis

In `quic-go` versions `v0.43`–`v0.47`, core connection and stream entities were defined as Go **interfaces**:
```go
type Connection interface { ... }
type EarlyConnection interface { ... }
type Stream interface { ... }
type ReceiveStream interface { ... }
```

In `quic-go v0.50+` through `v0.64.1`, upstream executed a major architectural refactoring:
1. **Concrete Structs:** `quic.Connection`, `quic.Stream`, and `quic.ReceiveStream` were converted into concrete structs (`*quic.Conn`, `*quic.Stream`, `*quic.ReceiveStream`).
2. **Unified Connections:** `quic.EarlyConnection` was removed. 0-RTT/Early connection capabilities are now built directly into `*quic.Conn`.
3. **Strict Downstream Requirements:** In `webtransport-go v0.13.0`, `s.wtServer.ServeQUICConn(conn)` expects a concrete pointer `*quic.Conn` rather than an interface.

### The Previous Architecture vs. The Failure Point

In the current codebase:
* [`server.go`](file:///root/downloads/iwa/brook-quicserver.go/server.go) demultiplexes **WebTransport** and **Raw Brook QUIC** on a single port (`4433`) by waiting for the first stream, inspecting the first few bytes, and wrapping the connection inside an `interceptedConn` struct with a `bufferedStream`.
* Under `quic-go v0.64`, Go's type system refuses to compile `interceptedConn` because `quic.Stream` and `quic.EarlyConnection` are no longer interfaces that can be embedded and mocked.

---

## 2. The New Architecture: ALPN-Based Zero-Copy Dispatch

Rather than intercepting streams and rewinding initial bytes, the refactored architecture relies on standard **TLS Application-Layer Protocol Negotiation (ALPN)**.

```mermaid
flowchart TD
    Client["Incoming QUIC Client on UDP :4433"] --> Handshake["TLS Handshake"]
    Handshake --> ALPN{"Check conn.ConnectionState().TLS.NegotiatedProtocol"}
    ALPN -->|"h3"| WT["WebTransport Server (s.wtServer.ServeQUICConn)"]
    ALPN -->|"brook-quic" / "brook"| Raw["Raw Brook Tunnel (HandleRawQUICConn)"]
    ALPN -->|Other / Unknown| Drop["CloseWithError(0x101, 'unsupported ALPN')"]

    WT --> IWA["Browser Isolated Web App (IWA)"]
    Raw --> CLI["Native Brook Client"]
```

### Why ALPN is 100% Reliable for WebTransport
* **Browser Enforcement:** According to the W3C WebTransport over HTTP/3 standard, every browser (`new WebTransport("https://...")`) **automatically and immutably advertises `ALPN: ["h3"]`**. Web browsers reject connections if `h3` is not negotiated.
* **Server Compatibility:** [`server.go`](file:///root/downloads/iwa/brook-quicserver.go/server.go) already advertises `NextProtos: []string{"h3", "brook-quic", "brook"}`.
* **Elimination of Hacks:** No stream byte sniffing, no `interceptedConn`, no `bufferedStream`, and no goroutine races on the initial stream.

---

## 3. File-by-File Implementation Plan

### File 1: [`server.go`](file:///root/downloads/iwa/brook-quicserver.go/server.go)

#### A. Remove Obsolete Wrapper Types
Delete lines 96–216:
* Remove `type bufferedStream struct { ... }` and `func newBufferedStream(...)`.
* Remove `type interceptedConn struct { ... }` and its methods (`AcceptUniStream`, `AcceptStream`, `CloseWithError`).

#### B. Update Listener & Connection Types
1. Replace `quic.EarlyListener` with `*quic.EarlyListener` or `*quic.Listener`:
   ```go
   type Server struct {
       listener   *quic.EarlyListener
       transport  *quic.Transport
       wtServer   *webtransport.Server
       ...
   }
   ```
2. Update `quic.Config` in `NewServer`:
   `webtransport-go v0.13.0` mandates explicit datagram and reset flags:
   ```go
   quicConfig := &quic.Config{
       EnableDatagrams:                  true,
       EnableStreamResetPartialDelivery: true, // Required by WebTransport v0.13
       MaxIdleTimeout:                   30 * time.Second,
       KeepAlivePeriod:                  15 * time.Second,
       Allow0RTT:                        true,
   }
   ```

#### C. Refactor `dispatchConnection`
Replace the complex multi-stream race detection (lines 507–625) with pure ALPN routing:
```go
func (s *Server) dispatchConnection(conn *quic.Conn) {
    defer func() {
        if r := recover(); r != nil {
            log.Printf("[PANIC] dispatchConnection: %v\n%s", r, debug.Stack())
        }
    }()

    negotiated := conn.ConnectionState().TLS.NegotiatedProtocol

    switch negotiated {
    case "h3":
        // Direct delegation to webtransport-go with native *quic.Conn
        go func() {
            defer s.cleanupWebTransportConn(conn)
            if err := s.wtServer.ServeQUICConn(conn); err != nil && !isNormalClose(err) {
                log.Printf("[WebTransport] ServeQUICConn error from %s: %v", conn.RemoteAddr(), err)
            }
        }()

    case "brook-quic", "brook", "":
        // Native Brook QUIC tunnel
        go HandleRawQUICConn(conn, s.password, s.withoutBrook, s.tcpTimeout, s.udpTimeout, nil, s.streamSem)

    default:
        log.Printf("[DISPATCH] Dropping connection from %s with unrecognized ALPN: %q", conn.RemoteAddr(), negotiated)
        _ = conn.CloseWithError(0x101, "unsupported ALPN")
    }
}
```

---

### File 2: [`quic.go`](file:///root/downloads/iwa/brook-quicserver.go/quic.go)

#### A. Update Struct Embedding
In `quic-go v0.64.1`, `Stream` is a struct, so embed `*quic.Stream`:
```go
// RawQUICStreamConn wraps a *quic.Stream as a net.Conn / StreamConn.
type RawQUICStreamConn struct {
    *quic.Stream
    localAddr  net.Addr
    remoteAddr net.Addr
}
```

#### B. Update Function Signatures
Update `HandleRawQUICConn` to accept `*quic.Conn`:
```go
func HandleRawQUICConn(
    conn *quic.Conn,
    password []byte,
    withoutBrook bool,
    tcpTimeout, udpTimeout int,
    firstStream *quic.Stream,
    streamSem chan struct{},
) {
    ...
}
```

#### C. Update Error Codes
Ensure `CancelRead` and `CancelWrite` cleanly use `quic.StreamErrorCode`:
```go
func (c *RawQUICStreamConn) CancelRead(code uint64) {
    c.Stream.CancelRead(quic.StreamErrorCode(code))
}

func (c *RawQUICStreamConn) CancelWrite(code uint64) {
    c.Stream.CancelWrite(quic.StreamErrorCode(code))
}
```

---

### File 3: [`webtransport.go`](file:///root/downloads/iwa/brook-quicserver.go/webtransport.go)

#### Update `WTStreamConn`
In `webtransport-go v0.13.0`, `webtransport.Stream` is also a concrete pointer:
```go
type WTStreamConn struct {
    *webtransport.Stream
    localAddr  net.Addr
    remoteAddr net.Addr
}

func (c *WTStreamConn) CancelRead(code uint64) {
    c.Stream.CancelRead(webtransport.StreamErrorCode(code))
}

func (c *WTStreamConn) CancelWrite(code uint64) {
    c.Stream.CancelWrite(webtransport.StreamErrorCode(code))
}
```

---

## 4. Execution & Verification Checklist

### Step 1: Prepare Feature Branch
```bash
cd /root/downloads/iwa/brook-quicserver.go
git checkout -b feature/quic-go-v0.64
```

### Step 2: Bump Dependencies in `go.mod`
```bash
go get github.com/quic-go/quic-go@v0.64.1
go get github.com/quic-go/webtransport-go@v0.13.0
go get github.com/quic-go/qpack@v0.6.0
go get golang.org/x/crypto@latest
go get golang.org/x/net@latest
go mod tidy
```

### Step 3: Apply Code Changes
Apply the modifications to:
1. [`quic.go`](file:///root/downloads/iwa/brook-quicserver.go/quic.go)
2. [`webtransport.go`](file:///root/downloads/iwa/brook-quicserver.go/webtransport.go)
3. [`server.go`](file:///root/downloads/iwa/brook-quicserver.go/server.go)

### Step 4: Run Test Suite
```bash
go test -v ./...
```
Ensure all ALPN discrimination tests, stream multiplexing benchmarks, and concurrent session tests pass.

### Step 5: Build & Run Vulnerability Audit
```bash
go build -trimpath -o /tmp/brook-quic-v64
govulncheck -mode=binary /tmp/brook-quic-v64
```
Verify that **all 20 previous QUIC/WebTransport vulnerabilities** (`GO-2026-5676`, `GO-2026-4485`, `GO-2024-3302`, etc.) report 0 active issues.

### Step 6: Deploy to Production
```bash
systemctl stop brook-quic.service
cp /tmp/brook-quic-v64 /root/brook-quic/brook-quic
systemctl start brook-quic.service
systemctl status brook-quic.service
```

---

## 5. Architectural Benefits Summary

1. **Zero-Overhead Dispatching:** Cuts out ~150 lines of complex buffer-peeking code and eliminates goroutine context switches on the initial stream.
2. **Standard-Compliant:** Directly adheres to RFC 9001 and W3C WebTransport protocol negotiation.
3. **Long-Term Maintainability:** Unlocks compatibility with all future `quic-go v0.64+` and `webtransport-go v0.13+` releases without maintenance bottlenecks.
