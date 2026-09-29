package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"log"
	"math/big"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/quic-go/quic-go"
	"github.com/quic-go/quic-go/http3"
	"github.com/quic-go/webtransport-go"
	"golang.org/x/crypto/acme/autocert"
)

func isNormalStreamClose(err error) bool {
	if err == nil {
		return true
	}
	if errors.Is(err, io.EOF) || errors.Is(err, net.ErrClosed) || errors.Is(err, context.Canceled) || errors.Is(err, io.ErrClosedPipe) {
		return true
	}
	if errors.Is(err, os.ErrDeadlineExceeded) {
		return true
	}
	var nerr net.Error
	if errors.As(err, &nerr) && nerr.Timeout() {
		return true
	}
	var se *quic.StreamError
	if errors.As(err, &se) && (se.ErrorCode == 0 || se.ErrorCode == 0x100) {
		return true
	}
	var wse *webtransport.StreamError
	if errors.As(err, &wse) {
		// Any WebTransport stream cancel (including code 0, which maps to
		// HTTP code 91141958510811 on the wire) is client-initiated.
		return true
	}
	var ae *quic.ApplicationError
	if errors.As(err, &ae) && (ae.ErrorCode == 0 || ae.ErrorCode == 0x100) {
		return true
	}
	var idleErr *quic.IdleTimeoutError
	if errors.As(err, &idleErr) {
		return true
	}
	s := err.Error()
	return strings.Contains(s, "Application error 0x0") ||
		strings.Contains(s, "no recent network activity") ||
		strings.Contains(s, "use of closed network connection") ||
		strings.Contains(s, "deadline exceeded") ||
		strings.Contains(s, "i/o timeout") ||
		strings.Contains(s, "stream canceled with error code") ||
		strings.Contains(s, "canceled by remote with error code") ||
		strings.Contains(s, "failed to convert stream error") ||
		strings.Contains(s, "error code outside of expected range")
}

// streamRejectLogCount counts global stream-semaphore rejections for observability.
var streamRejectLogCount atomic.Uint64

// takeStreamSlot tries to admit one stream under the global concurrency limit.
// It logs every rejection with a running total so overload is visible instead
// of surfacing as mysterious client-side stream failures.
func takeStreamSlot(sem chan struct{}, remote net.Addr, kind string) bool {
	if sem == nil {
		return true
	}
	select {
	case sem <- struct{}{}:
		return true
	default:
		n := streamRejectLogCount.Add(1)
		log.Printf("[Server] stream concurrency limit reached, rejecting %s stream from %s (total rejects=%d)", kind, remote, n)
		return false
	}
}

type bufferedStream struct {
	quic.Stream
	r io.Reader
}

func (b *bufferedStream) Read(p []byte) (int, error) {
	return b.r.Read(p)
}

func newBufferedStream(s quic.Stream, prefix []byte) quic.Stream {
	if len(prefix) == 0 {
		return s
	}
	return &bufferedStream{
		Stream: s,
		r:      io.MultiReader(bytes.NewReader(prefix), s),
	}
}

type interceptedConn struct {
	quic.EarlyConnection
	mu          sync.Mutex
	uniStreams  []quic.ReceiveStream
	bidiStreams []quic.Stream
}

func (c *interceptedConn) AcceptUniStream(ctx context.Context) (quic.ReceiveStream, error) {
	c.mu.Lock()
	if len(c.uniStreams) > 0 {
		s := c.uniStreams[0]
		c.uniStreams = c.uniStreams[1:]
		c.mu.Unlock()
		return s, nil
	}
	c.mu.Unlock()
	return c.EarlyConnection.AcceptUniStream(ctx)
}

func (c *interceptedConn) AcceptStream(ctx context.Context) (quic.Stream, error) {
	c.mu.Lock()
	if len(c.bidiStreams) > 0 {
		s := c.bidiStreams[0]
		c.bidiStreams = c.bidiStreams[1:]
		c.mu.Unlock()
		return s, nil
	}
	c.mu.Unlock()
	return c.EarlyConnection.AcceptStream(ctx)
}

