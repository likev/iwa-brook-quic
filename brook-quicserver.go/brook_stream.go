package main

import (
	"bytes"
	"crypto/cipher"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net"
	"sync"
	"time"
)

var brookInfo = []byte("brook")

var (
	// Pool for TCP frames: 2 + 16 + 2014 + 16 = 2048 bytes
	tcpFramePool = sync.Pool{
		New: func() any {
			b := make([]byte, 2048)
			return &b
		},
	}
	// Pool for TCP raw payload: 2014 bytes
	tcpRawPool = sync.Pool{
		New: func() any {
			b := make([]byte, 2014)
			return &b
		},
	}
	// Pool for 64KB buffers (UDP frames, payloadChunk, and simple stream buffers)
	buf64kPool = sync.Pool{
		New: func() any {
			b := make([]byte, 65536)
			return &b
		},
	}
	// Pool for UDP frame buffer (2 + 16 + 65473 + 16 = 65507 bytes)
	udpFramePool = sync.Pool{
		New: func() any {
			b := make([]byte, 65507)
			return &b
		},
	}
)

// StreamConn is an interface representing a stream connection that can be read, written, and closed.
type StreamConn interface {
	io.Reader
	io.Writer
	io.Closer
	SetDeadline(t time.Time) error
	SetReadDeadline(t time.Time) error
	SetWriteDeadline(t time.Time) error
	LocalAddr() net.Addr
	RemoteAddr() net.Addr
}

type bufferedStreamConn struct {
	StreamConn
	reader io.Reader
}

func (b *bufferedStreamConn) Read(p []byte) (int, error) {
	return b.reader.Read(p)
}

func newBufferedStreamConn(conn StreamConn, initial []byte) *bufferedStreamConn {
	return &bufferedStreamConn{
		StreamConn: conn,
		reader:     io.MultiReader(bytes.NewReader(initial), conn),
	}
}

// HandleBrookStream processes an incoming Brook stream from either QUIC or WebTransport with auto-detection.
func HandleBrookStream(client StreamConn, password []byte, defaultWithoutBrook bool, tcpTimeout, udpTimeout int) error {
	defer client.Close()

	if tcpTimeout != 0 {
		_ = client.SetDeadline(time.Now().Add(time.Duration(tcpTimeout) * time.Second))
	}

	var rawPass []byte = password
	var passHash []byte
	if len(password) == 32 {
		passHash = password
	} else {
		passHash = SHA256Bytes(password)
	}

	// 1. Read first 12 bytes (client nonce in Brook framing, or first 12 bytes of SHA256 in simple mode)
	first12 := make([]byte, 12)
	if _, err := io.ReadFull(client, first12); err != nil {
		return fmt.Errorf("read client nonce failed: %w", err)
	}

	// 2. Check if first 12 bytes match first 12 bytes of passHash (simple unencrypted mode)
	if bytes.Equal(first12, passHash[:12]) {
		// Read remaining 22 bytes (20B of password hash + 2B payload length)
		rem22 := make([]byte, 22)
		if _, err := io.ReadFull(client, rem22); err == nil && bytes.Equal(rem22[:20], passHash[12:32]) {
			// Verified simple unencrypted Brook protocol
			header34 := append(first12, rem22...)
			bConn := newBufferedStreamConn(client, header34)
			return handleSimpleBrookStream(bConn, passHash, tcpTimeout, udpTimeout)
		} else {
			// If remainder did not match, rewind stream and proceed as encrypted
			rewind := append(first12, rem22...)
			bConn := newBufferedStreamConn(client, rewind)
			return handleEncryptedBrookStream(bConn, nil, rawPass, passHash, defaultWithoutBrook, tcpTimeout, udpTimeout)
		}
	}

	// 3. Normal Brook framed encrypted stream with auto-detection
	return handleEncryptedBrookStream(client, first12, rawPass, passHash, defaultWithoutBrook, tcpTimeout, udpTimeout)
}

