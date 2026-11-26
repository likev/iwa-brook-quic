package main

import (
	"bytes"
	"encoding/binary"
	"errors"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const (
	wsFrameOpen uint8 = 0x01
	wsFrameData uint8 = 0x02
	wsFrameFin  uint8 = 0x03
	wsFrameRst  uint8 = 0x04
	wsFramePing uint8 = 0x05
	wsFramePong uint8 = 0x06

	wsHeaderLen       = 5
	wsMaxDataChunk    = 32 * 1024
	wsMaxStreamBuffer = 4 * 1024 * 1024
	wsMaxMessageBytes = 2 * 1024 * 1024
)

var wsUpgrader = websocket.Upgrader{
	ReadBufferSize:  64 * 1024,
	WriteBufferSize: 64 * 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

// WebSocketHandler handles /brook-ws upgrades and multiplexes Brook streams over TLS/TCP.
type WebSocketHandler struct {
	password       []byte
	withoutBrook   bool
	tcpTimeout     int
	udpTimeout     int
	maxIdleTimeout time.Duration
	streamSem      chan struct{}
}

func NewWebSocketHandler(password []byte, withoutBrook bool, tcpTimeout, udpTimeout int, maxIdleTimeout time.Duration, streamSem chan struct{}) *WebSocketHandler {
	if maxIdleTimeout <= 0 {
		maxIdleTimeout = 300 * time.Second
	}
	return &WebSocketHandler{
		password:       password,
		withoutBrook:   withoutBrook,
		tcpTimeout:     tcpTimeout,
		udpTimeout:     udpTimeout,
		maxIdleTimeout: maxIdleTimeout,
		streamSem:      streamSem,
	}
}

func (h *WebSocketHandler) HandleUpgrade(w http.ResponseWriter, r *http.Request) {
	wsConn, err := wsUpgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[WebSocket] Upgrade failed from %s: %v", r.RemoteAddr, err)
		return
	}

	wsConn.SetReadLimit(wsMaxMessageBytes)
	remoteAddr := wsConn.RemoteAddr()
	localAddr := wsConn.LocalAddr()
	log.Printf("[WebSocket] Session established from %s (Path: %s)", remoteAddr, r.URL.Path)

	sess := &wsMuxSession{
		conn:       wsConn,
		localAddr:  localAddr,
		remoteAddr: remoteAddr,
		streams:    make(map[uint32]*WSMuxStream),
	}

	defer func() {
		sess.closeAll(net.ErrClosed)
		_ = wsConn.Close()
	}()

	for {
		_ = wsConn.SetReadDeadline(time.Now().Add(h.maxIdleTimeout))
		msgType, msg, err := wsConn.ReadMessage()
		if err != nil {
			if !websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway, websocket.CloseNoStatusReceived) && !isNormalStreamClose(err) {
				log.Printf("[WebSocket] Session ended from %s: %v", remoteAddr, err)
			}
			return
		}
		if msgType != websocket.BinaryMessage || len(msg) < wsHeaderLen {
			continue
		}

		frameType := msg[0]
		streamID := binary.BigEndian.Uint32(msg[1:5])
		payload := msg[5:]

		switch frameType {
		case wsFramePing:
			_ = sess.sendFrame(wsFramePong, 0, nil, time.Now().Add(10*time.Second))

		case wsFramePong:
			// Idle deadline already refreshed above

		case wsFrameOpen:
			if !takeStreamSlot(h.streamSem, remoteAddr, "websocket") {
				_ = sess.sendFrame(wsFrameRst, streamID, nil, time.Now().Add(5*time.Second))
				continue
			}

			st := newWSMuxStream(streamID, sess)
			if len(payload) > 0 {
				if !st.pushData(payload) {
					if h.streamSem != nil {
						<-h.streamSem
					}
					_ = sess.sendFrame(wsFrameRst, streamID, nil, time.Now().Add(5*time.Second))
					continue
				}
			}

			if !sess.registerStream(st) {
				if h.streamSem != nil {
					<-h.streamSem
				}
				_ = sess.sendFrame(wsFrameRst, streamID, nil, time.Now().Add(5*time.Second))
				continue
			}

			go func(s *WSMuxStream) {
				defer func() {
					sess.removeStream(s.id)
					if h.streamSem != nil {
						<-h.streamSem
					}
				}()
				if err := HandleBrookStream(s, h.password, h.withoutBrook, h.tcpTimeout, h.udpTimeout); err != nil {
					if !isNormalStreamClose(err) {
						log.Printf("[WebSocket] Stream %d error from %s: %v", s.id, remoteAddr, err)
					}
				}
			}(st)

		case wsFrameData:
			st := sess.getStream(streamID)
			if st == nil {
				continue
			}
			if !st.pushData(payload) {
				st.pushRemoteRst(errors.New("websocket stream receive buffer overflow"))
				_ = sess.sendFrame(wsFrameRst, streamID, nil, time.Now().Add(5*time.Second))
				sess.removeStream(streamID)
			}

		case wsFrameFin:
			if st := sess.getStream(streamID); st != nil {
				st.pushRemoteFin()
			}

		case wsFrameRst:
			if st := sess.getStream(streamID); st != nil {
				st.pushRemoteRst(errors.New("stream canceled by remote"))
				sess.removeStream(streamID)
			}
		}
	}
}

