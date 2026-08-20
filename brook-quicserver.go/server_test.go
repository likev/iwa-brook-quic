package main

import (
	"context"
	"crypto/tls"
	"encoding/binary"
	"fmt"
	"io"
	"net"
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/quic-go/quic-go"
	"github.com/quic-go/webtransport-go"
)

// startEchoServer starts a local TCP echo server and returns its address.
func startEchoServer(t *testing.T) (string, func()) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("failed to start echo server: %v", err)
	}

	done := make(chan struct{})
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				select {
				case <-done:
					return
				default:
					return
				}
			}
			go func(c net.Conn) {
				defer c.Close()
				io.Copy(c, c)
			}(conn)
		}
	}()

	cleanup := func() {
		close(done)
		_ = ln.Close()
	}
	return ln.Addr().String(), cleanup
}

func TestUnifiedServerRawQUICAndWebTransport(t *testing.T) {
	echoAddr, cleanupEcho := startEchoServer(t)
	defer cleanupEcho()

	password := "testpassword123"
	server, err := NewServer("127.0.0.1:0", password, "", 10, 10, false)
	if err != nil {
		t.Fatalf("failed to create server: %v", err)
	}
	defer server.Close()

	go func() {
		if err := server.ListenAndServe(); err != nil {
			// server closed
		}
	}()

	// Wait for server to bind
	select {
	case <-server.Ready():
	case <-time.After(5 * time.Second):
		t.Fatal("server failed to start within 5s")
	}
	serverAddr := server.LocalAddr().String()
	t.Logf("Server running on %s", serverAddr)

	tlsConf := &tls.Config{
		InsecureSkipVerify: true,
		NextProtos:         []string{"h3", "brook-quic"},
	}

	// 1. Test Raw QUIC Client
	t.Run("Raw QUIC Client", func(t *testing.T) {
		conn, err := quic.DialAddr(context.Background(), serverAddr, tlsConf, &quic.Config{EnableDatagrams: true})
		if err != nil {
			t.Fatalf("QUIC dial failed: %v", err)
		}
		defer conn.CloseWithError(0, "")

		stream, err := conn.OpenStreamSync(context.Background())
		if err != nil {
			t.Fatalf("open stream failed: %v", err)
		}
		defer stream.Close()

		// Perform Brook Client Handshake
		cn, err := GenerateNonce()
		if err != nil {
			t.Fatal(err)
		}
		ck, err := DeriveKey([]byte(password), cn, brookInfo)
		if err != nil {
			t.Fatal(err)
		}
		ca, err := NewGCMCipher(ck)
		if err != nil {
			t.Fatal(err)
		}

		// Send client nonce (12B)
		if _, err := stream.Write(cn); err != nil {
			t.Fatal(err)
		}

		// Build Header Payload: [4B timestamp (even for TCP)] + [Atyp + Addr + Port]
		atyp, addrB, portB, err := ParseAddress(echoAddr)
		if err != nil {
			t.Fatal(err)
		}
		dstSlice := append([]byte{atyp}, addrB...)
		dstSlice = append(dstSlice, portB...)

		now := time.Now().Unix()
		if now%2 != 0 {
			now += 1
		}
		headerBody := make([]byte, 4+len(dstSlice))
		binary.BigEndian.PutUint32(headerBody[:4], uint32(now))
		copy(headerBody[4:], dstSlice)

		// Seal length (2B) + payload
		hdrLenBuf := make([]byte, 2)
		binary.BigEndian.PutUint16(hdrLenBuf, uint16(len(headerBody)))
		sealedLen := ca.Seal(nil, cn, hdrLenBuf, nil)
		NextNonce(cn)
		sealedPayload := ca.Seal(nil, cn, headerBody, nil)
		NextNonce(cn)

		if _, err := stream.Write(append(sealedLen, sealedPayload...)); err != nil {
			t.Fatal(err)
		}

		// Read Server Nonce (12B)
		sn := make([]byte, 12)
		if _, err := io.ReadFull(stream, sn); err != nil {
			t.Fatalf("failed to read server nonce: %v", err)
		}
		sk, err := DeriveKey([]byte(password), sn, brookInfo)
		if err != nil {
			t.Fatal(err)
		}
		sa, err := NewGCMCipher(sk)
		if err != nil {
			t.Fatal(err)
		}

		// Send echo test data frame
		testData := []byte("Hello via Raw Brook QUIC!")
		dataLenBuf := make([]byte, 2)
		binary.BigEndian.PutUint16(dataLenBuf, uint16(len(testData)))
		sealedDataLen := ca.Seal(nil, cn, dataLenBuf, nil)
		NextNonce(cn)
		sealedDataPayload := ca.Seal(nil, cn, testData, nil)
		NextNonce(cn)

		if _, err := stream.Write(append(sealedDataLen, sealedDataPayload...)); err != nil {
			t.Fatal(err)
		}

		// Read echo reply from server
		respLenBuf := make([]byte, 18)
		if _, err := io.ReadFull(stream, respLenBuf); err != nil {
			t.Fatalf("failed to read resp length: %v", err)
		}
		plainRespLen, err := sa.Open(nil, sn, respLenBuf, nil)
		if err != nil {
			t.Fatalf("failed to decrypt resp length: %v", err)
		}
		NextNonce(sn)
		respLen := int(binary.BigEndian.Uint16(plainRespLen))

		respPayloadBuf := make([]byte, respLen+16)
		if _, err := io.ReadFull(stream, respPayloadBuf); err != nil {
			t.Fatalf("failed to read resp payload: %v", err)
		}
		plainRespPayload, err := sa.Open(nil, sn, respPayloadBuf, nil)
		if err != nil {
			t.Fatalf("failed to decrypt resp payload: %v", err)
		}
		NextNonce(sn)

		if string(plainRespPayload) != string(testData) {
			t.Fatalf("expected echo %q, got %q", string(testData), string(plainRespPayload))
		}
		t.Logf("✅ Raw QUIC Echo Test Passed: %s", string(plainRespPayload))
	})

	// 2. Test WebTransport Client
	t.Run("WebTransport Client", func(t *testing.T) {
		d := webtransport.Dialer{
			TLSClientConfig: tlsConf,
		}
		url := fmt.Sprintf("https://%s/brook", serverAddr)
		resp, sess, err := d.Dial(context.Background(), url, nil)
		if err != nil {
			t.Fatalf("WebTransport dial failed: %v", err)
		}
		defer sess.CloseWithError(0, "")

		if resp.StatusCode != http.StatusOK {
			t.Fatalf("expected status 200, got %d", resp.StatusCode)
		}

		stream, err := sess.OpenStreamSync(context.Background())
		if err != nil {
			t.Fatalf("open WT stream failed: %v", err)
		}
		defer stream.Close()

		// Perform Brook Client Handshake
		cn, err := GenerateNonce()
		if err != nil {
			t.Fatal(err)
		}
		ck, err := DeriveKey([]byte(password), cn, brookInfo)
		if err != nil {
			t.Fatal(err)
		}
		ca, err := NewGCMCipher(ck)
		if err != nil {
			t.Fatal(err)
		}

		// Send client nonce (12B)
		if _, err := stream.Write(cn); err != nil {
			t.Fatal(err)
		}

		// Build Header Payload: [4B timestamp (even for TCP)] + [Atyp + Addr + Port]
		atyp, addrB, portB, err := ParseAddress(echoAddr)
		if err != nil {
			t.Fatal(err)
		}
		dstSlice := append([]byte{atyp}, addrB...)
		dstSlice = append(dstSlice, portB...)

		now := time.Now().Unix()
		if now%2 != 0 {
			now += 1
		}
		headerBody := make([]byte, 4+len(dstSlice))
		binary.BigEndian.PutUint32(headerBody[:4], uint32(now))
		copy(headerBody[4:], dstSlice)

		// Seal length (2B) + payload
		hdrLenBuf := make([]byte, 2)
		binary.BigEndian.PutUint16(hdrLenBuf, uint16(len(headerBody)))
		sealedLen := ca.Seal(nil, cn, hdrLenBuf, nil)
		NextNonce(cn)
		sealedPayload := ca.Seal(nil, cn, headerBody, nil)
		NextNonce(cn)

		if _, err := stream.Write(append(sealedLen, sealedPayload...)); err != nil {
			t.Fatal(err)
		}

		// Read Server Nonce (12B)
		sn := make([]byte, 12)
		if _, err := io.ReadFull(stream, sn); err != nil {
			t.Fatalf("failed to read server nonce: %v", err)
		}
		sk, err := DeriveKey([]byte(password), sn, brookInfo)
		if err != nil {
			t.Fatal(err)
		}
		sa, err := NewGCMCipher(sk)
		if err != nil {
			t.Fatal(err)
		}

		// Send echo test data frame
		testData := []byte("Hello via Brook WebTransport!")
		dataLenBuf := make([]byte, 2)
		binary.BigEndian.PutUint16(dataLenBuf, uint16(len(testData)))
		sealedDataLen := ca.Seal(nil, cn, dataLenBuf, nil)
		NextNonce(cn)
		sealedDataPayload := ca.Seal(nil, cn, testData, nil)
		NextNonce(cn)

		if _, err := stream.Write(append(sealedDataLen, sealedDataPayload...)); err != nil {
			t.Fatal(err)
		}

		// Read echo reply from server
		respLenBuf := make([]byte, 18)
		if _, err := io.ReadFull(stream, respLenBuf); err != nil {
			t.Fatalf("failed to read resp length: %v", err)
		}
		plainRespLen, err := sa.Open(nil, sn, respLenBuf, nil)
		if err != nil {
			t.Fatalf("failed to decrypt resp length: %v", err)
		}
		NextNonce(sn)
		respLen := int(binary.BigEndian.Uint16(plainRespLen))

		respPayloadBuf := make([]byte, respLen+16)
		if _, err := io.ReadFull(stream, respPayloadBuf); err != nil {
			t.Fatalf("failed to read resp payload: %v", err)
		}
		plainRespPayload, err := sa.Open(nil, sn, respPayloadBuf, nil)
		if err != nil {
			t.Fatalf("failed to decrypt resp payload: %v", err)
		}
		NextNonce(sn)

		if string(plainRespPayload) != string(testData) {
			t.Fatalf("expected echo %q, got %q", string(testData), string(plainRespPayload))
		}
		t.Logf("✅ WebTransport Echo Test Passed: %s", string(plainRespPayload))
	})
}

