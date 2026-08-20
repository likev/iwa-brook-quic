package main

import (
	"log"
	"net"

	"github.com/quic-go/quic-go"
)

// RawQUICStreamConn wraps a quic.Stream as a net.Conn / StreamConn.
type RawQUICStreamConn struct {
	quic.Stream
	localAddr  net.Addr
	remoteAddr net.Addr
}

func (c *RawQUICStreamConn) LocalAddr() net.Addr {
	return c.localAddr
}

func (c *RawQUICStreamConn) RemoteAddr() net.Addr {
	return c.remoteAddr
}

// HandleRawQUICConn handles streams from a legacy / raw Brook QUIC connection.
func HandleRawQUICConn(conn quic.Connection, password []byte, withoutBrook bool, tcpTimeout, udpTimeout int, firstStream quic.Stream) {
	remoteAddr := conn.RemoteAddr()
	localAddr := conn.LocalAddr()

	log.Printf("[QUIC] Raw Brook QUIC connection active from %s", remoteAddr)

	// If a first stream was already accepted during protocol detection, process it immediately
	if firstStream != nil {
		sConn := &RawQUICStreamConn{
			Stream:     firstStream,
			localAddr:  localAddr,
			remoteAddr: remoteAddr,
		}
		go func(c StreamConn) {
			if err := HandleBrookStream(c, password, withoutBrook, tcpTimeout, udpTimeout); err != nil {
				log.Printf("[QUIC] Stream error from %s: %v", remoteAddr, err)
			}
		}(sConn)
	}

	// Continue accepting subsequent streams on this QUIC connection
	ctx := conn.Context()
	for {
		st, err := conn.AcceptStream(ctx)
		if err != nil {
			return
		}

		sConn := &RawQUICStreamConn{
			Stream:     st,
			localAddr:  localAddr,
			remoteAddr: remoteAddr,
		}

		go func(c StreamConn) {
			if err := HandleBrookStream(c, password, withoutBrook, tcpTimeout, udpTimeout); err != nil {
				log.Printf("[QUIC] Stream error from %s: %v", remoteAddr, err)
			}
		}(sConn)
	}
}