type wsMuxSession struct {
	conn       *websocket.Conn
	localAddr  net.Addr
	remoteAddr net.Addr

	writeMu sync.Mutex

	mu      sync.RWMutex
	closed  bool
	streams map[uint32]*WSMuxStream
}

func (s *wsMuxSession) registerStream(st *WSMuxStream) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return false
	}
	if _, exists := s.streams[st.id]; exists {
		return false
	}
	s.streams[st.id] = st
	return true
}

func (s *wsMuxSession) getStream(id uint32) *WSMuxStream {
	s.mu.RLock()
	st := s.streams[id]
	s.mu.RUnlock()
	return st
}

func (s *wsMuxSession) removeStream(id uint32) {
	s.mu.Lock()
	delete(s.streams, id)
	s.mu.Unlock()
}

func (s *wsMuxSession) closeAll(err error) {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return
	}
	s.closed = true
	streams := make([]*WSMuxStream, 0, len(s.streams))
	for id, st := range s.streams {
		streams = append(streams, st)
		delete(s.streams, id)
	}
	s.mu.Unlock()

	for _, st := range streams {
		st.pushRemoteRst(err)
	}
}

func (s *wsMuxSession) sendFrame(frameType uint8, streamID uint32, payload []byte, deadline time.Time) error {
	s.mu.RLock()
	closed := s.closed
	s.mu.RUnlock()
	if closed {
		return net.ErrClosed
	}

	frame := make([]byte, wsHeaderLen+len(payload))
	frame[0] = frameType
	binary.BigEndian.PutUint32(frame[1:5], streamID)
	if len(payload) > 0 {
		copy(frame[5:], payload)
	}

	s.writeMu.Lock()
	defer s.writeMu.Unlock()

	if deadline.IsZero() {
		deadline = time.Now().Add(30 * time.Second)
	}
	_ = s.conn.SetWriteDeadline(deadline)
	return s.conn.WriteMessage(websocket.BinaryMessage, frame)
}

// WSMuxStream adapts a multiplexed WebSocket stream to StreamConn.
type WSMuxStream struct {
	id   uint32
	sess *wsMuxSession

	mu            sync.Mutex
	readBuf       bytes.Buffer
	remoteFin     bool
	readCanceled  bool
	writeClosed   bool
	writeCanceled bool
	resetErr      error
	readDeadline  time.Time
	writeDeadline time.Time
	notifyCh      chan struct{}
}

func newWSMuxStream(id uint32, sess *wsMuxSession) *WSMuxStream {
	return &WSMuxStream{
		id:       id,
		sess:     sess,
		notifyCh: make(chan struct{}, 1),
	}
}

func (s *WSMuxStream) signalLocked() {
	select {
	case s.notifyCh <- struct{}{}:
	default:
	}
}