func TestWithoutBrookMode(t *testing.T) {
	echoAddr, cleanupEcho := startEchoServer(t)
	defer cleanupEcho()

	password := "secretwb123"
	server, err := NewServer("127.0.0.1:0", password, "", 10, 10, true)
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()

	go func() { _ = server.ListenAndServe() }()
	select {
	case <-server.Ready():
	case <-time.After(5 * time.Second):
		t.Fatal("server failed to start")
	}

	serverAddr := server.LocalAddr().String()
	tlsConf := &tls.Config{InsecureSkipVerify: true, NextProtos: []string{"h3"}}

	d := webtransport.Dialer{TLSClientConfig: tlsConf}
	_, sess, err := d.Dial(context.Background(), fmt.Sprintf("https://%s/brook", serverAddr), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer sess.CloseWithError(0, "")

	stream, err := sess.OpenStreamSync(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()

	// WithoutBrook header: [32B sha256(password)] + [2B payload len] + [4B timestamp (even)] + [dst]
	passHash := SHA256Bytes([]byte(password))
	atyp, addrB, portB, err := ParseAddress(echoAddr)
	if err != nil {
		t.Fatal(err)
	}
	dstSlice := append([]byte{atyp}, addrB...)
	dstSlice = append(dstSlice, portB...)

	now := time.Now().Unix()
	if now%2 != 0 {
		now += 1
	}
	payload := make([]byte, 4+len(dstSlice))
	binary.BigEndian.PutUint32(payload[:4], uint32(now))
	copy(payload[4:], dstSlice)

	header := make([]byte, 32+2+len(payload))
	copy(header[:32], passHash)
	binary.BigEndian.PutUint16(header[32:34], uint16(len(payload)))
	copy(header[34:], payload)

	if _, err := stream.Write(header); err != nil {
		t.Fatal(err)
	}

	// Send echo payload
	testMsg := []byte("WithoutBrook WebTransport Works!")
	if _, err := stream.Write(testMsg); err != nil {
		t.Fatal(err)
	}

	buf := make([]byte, 1024)
	stream.SetReadDeadline(time.Now().Add(3 * time.Second))
	n, err := stream.Read(buf)
	if err != nil {
		t.Fatal(err)
	}

	if string(buf[:n]) != string(testMsg) {
		t.Fatalf("expected %q, got %q", string(testMsg), string(buf[:n]))
	}
	t.Logf("✅ WithoutBrook Echo Passed: %s", string(buf[:n]))
}

func TestConcurrentMultiplexStreams(t *testing.T) {
	echoAddr, cleanupEcho := startEchoServer(t)
	defer cleanupEcho()

	password := "concurrentpass456"
	server, err := NewServer("127.0.0.1:0", password, "", 10, 10, false)
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()

	go func() { _ = server.ListenAndServe() }()
	select {
	case <-server.Ready():
	case <-time.After(5 * time.Second):
		t.Fatal("server failed to start")
	}

	serverAddr := server.LocalAddr().String()
	tlsConf := &tls.Config{InsecureSkipVerify: true, NextProtos: []string{"h3"}}

	d := webtransport.Dialer{TLSClientConfig: tlsConf}
	_, sess, err := d.Dial(context.Background(), fmt.Sprintf("https://%s/brook", serverAddr), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer sess.CloseWithError(0, "")

	const concurrency = 20
	errChan := make(chan error, concurrency)

	for i := 0; i < concurrency; i++ {
		go func(idx int) {
			stream, err := sess.OpenStreamSync(context.Background())
			if err != nil {
				errChan <- err
				return
			}
			defer stream.Close()

			cn, _ := GenerateNonce()
			ck, _ := DeriveKey([]byte(password), cn, brookInfo)
			ca, _ := NewGCMCipher(ck)

			stream.Write(cn)

			atyp, addrB, portB, _ := ParseAddress(echoAddr)
			dstSlice := append([]byte{atyp}, addrB...)
			dstSlice = append(dstSlice, portB...)
			now := time.Now().Unix()
			if now%2 != 0 {
				now += 1
			}
			headerBody := make([]byte, 4+len(dstSlice))
			binary.BigEndian.PutUint32(headerBody[:4], uint32(now))
			copy(headerBody[4:], dstSlice)

			hdrLenBuf := make([]byte, 2)
			binary.BigEndian.PutUint16(hdrLenBuf, uint16(len(headerBody)))
			sealedLen := ca.Seal(nil, cn, hdrLenBuf, nil)
			NextNonce(cn)
			sealedPayload := ca.Seal(nil, cn, headerBody, nil)
			NextNonce(cn)

			stream.Write(append(sealedLen, sealedPayload...))

			sn := make([]byte, 12)
			if _, err := io.ReadFull(stream, sn); err != nil {
				errChan <- fmt.Errorf("stream %d read sn: %w", idx, err)
				return
			}
			sk, _ := DeriveKey([]byte(password), sn, brookInfo)
			sa, _ := NewGCMCipher(sk)

			msg := []byte(fmt.Sprintf("Concurrent stream test message %d", idx))
			dataLenBuf := make([]byte, 2)
			binary.BigEndian.PutUint16(dataLenBuf, uint16(len(msg)))
			sLen := ca.Seal(nil, cn, dataLenBuf, nil)
			NextNonce(cn)
			sPay := ca.Seal(nil, cn, msg, nil)
			NextNonce(cn)
			stream.Write(append(sLen, sPay...))

			rLen := make([]byte, 18)
			if _, err := io.ReadFull(stream, rLen); err != nil {
				errChan <- err
				return
			}
			pLen, _ := sa.Open(nil, sn, rLen, nil)
			NextNonce(sn)
			expLen := int(binary.BigEndian.Uint16(pLen))

			rPay := make([]byte, expLen+16)
			if _, err := io.ReadFull(stream, rPay); err != nil {
				errChan <- err
				return
			}
			plain, _ := sa.Open(nil, sn, rPay, nil)
			NextNonce(sn)

			if string(plain) != string(msg) {
				errChan <- fmt.Errorf("mismatch on stream %d", idx)
				return
			}
			errChan <- nil
		}(i)
	}

	for i := 0; i < concurrency; i++ {
		if err := <-errChan; err != nil {
			t.Fatalf("concurrent test failed: %v", err)
		}
	}
	t.Logf("✅ %d concurrent multiplexed WebTransport streams passed successfully!", concurrency)
}

func TestSimultaneousDualClients(t *testing.T) {
	echoAddr, cleanupEcho := startEchoServer(t)
	defer cleanupEcho()

	password := "dualpass123"
	server, err := NewServer("127.0.0.1:0", password, "", 10, 10, false)
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()

	go func() { _ = server.ListenAndServe() }()
	select {
	case <-server.Ready():
	case <-time.After(5 * time.Second):
		t.Fatal("server failed to start")
	}

	serverAddr := server.LocalAddr().String()
	t.Logf("Unified Brook Server running on %s", serverAddr)

	const totalClients = 25
	var wg sync.WaitGroup
	errChan := make(chan error, totalClients*2)

	// Launch Raw QUIC clients
	for i := 0; i < totalClients; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			tlsConf := &tls.Config{InsecureSkipVerify: true, NextProtos: []string{"brook-quic", "h3"}}
			conn, err := quic.DialAddr(context.Background(), serverAddr, tlsConf, &quic.Config{EnableDatagrams: true})
			if err != nil {
				errChan <- fmt.Errorf("QUIC dial %d: %w", idx, err)
				return
			}
			defer conn.CloseWithError(0, "")

			stream, err := conn.OpenStreamSync(context.Background())
			if err != nil {
				errChan <- fmt.Errorf("QUIC open stream %d: %w", idx, err)
				return
			}
			defer stream.Close()

			cn, _ := GenerateNonce()
			ck, _ := DeriveKey([]byte(password), cn, brookInfo)
			ca, _ := NewGCMCipher(ck)

			stream.Write(cn)

			atyp, addrB, portB, _ := ParseAddress(echoAddr)
			dstSlice := append([]byte{atyp}, addrB...)
			dstSlice = append(dstSlice, portB...)
			now := time.Now().Unix()
			if now%2 != 0 {
				now += 1
			}
			headerBody := make([]byte, 4+len(dstSlice))
			binary.BigEndian.PutUint32(headerBody[:4], uint32(now))
			copy(headerBody[4:], dstSlice)

			hdrLenBuf := make([]byte, 2)
			binary.BigEndian.PutUint16(hdrLenBuf, uint16(len(headerBody)))
			sealedLen := ca.Seal(nil, cn, hdrLenBuf, nil)
			NextNonce(cn)
			sealedPayload := ca.Seal(nil, cn, headerBody, nil)
			NextNonce(cn)

			stream.Write(append(sealedLen, sealedPayload...))

			sn := make([]byte, 12)
			if _, err := io.ReadFull(stream, sn); err != nil {
				errChan <- fmt.Errorf("QUIC read sn %d: %w", idx, err)
				return
			}
			sk, _ := DeriveKey([]byte(password), sn, brookInfo)
			sa, _ := NewGCMCipher(sk)

			msg := []byte(fmt.Sprintf("Raw QUIC echo test message from client #%d", idx))
			dataLenBuf := make([]byte, 2)
			binary.BigEndian.PutUint16(dataLenBuf, uint16(len(msg)))
			sLen := ca.Seal(nil, cn, dataLenBuf, nil)
			NextNonce(cn)
			sPay := ca.Seal(nil, cn, msg, nil)
			NextNonce(cn)
			stream.Write(append(sLen, sPay...))

			rLen := make([]byte, 18)
			if _, err := io.ReadFull(stream, rLen); err != nil {
				errChan <- fmt.Errorf("QUIC read resp len %d: %w", idx, err)
				return
			}
			pLen, _ := sa.Open(nil, sn, rLen, nil)
			NextNonce(sn)
			expLen := int(binary.BigEndian.Uint16(pLen))

			rPay := make([]byte, expLen+16)
			if _, err := io.ReadFull(stream, rPay); err != nil {
				errChan <- fmt.Errorf("QUIC read resp pay %d: %w", idx, err)
				return
			}
			plain, _ := sa.Open(nil, sn, rPay, nil)
			NextNonce(sn)

			if string(plain) != string(msg) {
				errChan <- fmt.Errorf("QUIC mismatch on #%d", idx)
				return
			}
		}(i)
	}

	// Launch WebTransport clients
	for i := 0; i < totalClients; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			tlsConf := &tls.Config{InsecureSkipVerify: true, NextProtos: []string{"h3"}}
			d := webtransport.Dialer{TLSClientConfig: tlsConf}
			_, sess, err := d.Dial(context.Background(), fmt.Sprintf("https://%s/brook", serverAddr), nil)
			if err != nil {
				errChan <- fmt.Errorf("WT dial %d: %w", idx, err)
				return
			}
			defer sess.CloseWithError(0, "")

			stream, err := sess.OpenStreamSync(context.Background())
			if err != nil {
				errChan <- fmt.Errorf("WT open stream %d: %w", idx, err)
				return
			}
			defer stream.Close()

			cn, _ := GenerateNonce()
			ck, _ := DeriveKey([]byte(password), cn, brookInfo)
			ca, _ := NewGCMCipher(ck)

			stream.Write(cn)

			atyp, addrB, portB, _ := ParseAddress(echoAddr)
			dstSlice := append([]byte{atyp}, addrB...)
			dstSlice = append(dstSlice, portB...)
			now := time.Now().Unix()
			if now%2 != 0 {
				now += 1
			}
			headerBody := make([]byte, 4+len(dstSlice))
			binary.BigEndian.PutUint32(headerBody[:4], uint32(now))
			copy(headerBody[4:], dstSlice)

			hdrLenBuf := make([]byte, 2)
			binary.BigEndian.PutUint16(hdrLenBuf, uint16(len(headerBody)))
			sealedLen := ca.Seal(nil, cn, hdrLenBuf, nil)
			NextNonce(cn)
			sealedPayload := ca.Seal(nil, cn, headerBody, nil)
			NextNonce(cn)

			stream.Write(append(sealedLen, sealedPayload...))

			sn := make([]byte, 12)
			if _, err := io.ReadFull(stream, sn); err != nil {
				errChan <- fmt.Errorf("WT read sn %d: %w", idx, err)
				return
			}
			sk, _ := DeriveKey([]byte(password), sn, brookInfo)
			sa, _ := NewGCMCipher(sk)

			msg := []byte(fmt.Sprintf("WebTransport echo test message from client #%d", idx))
			dataLenBuf := make([]byte, 2)
			binary.BigEndian.PutUint16(dataLenBuf, uint16(len(msg)))
			sLen := ca.Seal(nil, cn, dataLenBuf, nil)
			NextNonce(cn)
			sPay := ca.Seal(nil, cn, msg, nil)
			NextNonce(cn)
			stream.Write(append(sLen, sPay...))

			rLen := make([]byte, 18)
			if _, err := io.ReadFull(stream, rLen); err != nil {
				errChan <- fmt.Errorf("WT read resp len %d: %w", idx, err)
				return
			}
			pLen, _ := sa.Open(nil, sn, rLen, nil)
			NextNonce(sn)
			expLen := int(binary.BigEndian.Uint16(pLen))

			rPay := make([]byte, expLen+16)
			if _, err := io.ReadFull(stream, rPay); err != nil {
				errChan <- fmt.Errorf("WT read resp pay %d: %w", idx, err)
				return
			}
			plain, _ := sa.Open(nil, sn, rPay, nil)
			NextNonce(sn)

			if string(plain) != string(msg) {
				errChan <- fmt.Errorf("WT mismatch on #%d", idx)
				return
			}
		}(i)
	}

	wg.Wait()
	close(errChan)

	for err := range errChan {
		t.Fatalf("Simultaneous dual client error: %v", err)
	}
	t.Logf("🎉 %d Raw QUIC + %d WebTransport clients simultaneously verified on SAME port with 0 errors!", totalClients, totalClients)
}