func handleEncryptedBrookStream(client StreamConn, cn []byte, rawPass, passHash []byte, defaultWithoutBrook bool, tcpTimeout, udpTimeout int) error {
	if tcpTimeout != 0 {
		_ = client.SetDeadline(time.Now().Add(time.Duration(tcpTimeout) * time.Second))
	}

	// 1. If cn was not pre-read, read it now
	if len(cn) != 12 {
		cn = make([]byte, 12)
		if _, err := io.ReadFull(client, cn); err != nil {
			return fmt.Errorf("read client nonce failed: %w", err)
		}
	}

	// 2. Read Header Length Frame (18 bytes: 2B len ciphertext + 16B tag)
	lenBuf18 := make([]byte, 18)
	if _, err := io.ReadFull(client, lenBuf18); err != nil {
		return fmt.Errorf("read header length frame failed: %w", err)
	}

	// 3. Auto-Detect withoutBrookProtocol mode:
	// Try the preferred / default mode first, then fall back to the alternate mode.
	type keyCandidate struct {
		pass         []byte
		withoutBrook bool
	}
	var candidates []keyCandidate
	if defaultWithoutBrook {
		candidates = []keyCandidate{
			{pass: passHash, withoutBrook: true},
			{pass: rawPass, withoutBrook: false},
		}
	} else {
		candidates = []keyCandidate{
			{pass: rawPass, withoutBrook: false},
			{pass: passHash, withoutBrook: true},
		}
	}

	var ca cipher.AEAD
	var activePassword []byte
	var plainLen []byte

	for _, cand := range candidates {
		ck, err := DeriveKey(cand.pass, cn, brookInfo)
		if err != nil {
			continue
		}
		cCipher, err := NewGCMCipher(ck)
		if err != nil {
			continue
		}
		// Attempt to open the 18-byte length frame with AES-GCM tag verification
		if pLen, err := cCipher.Open(nil, cn, lenBuf18, nil); err == nil {
			ca = cCipher
			activePassword = cand.pass
			plainLen = pLen
			break
		}
	}

	if ca == nil {
		return fmt.Errorf("open header length failed (auth error): cipher: message authentication failed")
	}

	NextNonce(cn)
	headerLen := int(binary.BigEndian.Uint16(plainLen))
	if headerLen > 2048 {
		return fmt.Errorf("header length too large: %d", headerLen)
	}

	// 4. Read Header Payload Frame (headerLen + 16B tag)
	payloadBuf := make([]byte, headerLen+16)
	if _, err := io.ReadFull(client, payloadBuf); err != nil {
		return fmt.Errorf("read header payload failed: %w", err)
	}
	plainHeader, err := ca.Open(nil, cn, payloadBuf, nil)
	if err != nil {
		return fmt.Errorf("open header payload failed: %w", err)
	}
	NextNonce(cn)

	if len(plainHeader) < 4+3 {
		return fmt.Errorf("header payload too short: %d bytes", len(plainHeader))
	}

	// 5. Verify Timestamp & Network Type
	ts := int64(binary.BigEndian.Uint32(plainHeader[:4]))
	now := time.Now().Unix()
	// Tolerate up to 120 seconds of clock drift
	diff := now - ts
	if diff > 120 || diff < -120 {
		return fmt.Errorf("request expired or invalid clock: diff=%ds (now=%d, req=%d)", diff, now, ts)
	}

	isTCP := (ts % 2) == 0
	timeout := tcpTimeout
	if !isTCP {
		timeout = udpTimeout
	}

	// 6. Parse Destination Address
	dstBytes := plainHeader[4:]
	targetAddr, err := ParseBrookDestination(dstBytes)
	if err != nil {
		return fmt.Errorf("parse destination failed: %w", err)
	}

	// 7. Generate Server Nonce (12 bytes) & Send to Client
	sn, err := GenerateNonce()
	if err != nil {
		return fmt.Errorf("generate server nonce failed: %w", err)
	}
	sk, err := DeriveKey(activePassword, sn, brookInfo)
	if err != nil {
		return fmt.Errorf("derive server key failed: %w", err)
	}
	sa, err := NewGCMCipher(sk)
	if err != nil {
		return fmt.Errorf("new server cipher failed: %w", err)
	}

	if _, err := client.Write(sn); err != nil {
		return fmt.Errorf("write server nonce failed: %w", err)
	}

	// 8. Dial Destination Target
	var remote net.Conn
	if isTCP {
		dialer := &net.Dialer{Timeout: 10 * time.Second}
		remote, err = dialer.Dial("tcp", targetAddr)
	} else {
		remote, err = net.DialTimeout("udp", targetAddr, 10*time.Second)
	}
	if err != nil {
		return fmt.Errorf("dial target %s failed: %w", targetAddr, err)
	}
	defer remote.Close()

	// 9. Bi-Directional Encrypted Data Exchange
	var wg sync.WaitGroup
	wg.Add(2)

	doneOnce := sync.Once{}
	unblockOther := func() {
		doneOnce.Do(func() {
			// Propagate close / unblock peer leg with a 5-second deadline
			_ = remote.SetDeadline(time.Now().Add(5 * time.Second))
			_ = client.SetDeadline(time.Now().Add(5 * time.Second))
		})
	}

	effectiveTimeout := timeout
	if effectiveTimeout == 0 {
		effectiveTimeout = 300
	}

	// Remote -> Client (Encrypt & Send to Client)
	go func() {
		defer wg.Done()
		defer unblockOther()

		var rawBuf []byte
		var frameBuf []byte
		if isTCP {
			rawPtr := tcpRawPool.Get().(*[]byte)
			framePtr := tcpFramePool.Get().(*[]byte)
			defer tcpRawPool.Put(rawPtr)
			defer tcpFramePool.Put(framePtr)
			rawBuf = *rawPtr
			frameBuf = *framePtr
		} else {
			rawPtr := buf64kPool.Get().(*[]byte)
			framePtr := udpFramePool.Get().(*[]byte)
			defer buf64kPool.Put(rawPtr)
			defer udpFramePool.Put(framePtr)
			rawBuf = (*rawPtr)[:65473]
			frameBuf = *framePtr
		}

		for {
			_ = remote.SetReadDeadline(time.Now().Add(time.Duration(effectiveTimeout) * time.Second))
			n, err := remote.Read(rawBuf)
			if n > 0 {
				// 1. Seal length (2B)
				binary.BigEndian.PutUint16(frameBuf[:2], uint16(n))
				sa.Seal(frameBuf[:0], sn, frameBuf[:2], nil)
				NextNonce(sn)

				// 2. Seal payload (nB)
				sa.Seal(frameBuf[18:18], sn, rawBuf[:n], nil)
				NextNonce(sn)

				totalLen := 18 + n + 16
				_ = client.SetWriteDeadline(time.Now().Add(time.Duration(effectiveTimeout) * time.Second))
				if _, werr := client.Write(frameBuf[:totalLen]); werr != nil {
					return
				}
			}
			if err != nil {
				return
			}
		}
	}()

	// Client -> Remote (Decrypt & Send to Remote)
	go func() {
		defer wg.Done()
		defer unblockOther()

		lenChunk := make([]byte, 18)
		payloadChunkPtr := buf64kPool.Get().(*[]byte)
		plainDataBufPtr := buf64kPool.Get().(*[]byte)
		defer buf64kPool.Put(payloadChunkPtr)
		defer buf64kPool.Put(plainDataBufPtr)

		payloadChunk := *payloadChunkPtr
		plainLenBuf := make([]byte, 0, 2)
		plainDataBuf := (*plainDataBufPtr)[:0]

		for {
			_ = client.SetReadDeadline(time.Now().Add(time.Duration(effectiveTimeout) * time.Second))
			if _, err := io.ReadFull(client, lenChunk); err != nil {
				return
			}
			plainLenBuf = plainLenBuf[:0]
			plainL, err := ca.Open(plainLenBuf, cn, lenChunk, nil)
			if err != nil {
				return
			}
			NextNonce(cn)
			l := int(binary.BigEndian.Uint16(plainL))
			if l == 0 {
				// FIN or keepalive
				continue
			}
			if l > len(payloadChunk)-16 {
				return
			}

			if _, err := io.ReadFull(client, payloadChunk[:l+16]); err != nil {
				return
			}
			plainDataBuf = plainDataBuf[:0]
			plainData, err := ca.Open(plainDataBuf, cn, payloadChunk[:l+16], nil)
			if err != nil {
				return
			}
			NextNonce(cn)

			_ = remote.SetWriteDeadline(time.Now().Add(time.Duration(effectiveTimeout) * time.Second))
			if _, err := remote.Write(plainData); err != nil {
				return
			}
		}
	}()

	waitCh := make(chan struct{})
	go func() {
		wg.Wait()
		close(waitCh)
	}()

	select {
	case <-waitCh:
	case <-time.After(10 * time.Second):
		_ = remote.Close()
		_ = client.Close()
		<-waitCh
	}
	return nil
}

