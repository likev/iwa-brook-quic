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
func HandleRawQUICConn(conn quic.Connection, password []byte, withoutBrook bool, tcpTimeout, udpTimeout int, firstStream quic.Stream, streamSem chan struct{}) {
	remoteAddr := conn.RemoteAddr()
	localAddr := conn.LocalAddr()

	log.Printf("[QUIC] Raw Brook QUIC connection active from %s", remoteAddr)

	// If a first stream was already accepted during protocol detection, process it immediately
	if firstStream != nil {
		if streamSem != nil {
			select {
			case streamSem <- struct{}{}:
			default:
				firstStream.CancelRead(0)
				_ = firstStream.Close()
				return
			}
		}

		sConn := &RawQUICStreamConn{
			Stream:     firstStream,
			localAddr:  localAddr,
			remoteAddr: remoteAddr,
		}
		go func(c StreamConn) {
			if streamSem != nil {
				defer func() { <-streamSem }()
			}
			if err := HandleBrookStream(c, password, withoutBrook, tcpTimeout, udpTimeout); err != nil {
				if !isNormalStreamClose(err) {
					log.Printf("[QUIC] Stream error from %s: %v", remoteAddr, err)
				}
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

		if streamSem != nil {
			select {
			case streamSem <- struct{}{}:
			default:
				st.CancelRead(0)
				_ = st.Close()
				continue
			}
		}

		sConn := &RawQUICStreamConn{
			Stream:     st,
			localAddr:  localAddr,
			remoteAddr: remoteAddr,
		}

		go func(c StreamConn) {
			if streamSem != nil {
				defer func() { <-streamSem }()
			}
			if err := HandleBrookStream(c, password, withoutBrook, tcpTimeout, udpTimeout); err != nil {
				if !isNormalStreamClose(err) {
					log.Printf("[QUIC] Stream error from %s: %v", remoteAddr, err)
				}
			}
		}(sConn)
	}
}
