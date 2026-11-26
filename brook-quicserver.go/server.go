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
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unsafe"

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

	readyOnce sync.Once
	ready     chan struct{}
	ctx       context.Context
	cancel    context.CancelFunc

	mu           sync.RWMutex
	closed       bool
	packetConn   net.PacketConn
	tcpListener  net.Listener
	listener     *quic.EarlyListener
	transport    *quic.Transport
	wtServer     *webtransport.Server
	wsHTTPServer *http.Server
	httpServer   *http.Server

	streamSem chan struct{}
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

	effectiveTimeout := s.TCPTimeout
	if effectiveTimeout <= 0 {
		effectiveTimeout = 300
	}
	if s.UDPTimeout > effectiveTimeout {
		effectiveTimeout = s.UDPTimeout
	}
	maxIdleTimeout := time.Duration(effectiveTimeout) * time.Second

	quicConfig := &quic.Config{
		EnableDatagrams:                  true,
		EnableStreamResetPartialDelivery: true, // Required by webtransport-go v0.13
		InitialPacketSize:                1200, // Safe MTU avoiding PPPoE/cellular handshake fragmentation
		MaxIdleTimeout:                   maxIdleTimeout,
		KeepAlivePeriod:                  0,
		HandshakeIdleTimeout:             10 * time.Second,
		Allow0RTT:                        true,
		MaxIncomingStreams:               1024,
		MaxIncomingUniStreams:            1024,
		InitialStreamReceiveWindow:       4 * 1024 * 1024,
		MaxStreamReceiveWindow:           16 * 1024 * 1024,
		InitialConnectionReceiveWindow:   8 * 1024 * 1024,
		MaxConnectionReceiveWindow:       32 * 1024 * 1024,
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

	// Start HTTPS + WebSocket fallback server (/brook-ws) on the exact same TCP port as UDP
	wsHandler := NewWebSocketHandler(s.Password, s.WithoutBrook, s.TCPTimeout, s.UDPTimeout, maxIdleTimeout, s.streamSem)
	wsMux := http.NewServeMux()
	wsMux.HandleFunc("/brook-ws", wsHandler.HandleUpgrade)
	wsMux.HandleFunc("/ws", wsHandler.HandleUpgrade)
	wsPort := 4433
	if uaddr, ok := conn.LocalAddr().(*net.UDPAddr); ok && uaddr.Port > 0 {
		wsPort = uaddr.Port
	}
	altSvcVal := fmt.Sprintf(`h3=":%d"; ma=86400`, wsPort)
	wsMux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Alt-Svc", altSvcVal)
		http.NotFound(w, r)
	})

	wsTLSConfig := tlsConfig.Clone()
	wsTLSConfig.NextProtos = []string{"http/1.1"}
	tcpLn, tcpErr := net.Listen("tcp", conn.LocalAddr().String())
	if tcpErr != nil {
		log.Printf("[Server] Warning: failed to bind TCP WebSocket fallback on %s: %v", conn.LocalAddr().String(), tcpErr)
	} else {
		tlsTCPListener := tls.NewListener(tcpLn, wsTLSConfig)
		wsSrv := &http.Server{
			Handler:           wsMux,
			ReadHeaderTimeout: 10 * time.Second,
		}
		s.mu.Lock()
		if s.closed {
			s.mu.Unlock()
			_ = tlsTCPListener.Close()
			return net.ErrClosed
		}
		s.tcpListener = tlsTCPListener
		s.wsHTTPServer = wsSrv
		s.mu.Unlock()

		go func() {
			if err := wsSrv.Serve(tlsTCPListener); err != nil && !errors.Is(err, http.ErrServerClosed) && !errors.Is(err, net.ErrClosed) {
				log.Printf("[WebSocket] HTTPS server exited: %v", err)
			}
		}()
	}

	// Signal that server is bound and ready (both UDP QUIC and TCP WebSocket listeners active)
	s.readyOnce.Do(func() {
		close(s.ready)
	})

	// Setup WebTransport / HTTP/3 server
	mux := http.NewServeMux()
	h3Server := &http3.Server{
		TLSConfig:       tlsConfig,
		QUICConfig:      quicConfig,
		Handler:         mux,
		EnableDatagrams: true,
		ConnContext: func(ctx context.Context, c *quic.Conn) context.Context {
			return context.WithValue(ctx, quicConnContextKey{}, c)
		},
	}
	webtransport.ConfigureHTTP3Server(h3Server)

	s.wtServer = &webtransport.Server{
		H3:                h3Server,
		ReorderingTimeout: 5 * time.Second,
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

	log.Printf("[Server] Unified Brook Server listening on %s (QUIC + WebTransport + WebSocket TCP)", conn.LocalAddr())
	log.Printf("[Server] Endpoints: quic://%s, https://%s/brook, wss://%s/brook-ws", conn.LocalAddr(), conn.LocalAddr(), conn.LocalAddr())

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

// dispatchConnection performs zero-copy ALPN routing between raw Brook QUIC and WebTransport/HTTP3.
func (s *Server) dispatchConnection(conn *quic.Conn) {
	alpn := conn.ConnectionState().TLS.NegotiatedProtocol

	switch alpn {
	case "brook-quic", "brook", "":
		HandleRawQUICConn(conn, s.Password, s.WithoutBrook, s.TCPTimeout, s.UDPTimeout, nil, s.streamSem)
		_ = conn.CloseWithError(0, "done")

	case "h3":
		if err := s.wtServer.ServeQUICConn(conn); err != nil && err != http.ErrServerClosed && !isNormalStreamClose(err) {
			log.Printf("[WebTransport] Session ended: %v", err)
		}
		_ = conn.CloseWithError(0, "done")

	default:
		log.Printf("[Server] Dropping connection from %s with unsupported ALPN: %q", conn.RemoteAddr(), alpn)
		_ = conn.CloseWithError(0x101, "unsupported ALPN")
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
			NextProtos:   []string{"brook-quic", "brook", "h3"},
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
			NextProtos:     []string{"brook-quic", "brook", "h3"},
		}, nil
	}

	// Case 3: Auto-generate self-signed certificate for local dev / testing
	cert, err := s.generateSelfSignedCert()
	if err != nil {
		return nil, err
	}
	return &tls.Config{
		Certificates: []tls.Certificate{*cert},
		NextProtos:   []string{"brook-quic", "brook", "h3"},
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
	wsHTTPServer := s.wsHTTPServer
	tcpListener := s.tcpListener
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
	if wsHTTPServer != nil {
		_ = wsHTTPServer.Close()
	}
	if tcpListener != nil {
		_ = tcpListener.Close()
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

// ActiveWebTransportConns returns the count of active connections currently tracked in
// webtransport.Server's internal connection map.
func (s *Server) ActiveWebTransportConns() int {
	if s == nil || s.wtServer == nil {
		return 0
	}
	wtVal := reflect.ValueOf(s.wtServer)
	if wtVal.Kind() != reflect.Ptr || wtVal.IsNil() {
		return 0
	}
	wtElem := wtVal.Elem()
	mxField := wtElem.FieldByName("connsMx")
	mapField := wtElem.FieldByName("conns")
	if !mxField.IsValid() || !mapField.IsValid() {
		return 0
	}

	mx := (*sync.Mutex)(unsafe.Pointer(mxField.UnsafeAddr()))
	mx.Lock()
	defer mx.Unlock()

	m := reflect.NewAt(mapField.Type(), unsafe.Pointer(mapField.UnsafeAddr())).Elem()
	if m.IsNil() {
		return 0
	}
	return m.Len()
}