// acceptBidiWithContext accepts one bidirectional stream but gives up when ctx
// expires. The helper goroutine always terminates (AcceptStream unblocks on ctx
// cancel) and reports through a buffered channel, so no goroutine is leaked.
func acceptBidiWithContext(conn quic.EarlyConnection, ctx context.Context) (quic.Stream, error) {
	type res struct {
		s quic.Stream
		e error
	}
	ch := make(chan res, 1)
	go func() {
		s, e := conn.AcceptStream(ctx)
		ch <- res{s, e}
	}()
	select {
	case r := <-ch:
		return r.s, r.e
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

// controlStreamWait is how long a bidi-first connection with an H3-magic prefix
// waits for the mandatory HTTP/3 control (uni) stream before concluding it is a
// raw Brook client whose random nonce collided with H3 framing (~0.78%).
// 800ms covers CN->US RTTs while keeping misclassified raw streams fast.
const controlStreamWait = 800 * time.Millisecond

// classifyBidiFirst distinguishes WebTransport/H3 from raw Brook on connections
// whose first stream is bidirectional. The uni probe must stay alive (probeCtx
// not canceled) while this runs so a late control stream can still be observed.
// It returns the buffered first stream, harvested control streams, whether the
// connection is WebTransport, and whether classification succeeded.
// A single idle/corrupt stream never fails the connection: it is closed and the
// next bidi stream is tried within the remaining probe budget.
func classifyBidiFirst(conn quic.EarlyConnection, first quic.Stream, uniChan <-chan quic.ReceiveStream, probeCtx context.Context) (quic.Stream, []quic.ReceiveStream, bool, bool) {
	var harvested []quic.ReceiveStream
	drainUni := func() {
		for {
			select {
			case u, ok := <-uniChan:
				if ok && u != nil {
					harvested = append(harvested, u)
				}
			default:
				return
			}
		}
	}
	bstr := first
	for {
		// Bound each peek with a 3-second read deadline to prevent
		// DoS/goroutine leak from idle clients.
		_ = bstr.SetReadDeadline(time.Now().Add(3 * time.Second))
		buf := make([]byte, 2)
		n, err := io.ReadAtLeast(bstr, buf, 1)
		_ = bstr.SetReadDeadline(time.Time{})
		if err != nil {
			// Close only the offending stream; healthy multiplexed streams
			// on the same connection must not be doomed by one bad stream.
			_ = bstr.Close()
			drainUni()
			select {
			case <-probeCtx.Done():
				return nil, harvested, false, false
			default:
			}
			next, aerr := acceptBidiWithContext(conn, probeCtx)
			if aerr != nil {
				return nil, harvested, false, false
			}
			bstr = next
			continue
		}
		drainUni()
		if len(harvested) > 0 {
			// A unidirectional stream (HTTP/3 control stream) is present.
			// Raw Brook never opens uni streams: this is WebTransport.
			return newBufferedStream(bstr, buf[:n]), harvested, true, true
		}
		if buf[0] == 0x01 || buf[0] == 0x41 || (buf[0] == 0x40 && n >= 2 && buf[1] == 0x41) {
			// Possible H3 framing: wait for the mandatory control stream.
			waitCtx, waitCancel := context.WithTimeout(probeCtx, controlStreamWait)
			select {
			case u, ok := <-uniChan:
				if ok && u != nil {
					harvested = append(harvested, u)
				}
			case <-waitCtx.Done():
			}
			waitCancel()
			drainUni()
			if len(harvested) > 0 {
				return newBufferedStream(bstr, buf[:n]), harvested, true, true
			}
			// No control stream arrived: raw Brook nonce collided with H3
			// magic. Classify as raw (no magic fallback — the fallback
			// misclassified ~0.4% of raw connections as WT, stalling them).
			log.Printf("[Server] bidi-first from %s has H3-magic prefix 0x%02x but no control stream after %v: treating as raw Brook", conn.RemoteAddr(), buf[0], controlStreamWait)
			return newBufferedStream(bstr, buf[:n]), harvested, false, true
		}
		return newBufferedStream(bstr, buf[:n]), harvested, false, true
	}
}

// Server is the unified Brook QUIC and WebTransport Server.
type Server struct {
	Addr         string
	Domain       string
	Password     []byte
	WithoutBrook bool
	TCPTimeout   int
	UDPTimeout   int
	Cert         []byte
	CertKey      []byte

	readyOnce  sync.Once
	ready      chan struct{}
	ctx        context.Context
	cancel     context.CancelFunc

	mu         sync.RWMutex
	closed     bool
	packetConn net.PacketConn
	listener   *quic.EarlyListener
	transport  *quic.Transport
	wtServer   *webtransport.Server
	httpServer *http.Server

	streamSem  chan struct{}
}

// NewServer creates a new unified Brook QUIC + WebTransport server.
func NewServer(addr, password, domain string, tcpTimeout, udpTimeout int, withoutBrook bool) (*Server, error) {
	ctx, cancel := context.WithCancel(context.Background())

	return &Server{
		Addr:         addr,
		Domain:       domain,
		Password:     []byte(password),
		WithoutBrook: withoutBrook,
		TCPTimeout:   tcpTimeout,
		UDPTimeout:   udpTimeout,
		ready:        make(chan struct{}),
		ctx:          ctx,
		cancel:       cancel,
		streamSem:    make(chan struct{}, 2048),
	}, nil
}

// Ready returns a channel that is closed when the server is bound and listening.
func (s *Server) Ready() <-chan struct{} {
	return s.ready
}

// LocalAddr returns the local listening address.
func (s *Server) LocalAddr() net.Addr {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.packetConn != nil {
		return s.packetConn.LocalAddr()
	}
	return nil
}

// ListenAndServe starts the unified QUIC + WebTransport server on Addr.
func (s *Server) ListenAndServe() error {
	tlsConfig, err := s.setupTLS()
	if err != nil {
		return fmt.Errorf("setup TLS failed: %w", err)
	}

	maxIdleTimeout := time.Duration(s.UDPTimeout) * time.Second
	if maxIdleTimeout <= 0 {
		maxIdleTimeout = 60 * time.Second
	}

	quicConfig := &quic.Config{
		EnableDatagrams:                true,
		MaxIdleTimeout:                 maxIdleTimeout,
		KeepAlivePeriod:                15 * time.Second,
		HandshakeIdleTimeout:           10 * time.Second,
		Allow0RTT:                      true,
		MaxIncomingStreams:             1024,
		MaxIncomingUniStreams:          1024,
		InitialStreamReceiveWindow:     4 * 1024 * 1024,
		MaxStreamReceiveWindow:         16 * 1024 * 1024,
		InitialConnectionReceiveWindow: 8 * 1024 * 1024,
		MaxConnectionReceiveWindow:     32 * 1024 * 1024,
	}

	// Resolve UDP address
	udpAddr, err := net.ResolveUDPAddr("udp", s.cleanAddr(s.Addr))
	if err != nil {
		return fmt.Errorf("resolve UDP addr %s failed: %w", s.Addr, err)
	}

	conn, err := net.ListenUDP("udp", udpAddr)
	if err != nil {
		return fmt.Errorf("listen UDP on %s failed: %w", udpAddr, err)
	}
	_ = conn.SetReadBuffer(2500000)
	_ = conn.SetWriteBuffer(2500000)

	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		_ = conn.Close()
		return net.ErrClosed
	}
	s.packetConn = conn
	s.mu.Unlock()

	tr := &quic.Transport{Conn: conn}
	ln, err := tr.ListenEarly(tlsConfig, quicConfig)
	if err != nil {
		return fmt.Errorf("quic listen failed: %w", err)
	}

	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		_ = ln.Close()
		_ = tr.Close()
		return net.ErrClosed
	}
	s.listener = ln
	s.transport = tr
	s.mu.Unlock()

	// Signal that server is bound and ready
	s.readyOnce.Do(func() {
		close(s.ready)
	})

	// Setup WebTransport / HTTP/3 server
	mux := http.NewServeMux()
	s.wtServer = &webtransport.Server{
		H3: http3.Server{
			TLSConfig:  tlsConfig,
			QUICConfig: quicConfig,
			Handler:    mux,
		},
		CheckOrigin: func(r *http.Request) bool {
			// Allow all origins for proxy tunneling
			return true
		},
	}

	wtHandler := NewWebTransportHandler(s.wtServer, s.Password, s.WithoutBrook, s.TCPTimeout, s.UDPTimeout, s.streamSem)

	// Register WebTransport endpoints on common paths
	mux.HandleFunc("/", wtHandler.HandleUpgrade)
	mux.HandleFunc("/brook", wtHandler.HandleUpgrade)
	mux.HandleFunc("/ws", wtHandler.HandleUpgrade)
	mux.HandleFunc("/webtransport", wtHandler.HandleUpgrade)

	log.Printf("[Server] Unified Brook Server listening on %s (QUIC + WebTransport)", conn.LocalAddr())
	log.Printf("[Server] Endpoints: quic://%s and https://%s/brook", conn.LocalAddr(), conn.LocalAddr())

	// Connection Accept & Demultiplex Loop
	for {
		qconn, err := ln.Accept(s.ctx)
		if err != nil {
			s.mu.Lock()
			closed := s.closed
			s.mu.Unlock()
			if s.ctx.Err() != nil || closed {
				return nil
			}
			log.Printf("[Server] Accept error (retrying): %v", err)
			time.Sleep(10 * time.Millisecond)
			continue
		}

		go s.dispatchConnection(qconn)
	}
}