func (s *WSMuxStream) pushData(data []byte) bool {
	if len(data) == 0 {
		return true
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.readCanceled || s.remoteFin || s.resetErr != nil {
		return true
	}
	if s.readBuf.Len()+len(data) > wsMaxStreamBuffer {
		return false
	}
	_, _ = s.readBuf.Write(data)
	s.signalLocked()
	return true
}

func (s *WSMuxStream) pushRemoteFin() {
	s.mu.Lock()
	s.remoteFin = true
	s.signalLocked()
	s.mu.Unlock()
}

func (s *WSMuxStream) pushRemoteRst(err error) {
	s.mu.Lock()
	if s.resetErr == nil {
		if err != nil {
			s.resetErr = err
		} else {
			s.resetErr = net.ErrClosed
		}
	}
	s.readCanceled = true
	s.writeCanceled = true
	s.signalLocked()
	s.mu.Unlock()
}

func (s *WSMuxStream) Read(p []byte) (int, error) {
	for {
		s.mu.Lock()
		if s.readBuf.Len() > 0 {
			n, _ := s.readBuf.Read(p)
			s.mu.Unlock()
			return n, nil
		}
		if s.resetErr != nil {
			err := s.resetErr
			s.mu.Unlock()
			return 0, err
		}
		if s.remoteFin {
			s.mu.Unlock()
			return 0, io.EOF
		}
		if s.readCanceled {
			s.mu.Unlock()
			return 0, net.ErrClosed
		}

		dl := s.readDeadline
		s.mu.Unlock()

		if !dl.IsZero() {
			wait := time.Until(dl)
			if wait <= 0 {
				return 0, os.ErrDeadlineExceeded
			}
			timer := time.NewTimer(wait)
			select {
			case <-s.notifyCh:
				if !timer.Stop() {
					select {
					case <-timer.C:
					default:
					}
				}
			case <-timer.C:
				return 0, os.ErrDeadlineExceeded
			}
		} else {
			<-s.notifyCh
		}
	}
}

func (s *WSMuxStream) Write(p []byte) (int, error) {
	if len(p) == 0 {
		return 0, nil
	}

	s.mu.Lock()
	if s.writeClosed || s.writeCanceled {
		err := s.resetErr
		if err == nil {
			err = net.ErrClosed
		}
		s.mu.Unlock()
		return 0, err
	}
	dl := s.writeDeadline
	s.mu.Unlock()

	if !dl.IsZero() && !time.Now().Before(dl) {
		return 0, os.ErrDeadlineExceeded
	}

	total := 0
	for offset := 0; offset < len(p); offset += wsMaxDataChunk {
		end := offset + wsMaxDataChunk
		if end > len(p) {
			end = len(p)
		}
		if err := s.sess.sendFrame(wsFrameData, s.id, p[offset:end], dl); err != nil {
			return total, err
		}
		total += end - offset
	}
	return total, nil
}

// Close closes the write half cleanly by sending FRAME_FIN (matching quic.Stream.Close semantics).
func (s *WSMuxStream) Close() error {
	s.mu.Lock()
	if s.writeClosed {
		s.mu.Unlock()
		return nil
	}
	s.writeClosed = true
	sendFin := !s.writeCanceled
	s.mu.Unlock()

	if sendFin {
		_ = s.sess.sendFrame(wsFrameFin, s.id, nil, time.Now().Add(5*time.Second))
	}
	return nil
}

func (s *WSMuxStream) CancelRead(code uint64) {
	s.mu.Lock()
	s.readCanceled = true
	s.readBuf.Reset()
	s.signalLocked()
	s.mu.Unlock()
}

func (s *WSMuxStream) CancelWrite(code uint64) {
	s.mu.Lock()
	sendRst := !s.writeClosed && !s.writeCanceled
	s.writeCanceled = true
	s.writeClosed = true
	s.signalLocked()
	s.mu.Unlock()

	if sendRst {
		_ = s.sess.sendFrame(wsFrameRst, s.id, nil, time.Now().Add(5*time.Second))
	}
}

func (s *WSMuxStream) SetDeadline(t time.Time) error {
	s.mu.Lock()
	s.readDeadline = t
	s.writeDeadline = t
	s.signalLocked()
	s.mu.Unlock()
	return nil
}

func (s *WSMuxStream) SetReadDeadline(t time.Time) error {
	s.mu.Lock()
	s.readDeadline = t
	s.signalLocked()
	s.mu.Unlock()
	return nil
}

func (s *WSMuxStream) SetWriteDeadline(t time.Time) error {
	s.mu.Lock()
	s.writeDeadline = t
	s.mu.Unlock()
	return nil
}

func (s *WSMuxStream) LocalAddr() net.Addr {
	return s.sess.localAddr
}

func (s *WSMuxStream) RemoteAddr() net.Addr {
	return s.sess.remoteAddr
}
