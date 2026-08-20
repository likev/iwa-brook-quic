package main

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net"
	"sync"
	"time"
)

var brookInfo = []byte("brook")

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

// HandleBrookStream processes an incoming Brook stream from either QUIC or WebTransport.
func HandleBrookStream(client StreamConn, password []byte, withoutBrook bool, tcpTimeout, udpTimeout int) error {
	defer client.Close()

	if withoutBrook {
		return handleSimpleBrookStream(client, password, tcpTimeout, udpTimeout)
	}
	return handleEncryptedBrookStream(client, password, tcpTimeout, udpTimeout)
}

func handleEncryptedBrookStream(client StreamConn, password []byte, tcpTimeout, udpTimeout int) error {
	if tcpTimeout != 0 {
		_ = client.SetDeadline(time.Now().Add(time.Duration(tcpTimeout) * time.Second))
	}

	// 1. Read Client Nonce (12 bytes)
	cn := make([]byte, 12)
	if _, err := io.ReadFull(client, cn); err != nil {
		return fmt.Errorf("read client nonce failed: %w", err)
	}

	// 2. Derive Client Key
	ck, err := DeriveKey(password, cn, brookInfo)
	if err != nil {
		return fmt.Errorf("derive client key failed: %w", err)
	}
	ca, err := NewGCMCipher(ck)
	if err != nil {
		return fmt.Errorf("new client cipher failed: %w", err)
	}

	// 3. Read Header Length Frame (18 bytes: 2B len ciphertext + 16B tag)
	lenBuf18 := make([]byte, 18)
	if _, err := io.ReadFull(client, lenBuf18); err != nil {
		return fmt.Errorf("read header length frame failed: %w", err)
	}
	plainLen, err := ca.Open(nil, cn, lenBuf18, nil)
	if err != nil {
		return fmt.Errorf("open header length failed (auth error): %w", err)
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
	sk, err := DeriveKey(password, sn, brookInfo)
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

	// Remote -> Client (Encrypt & Send to Client)
	go func() {
		defer wg.Done()
		rawBuf := make([]byte, 16384)
		frameBuf := make([]byte, 2+16+16384+16)

		for {
			if timeout != 0 {
				_ = remote.SetReadDeadline(time.Now().Add(time.Duration(timeout) * time.Second))
			}
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
				if timeout != 0 {
					_ = client.SetWriteDeadline(time.Now().Add(time.Duration(timeout) * time.Second))
				}
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
		lenChunk := make([]byte, 18)
		payloadChunk := make([]byte, 65536)

		for {
			if timeout != 0 {
				_ = client.SetReadDeadline(time.Now().Add(time.Duration(timeout) * time.Second))
			}
			if _, err := io.ReadFull(client, lenChunk); err != nil {
				return
			}
			plainL, err := ca.Open(nil, cn, lenChunk, nil)
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
			plainData, err := ca.Open(nil, cn, payloadChunk[:l+16], nil)
			if err != nil {
				return
			}
			NextNonce(cn)

			if timeout != 0 {
				_ = remote.SetWriteDeadline(time.Now().Add(time.Duration(timeout) * time.Second))
			}
			if _, err := remote.Write(plainData); err != nil {
				return
			}
		}
	}()

	wg.Wait()
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

	var wg sync.WaitGroup
	wg.Add(2)

	go func() {
		defer wg.Done()
		buf := make([]byte, 32768)
		for {
			if timeout != 0 {
				_ = remote.SetReadDeadline(time.Now().Add(time.Duration(timeout) * time.Second))
			}
			n, err := remote.Read(buf)
			if n > 0 {
				if timeout != 0 {
					_ = client.SetWriteDeadline(time.Now().Add(time.Duration(timeout) * time.Second))
				}
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
		buf := make([]byte, 32768)
		for {
			if timeout != 0 {
				_ = client.SetReadDeadline(time.Now().Add(time.Duration(timeout) * time.Second))
			}
			n, err := client.Read(buf)
			if n > 0 {
				if timeout != 0 {
					_ = remote.SetWriteDeadline(time.Now().Add(time.Duration(timeout) * time.Second))
				}
				if _, werr := remote.Write(buf[:n]); werr != nil {
					return
				}
			}
			if err != nil {
				return
			}
		}
	}()

	wg.Wait()
	return nil
}