func (s *Server) dispatchConnection(conn quic.EarlyConnection) {
	alpn := conn.ConnectionState().TLS.NegotiatedProtocol

	// 1. Direct ALPN match
	if alpn == "brook-quic" || alpn == "brook" {
		HandleRawQUICConn(conn, s.Password, s.WithoutBrook, s.TCPTimeout, s.UDPTimeout, nil, s.streamSem)
		conn.CloseWithError(0, "done")
		return
	}

	// 2. Multiplexed ALPN "h3" (used by both WebTransport and legacy Brook QUIC clients)
	uniChan := make(chan quic.ReceiveStream, 1)
	bidiChan := make(chan quic.Stream, 1)

	probeCtx, cancel := context.WithTimeout(s.ctx, 10*time.Second)
	defer cancel()

	go func() {
		ustr, err := conn.AcceptUniStream(probeCtx)
		if err == nil {
			uniChan <- ustr
		}
	}()

	go func() {
		bstr, err := conn.AcceptStream(probeCtx)
		if err == nil {
			bidiChan <- bstr
		}
	}()

	select {
	case ustr := <-uniChan:
		// Cancel probeCtx immediately to stop the losing probe goroutine
		// before ServeQUICConn tries to accept streams on the same connection.
		cancel()
		// Client opened a unidirectional stream (HTTP/3 Control Stream). This is WebTransport!
		// Safely drain any orphaned bidi stream from the losing probe goroutine with a 200ms grace window.
		go func() {
			select {
			case orphan, ok := <-bidiChan:
				if ok && orphan != nil {
					_ = orphan.Close()
				}
			case <-time.After(200 * time.Millisecond):
			}
		}()
		iconn := &interceptedConn{
			EarlyConnection: conn,
			uniStreams:      []quic.ReceiveStream{ustr},
		}
		// ServeQUICConn manages the connection lifecycle; do not close conn here.
		if err := s.wtServer.ServeQUICConn(iconn); err != nil && err != http.ErrServerClosed && !isNormalStreamClose(err) {
			log.Printf("[WebTransport] Session ended: %v", err)
		}

	case bstr := <-bidiChan:
		// NOTE: probeCtx stays alive during classification so the uni probe
		// can still deliver a late HTTP/3 control stream. It is canceled
		// right after the routing decision, before ServeQUICConn or the raw
		// handler takes over the connection.
		sStream, harvestedUni, isWT, ok := classifyBidiFirst(conn, bstr, uniChan, probeCtx)
		// Cancel probeCtx now to stop the losing probe goroutine before
		// handlers try to accept streams on the same connection.
		cancel()
		if !ok {
			log.Printf("[Server] bidi-first from %s yielded no usable stream before probe expiry: closing connection", conn.RemoteAddr())
			conn.CloseWithError(0, "probe timeout")
			return
		}

		if isWT {
			// HTTP/3 HEADERS frame (0x01) or WebTransport stream frame (0x41)
			// Pass any harvested uni control streams to iconn so ServeQUICConn does not stall.
			iconn := &interceptedConn{
				EarlyConnection: conn,
				bidiStreams:     []quic.Stream{sStream},
				uniStreams:      harvestedUni,
			}
			// ServeQUICConn manages the connection lifecycle; do not close conn here.
			if err := s.wtServer.ServeQUICConn(iconn); err != nil && err != http.ErrServerClosed && !isNormalStreamClose(err) {
				log.Printf("[WebTransport] Session ended: %v", err)
			}
		} else {
			// Raw Brook QUIC stream (starts with 12-byte random client nonce)
			// Drain any orphaned uni stream with a 200ms grace window to prevent leaks.
			go func() {
				select {
				case orphan, ok := <-uniChan:
					if ok && orphan != nil {
						orphan.CancelRead(0)
					}
				case <-time.After(200 * time.Millisecond):
				}
			}()
			HandleRawQUICConn(conn, s.Password, s.WithoutBrook, s.TCPTimeout, s.UDPTimeout, sStream, s.streamSem)
			conn.CloseWithError(0, "done")
		}

	case <-probeCtx.Done():
		// Timeout waiting for first stream (slowloris protection).
		log.Printf("[Server] probe timeout, closing connection from %s (no streams in 10s)", conn.RemoteAddr())
		conn.CloseWithError(0, "probe timeout")
	}
}