func handleSimpleBrookStream(client StreamConn, password []byte, tcpTimeout, udpTimeout int) error {
	if tcpTimeout != 0 {
		_ = client.SetDeadline(time.Now().Add(time.Duration(tcpTimeout) * time.Second))
	}

	headerBuf := make([]byte, 32+2)
	if _, err := io.ReadFull(client, headerBuf); err != nil {
		return err
	}

	// Verify SHA-256 password hash (password is already the 32-byte hash)
	if !bytes.Equal(headerBuf[:32], password) {
		return errors.New("invalid password")
	}

	l := int(binary.BigEndian.Uint16(headerBuf[32:34]))
	if l > 4096 {
		return errors.New("header payload too large")
	}

	payload := make([]byte, l)
	if _, err := io.ReadFull(client, payload); err != nil {
		return err
	}

	if len(payload) < 4+3 {
		return errors.New("payload too short")
	}

	ts := int64(binary.BigEndian.Uint32(payload[:4]))
	now := time.Now().Unix()
	if now-ts > 120 || now-ts < -120 {
		return errors.New("expired request")
	}

	isTCP := (ts % 2) == 0
	timeout := tcpTimeout
	if !isTCP {
		timeout = udpTimeout
	}

	targetAddr, err := ParseBrookDestination(payload[4:])
	if err != nil {
		return err
	}

	var remote net.Conn
	if isTCP {
		dialer := &net.Dialer{Timeout: 10 * time.Second}
		remote, err = dialer.Dial("tcp", targetAddr)
	} else {
		remote, err = net.DialTimeout("udp", targetAddr, 10*time.Second)
	}
	if err != nil {
		return err
	}
	defer remote.Close()

	effectiveTimeout := timeout
	if effectiveTimeout == 0 {
		effectiveTimeout = 300
	}

	var wg sync.WaitGroup
	wg.Add(2)

	doneOnce := sync.Once{}
	unblockOther := func() {
		doneOnce.Do(func() {
			_ = remote.SetDeadline(time.Now().Add(5 * time.Second))
			_ = client.SetDeadline(time.Now().Add(5 * time.Second))
		})
	}

	go func() {
		defer wg.Done()
		defer unblockOther()
		bufPtr := buf64kPool.Get().(*[]byte)
		defer buf64kPool.Put(bufPtr)
		buf := (*bufPtr)[:32768]
		for {
			_ = remote.SetReadDeadline(time.Now().Add(time.Duration(effectiveTimeout) * time.Second))
			n, err := remote.Read(buf)
			if n > 0 {
				_ = client.SetWriteDeadline(time.Now().Add(time.Duration(effectiveTimeout) * time.Second))
				if _, werr := client.Write(buf[:n]); werr != nil {
					return
				}
			}
			if err != nil {
				return
			}
		}
	}()

	go func() {
		defer wg.Done()
		defer unblockOther()
		bufPtr := buf64kPool.Get().(*[]byte)
		defer buf64kPool.Put(bufPtr)
		buf := (*bufPtr)[:32768]
		for {
			_ = client.SetReadDeadline(time.Now().Add(time.Duration(effectiveTimeout) * time.Second))
			n, err := client.Read(buf)
			if n > 0 {
				_ = remote.SetWriteDeadline(time.Now().Add(time.Duration(effectiveTimeout) * time.Second))
				if _, werr := remote.Write(buf[:n]); werr != nil {
					return
				}
			}
			if err != nil {
				return
			}
		}
	}()

	waitCh := make(chan struct{})
	go func() {
		wg.Wait()
		close(waitCh)
	}()

	select {
	case <-waitCh:
	case <-time.After(10 * time.Second):
		_ = remote.Close()
		_ = client.Close()
		<-waitCh
	}
	return nil
}
