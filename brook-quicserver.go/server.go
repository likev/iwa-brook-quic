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
	"fmt"
	"io"
	"log"
	"math/big"
	"net"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/quic-go/quic-go"
	"github.com/quic-go/quic-go/http3"
	"github.com/quic-go/webtransport-go"
	"golang.org/x/crypto/acme/autocert"
)

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

	ready     chan struct{}
	ctx       context.Context
	cancel    context.CancelFunc
	packetConn net.PacketConn
	listener   *quic.EarlyListener
	wtServer   *webtransport.Server
	httpServer *http.Server
}

// NewServer creates a new unified Brook QUIC + WebTransport server.
func NewServer(addr, password, domain string, tcpTimeout, udpTimeout int, withoutBrook bool) (*Server, error) {
	RaiseLimits()

	var p []byte
	if !withoutBrook {
		p = []byte(password)
	} else {
		p = SHA256Bytes([]byte(password))
	}

	ctx, cancel := context.WithCancel(context.Background())

	return &Server{
		Addr:         addr,
		Domain:       domain,
		Password:     p,
		WithoutBrook: withoutBrook,
		TCPTimeout:   tcpTimeout,
		UDPTimeout:   udpTimeout,
		ready:        make(chan struct{}),
		ctx:          ctx,
		cancel:       cancel,
	}, nil
}

// Ready returns a channel that is closed when the server is bound and listening.
func (s *Server) Ready() <-chan struct{} {
	return s.ready
}

// LocalAddr returns the local listening address.
func (s *Server) LocalAddr() net.Addr {
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

	quicConfig := &quic.Config{
		EnableDatagrams: true,
		MaxIdleTimeout:  time.Duration(s.UDPTimeout) * time.Second,
		Allow0RTT:       true,
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
	s.packetConn = conn

	tr := &quic.Transport{Conn: conn}
	ln, err := tr.ListenEarly(tlsConfig, quicConfig)
	if err != nil {
		return fmt.Errorf("quic listen failed: %w", err)
	}
	s.listener = ln

	// Signal that server is bound and ready
	close(s.ready)

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

	wtHandler := NewWebTransportHandler(s.wtServer, s.Password, s.WithoutBrook, s.TCPTimeout, s.UDPTimeout)

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
			if s.ctx.Err() != nil {
				return nil
			}
			return err
		}

		go s.dispatchConnection(qconn)
	}
}

func (s *Server) dispatchConnection(conn quic.EarlyConnection) {
	alpn := conn.ConnectionState().TLS.NegotiatedProtocol

	// 1. Direct ALPN match
	if alpn == "brook-quic" || alpn == "brook" {
		HandleRawQUICConn(conn, s.Password, s.WithoutBrook, s.TCPTimeout, s.UDPTimeout, nil)
		return
	}

	// 2. Multiplexed ALPN "h3" (used by both WebTransport and legacy Brook QUIC clients)
	uniChan := make(chan quic.ReceiveStream, 1)
	bidiChan := make(chan quic.Stream, 1)

	probeCtx, cancel := context.WithTimeout(s.ctx, 3*time.Second)
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
		// Client opened a unidirectional stream (HTTP/3 Control Stream). This is WebTransport!
		iconn := &interceptedConn{
			EarlyConnection: conn,
			uniStreams:      []quic.ReceiveStream{ustr},
		}
		go func() {
			if err := s.wtServer.ServeQUICConn(iconn); err != nil && err != http.ErrServerClosed {
				log.Printf("[WebTransport] Session ended: %v", err)
			}
		}()

	case bstr := <-bidiChan:
		// Client opened a bidirectional stream first. Peek first byte to inspect frame type.
		buf := make([]byte, 1)
		n, err := bstr.Read(buf)
		if err != nil {
			bstr.Close()
			return
		}
		firstByte := buf[0]

		if firstByte == 0x01 || firstByte == 0x41 {
			// HTTP/3 HEADERS frame (0x01) or WebTransport stream frame (0x41)
			sStream := newBufferedStream(bstr, buf[:n])
			iconn := &interceptedConn{
				EarlyConnection: conn,
				bidiStreams:     []quic.Stream{sStream},
			}
			go func() {
				if err := s.wtServer.ServeQUICConn(iconn); err != nil && err != http.ErrServerClosed {
					log.Printf("[WebTransport] Session ended: %v", err)
				}
			}()
		} else {
			// Raw Brook QUIC stream (starts with 12-byte random client nonce)
			sStream := newBufferedStream(bstr, buf[:n])
			go HandleRawQUICConn(conn, s.Password, s.WithoutBrook, s.TCPTimeout, s.UDPTimeout, sStream)
		}

	case <-probeCtx.Done():
		// Timeout waiting for first stream
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
		s.httpServer = &http.Server{
			Addr:    ":" + httpPort,
			Handler: m.HTTPHandler(nil),
		}
		go func() {
			_ = s.httpServer.ListenAndServe()
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
	s.cancel()
	if s.httpServer != nil {
		_ = s.httpServer.Close()
	}
	if s.listener != nil {
		_ = s.listener.Close()
	}
	if s.packetConn != nil {
		_ = s.packetConn.Close()
	}
	return nil
}