func (s *Server) setupTLS() (*tls.Config, error) {
	// Case 1: Custom certificate provided
	if len(s.Cert) > 0 && len(s.CertKey) > 0 {
		cert, err := tls.X509KeyPair(s.Cert, s.CertKey)
		if err != nil {
			return nil, err
		}
		return &tls.Config{
			Certificates: []tls.Certificate{cert},
			ServerName:   s.Domain,
			NextProtos:   []string{"h3", "brook-quic", "brook"},
		}, nil
	}

	// Case 2: Autocert with domain
	if s.Domain != "" && os.Getenv("NO_AUTOCERT") == "" {
		m := autocert.Manager{
			Cache:      autocert.DirCache(".letsencrypt"),
			Prompt:     autocert.AcceptTOS,
			HostPolicy: autocert.HostWhitelist(s.Domain),
			Email:      "admin@" + s.Domain,
		}

		httpPort := os.Getenv("PORT")
		if httpPort == "" {
			httpPort = "80"
		}
		s.mu.Lock()
		if s.closed {
			s.mu.Unlock()
			return nil, net.ErrClosed
		}
		s.httpServer = &http.Server{
			Addr:    ":" + httpPort,
			Handler: m.HTTPHandler(nil),
		}
		srv := s.httpServer
		s.mu.Unlock()
		go func() {
			_ = srv.ListenAndServe()
		}()

		return &tls.Config{
			GetCertificate: m.GetCertificate,
			ServerName:     s.Domain,
			NextProtos:     []string{"h3", "brook-quic", "brook"},
		}, nil
	}

	// Case 3: Auto-generate self-signed certificate for local dev / testing
	cert, err := s.generateSelfSignedCert()
	if err != nil {
		return nil, err
	}
	return &tls.Config{
		Certificates: []tls.Certificate{*cert},
		NextProtos:   []string{"h3", "brook-quic", "brook"},
	}, nil
}

