package main

import (
	"log"
	"net"
	"net/http"

	"github.com/quic-go/webtransport-go"
)

// WTStreamConn wraps a webtransport.Stream as a net.Conn / StreamConn.
type WTStreamConn struct {
	webtransport.Stream
	localAddr  net.Addr
	remoteAddr net.Addr
}

func (c *WTStreamConn) LocalAddr() net.Addr {
	return c.localAddr
}

func (c *WTStreamConn) RemoteAddr() net.Addr {
	return c.remoteAddr
}

// WebTransportHandler handles WebTransport session upgrades and manages streams.
type WebTransportHandler struct {
	server       *webtransport.Server
	password     []byte
	withoutBrook bool
	tcpTimeout   int
	udpTimeout   int
}

func NewWebTransportHandler(wtServer *webtransport.Server, password []byte, withoutBrook bool, tcpTimeout, udpTimeout int) *WebTransportHandler {
	return &WebTransportHandler{
		server:       wtServer,
		password:     password,
		withoutBrook: withoutBrook,
		tcpTimeout:   tcpTimeout,
		udpTimeout:   udpTimeout,
	}
}

func (h *WebTransportHandler) HandleUpgrade(w http.ResponseWriter, r *http.Request) {
	session, err := h.server.Upgrade(w, r)
	if err != nil {
		log.Printf("[WebTransport] Upgrade failed from %s: %v", r.RemoteAddr, err)
		w.WriteHeader(http.StatusInternalServerError)
		return
	}

	remoteAddr := session.RemoteAddr()
	localAddr := session.LocalAddr()
	log.Printf("[WebTransport] Session established from %s (Path: %s)", remoteAddr, r.URL.Path)

	go func() {
		ctx := session.Context()
		for {
			str, err := session.AcceptStream(ctx)
			if err != nil {
				return
			}

			conn := &WTStreamConn{
				Stream:     str,
				localAddr:  localAddr,
				remoteAddr: remoteAddr,
			}

			go func(c StreamConn) {
				if err := HandleBrookStream(c, h.password, h.withoutBrook, h.tcpTimeout, h.udpTimeout); err != nil {
					log.Printf("[WebTransport] Stream error from %s: %v", remoteAddr, err)
				}
			}(conn)
		}
	}()
}
