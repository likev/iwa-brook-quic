package main

import (
	"log"
	"net"
	"net/http"

	"github.com/quic-go/quic-go"
	"github.com/quic-go/webtransport-go"
)

// quicConnContextKey stores the underlying *quic.Conn in HTTP/3 request contexts via ConnContext.
type quicConnContextKey struct{}

// WTStreamConn wraps a *webtransport.Stream as a net.Conn / StreamConn.
type WTStreamConn struct {
	*webtransport.Stream
	localAddr  net.Addr
	remoteAddr net.Addr
}

func (c *WTStreamConn) LocalAddr() net.Addr {
	return c.localAddr
}

func (c *WTStreamConn) RemoteAddr() net.Addr {
	return c.remoteAddr
}

func (c *WTStreamConn) CancelRead(code uint64) {
	c.Stream.CancelRead(webtransport.StreamErrorCode(code))
}

func (c *WTStreamConn) CancelWrite(code uint64) {
	c.Stream.CancelWrite(webtransport.StreamErrorCode(code))
}

// WebTransportHandler handles WebTransport session upgrades and manages streams.
type WebTransportHandler struct {
	server       *webtransport.Server
	password     []byte
	withoutBrook bool
	tcpTimeout   int
	udpTimeout   int
	streamSem    chan struct{}
}

func NewWebTransportHandler(wtServer *webtransport.Server, password []byte, withoutBrook bool, tcpTimeout, udpTimeout int, streamSem chan struct{}) *WebTransportHandler {
	return &WebTransportHandler{
		server:       wtServer,
		password:     password,
		withoutBrook: withoutBrook,
		tcpTimeout:   tcpTimeout,
		udpTimeout:   udpTimeout,
		streamSem:    streamSem,
	}
}

func (h *WebTransportHandler) HandleUpgrade(w http.ResponseWriter, r *http.Request) {
	qconn, _ := r.Context().Value(quicConnContextKey{}).(*quic.Conn)

	session, err := h.server.Upgrade(w, r)
	if err != nil {
		log.Printf("[WebTransport] Upgrade failed from %s: %v", r.RemoteAddr, err)
		if qconn != nil {
			_ = qconn.CloseWithError(0, "upgrade failed")
		}
		return
	}

	remoteAddr := session.RemoteAddr()
	localAddr := session.LocalAddr()
	log.Printf("[WebTransport] Session established from %s (Path: %s)", remoteAddr, r.URL.Path)

	// Drain client-side NAT keepalive datagrams so the receive queue stays clear
	go func() {
		ctx := session.Context()
		for {
			if _, err := session.ReceiveDatagram(ctx); err != nil {
				return
			}
		}
	}()

	go func() {
		defer func() {
			_ = session.CloseWithError(0, "done")
			if qconn != nil {
				_ = qconn.CloseWithError(0, "done")
			}
		}()
		ctx := session.Context()
		for {
			str, err := session.AcceptStream(ctx)
			if err != nil {
				return
			}

			if !takeStreamSlot(h.streamSem, remoteAddr, "webtransport") {
				str.CancelRead(0x100)
				str.CancelWrite(0x100)
				_ = str.Close()
				continue
			}

			sConn := &WTStreamConn{
				Stream:     str,
				localAddr:  localAddr,
				remoteAddr: remoteAddr,
			}

			go func(c StreamConn) {
				if h.streamSem != nil {
					defer func() { <-h.streamSem }()
				}
				if err := HandleBrookStream(c, h.password, h.withoutBrook, h.tcpTimeout, h.udpTimeout); err != nil {
					if !isNormalStreamClose(err) {
						log.Printf("[WebTransport] Stream error from %s: %v", remoteAddr, err)
					}
				}
			}(sConn)
		}
	}()
}