func (s *Server) generateSelfSignedCert() (*tls.Certificate, error) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return nil, err
	}
	template := x509.Certificate{
		SerialNumber: big.NewInt(time.Now().UnixNano()),
		Subject: pkix.Name{
			Organization: []string{"Brook QUIC & WebTransport"},
		},
		NotBefore:             time.Now().Add(-1 * time.Hour),
		NotAfter:              time.Now().Add(365 * 24 * time.Hour),
		KeyUsage:              x509.KeyUsageKeyEncipherment | x509.KeyUsageDigitalSignature,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
		IPAddresses:           []net.IP{net.ParseIP("127.0.0.1"), net.ParseIP("0.0.0.0"), net.ParseIP("::1")},
		DNSNames:              []string{"localhost", s.Domain},
	}
	derBytes, err := x509.CreateCertificate(rand.Reader, &template, &template, &key.PublicKey, key)
	if err != nil {
		return nil, err
	}
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: derBytes})
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)})
	cert, err := tls.X509KeyPair(certPEM, keyPEM)
	if err != nil {
		return nil, err
	}
	return &cert, nil
}

func (s *Server) cleanAddr(addr string) string {
	// Strip Fly.io prefixes like "fly-global-services:" if present locally
	if idx := bytes.Index([]byte(addr), []byte(":")); idx != -1 && !bytes.HasPrefix([]byte(addr), []byte(":")) {
		host := addr[:idx]
		if host == "fly-global-services" {
			return addr[idx:]
		}
	}
	if addr == "" {
		return ":4433"
	}
	if !bytes.Contains([]byte(addr), []byte(":")) {
		return ":" + addr
	}
	return addr
}

// Close stops the server and frees resources.
func (s *Server) Close() error {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return nil
	}
	s.closed = true
	httpServer := s.httpServer
	listener := s.listener
	transport := s.transport
	wtServer := s.wtServer
	packetConn := s.packetConn
	s.mu.Unlock()

	s.cancel()
	s.readyOnce.Do(func() {
		close(s.ready)
	})

	if httpServer != nil {
		_ = httpServer.Close()
	}
	if wtServer != nil {
		_ = wtServer.Close()
	}
	if listener != nil {
		_ = listener.Close()
	}
	if transport != nil {
		_ = transport.Close()
	}
	if packetConn != nil {
		_ = packetConn.Close()
	}
	return nil
}
