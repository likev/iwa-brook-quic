package main

import (
	"context"
	"crypto/tls"
	"encoding/binary"
	"fmt"
	"io"
	"net"
	"net/http"
	"runtime"
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

func TestAutoDetectWithoutBrookProtocol(t *testing.T) {
	echoAddr, cleanupEcho := startEchoServer(t)
	defer cleanupEcho()

	password := "autodetect_secret_pass_999"
	// Server started with withoutBrook=true default
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
	t.Logf("Auto-Detect Test Server running on %s", serverAddr)

	tlsConf := &tls.Config{InsecureSkipVerify: true, NextProtos: []string{"brook-quic", "h3"}}

	// Helper to run client stream with specified key
	runClient := func(keyMaterial []byte, testMsg string) error {
		conn, err := quic.DialAddr(context.Background(), serverAddr, tlsConf, &quic.Config{EnableDatagrams: true})
		if err != nil {
			return fmt.Errorf("dial: %w", err)
		}
		defer conn.CloseWithError(0, "")

		stream, err := conn.OpenStreamSync(context.Background())
		if err != nil {
			return fmt.Errorf("open stream: %w", err)
		}
		defer stream.Close()

		cn, _ := GenerateNonce()
		ck, _ := DeriveKey(keyMaterial, cn, brookInfo)
		ca, _ := NewGCMCipher(ck)

		if _, err := stream.Write(cn); err != nil {
			return err
		}

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

		if _, err := stream.Write(append(sealedLen, sealedPayload...)); err != nil {
			return err
		}

		sn := make([]byte, 12)
		if _, err := io.ReadFull(stream, sn); err != nil {
			return fmt.Errorf("read sn (auth/dial failure): %w", err)
		}
		sk, _ := DeriveKey(keyMaterial, sn, brookInfo)
		sa, _ := NewGCMCipher(sk)

		msg := []byte(testMsg)
		dataLenBuf := make([]byte, 2)
		binary.BigEndian.PutUint16(dataLenBuf, uint16(len(msg)))
		sLen := ca.Seal(nil, cn, dataLenBuf, nil)
		NextNonce(cn)
		sPay := ca.Seal(nil, cn, msg, nil)
		NextNonce(cn)
		if _, err := stream.Write(append(sLen, sPay...)); err != nil {
			return err
		}

		rLen := make([]byte, 18)
		if _, err := io.ReadFull(stream, rLen); err != nil {
			return fmt.Errorf("read resp len: %w", err)
		}
		pLen, err := sa.Open(nil, sn, rLen, nil)
		if err != nil {
			return fmt.Errorf("open resp len: %w", err)
		}
		NextNonce(sn)
		expLen := int(binary.BigEndian.Uint16(pLen))

		rPay := make([]byte, expLen+16)
		if _, err := io.ReadFull(stream, rPay); err != nil {
			return fmt.Errorf("read resp pay: %w", err)
		}
		plain, err := sa.Open(nil, sn, rPay, nil)
		if err != nil {
			return fmt.Errorf("open resp pay: %w", err)
		}
		NextNonce(sn)

		if string(plain) != testMsg {
			return fmt.Errorf("payload mismatch: expected %q, got %q", testMsg, string(plain))
		}
		return nil
	}

	// 1. Test Client with withoutBrook = true (SHA256 of password)
	t.Run("withoutBrook = true (SHA256 key)", func(t *testing.T) {
		passHash := SHA256Bytes([]byte(password))
		if err := runClient(passHash, "Hello from withoutBrook=true client!"); err != nil {
			t.Fatalf("withoutBrook=true client failed: %v", err)
		}
		t.Log("✅ withoutBrook=true client verified successfully")
	})

	// 2. Test Client with withoutBrook = false (raw password bytes)
	t.Run("withoutBrook = false (Raw password key)", func(t *testing.T) {
		rawPass := []byte(password)
		if err := runClient(rawPass, "Hello from legacy raw withoutBrook=false client!"); err != nil {
			t.Fatalf("withoutBrook=false client failed: %v", err)
		}
		t.Log("✅ withoutBrook=false client verified successfully")
	})

	// 3. Test Client with wrong password (must be rejected)
	t.Run("Wrong password rejected", func(t *testing.T) {
		wrongPass := []byte("incorrect_password")
		err := runClient(wrongPass, "This should fail")
		if err == nil {
			t.Fatal("expected wrong password client to fail, but it succeeded")
		}
		t.Logf("✅ Wrong password client rejected as expected: %v", err)
	})
}

func TestConnectionCleanupAfterRawQUIC(t *testing.T) {
	echoAddr, cleanupEcho := startEchoServer(t)
	defer cleanupEcho()

	password := "cleanup-quic-test"
	server, err := NewServer("127.0.0.1:0", password, "", 2, 2, false)
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

	// Measure baseline goroutines
	runtime.GC()
	time.Sleep(200 * time.Millisecond)
	baseline := runtime.NumGoroutine()
	t.Logf("Baseline goroutines: %d", baseline)

	// Connect, do echo, disconnect
	for i := 0; i < 10; i++ {
		func() {
			tlsConf := &tls.Config{InsecureSkipVerify: true, NextProtos: []string{"brook-quic"}}
			conn, err := quic.DialAddr(context.Background(), serverAddr, tlsConf, &quic.Config{EnableDatagrams: true})
			if err != nil {
				t.Fatalf("dial %d: %v", i, err)
			}
			defer conn.CloseWithError(0, "")

			stream, err := conn.OpenStreamSync(context.Background())
			if err != nil {
				t.Fatalf("open stream %d: %v", i, err)
			}

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
			io.ReadFull(stream, sn)
			sk, _ := DeriveKey([]byte(password), sn, brookInfo)
			sa, _ := NewGCMCipher(sk)

			testData := []byte(fmt.Sprintf("cleanup-test-%d", i))
			dataLenBuf := make([]byte, 2)
			binary.BigEndian.PutUint16(dataLenBuf, uint16(len(testData)))
			sLen := ca.Seal(nil, cn, dataLenBuf, nil)
			NextNonce(cn)
			sPay := ca.Seal(nil, cn, testData, nil)
			NextNonce(cn)
			stream.Write(append(sLen, sPay...))

			rLen := make([]byte, 18)
			io.ReadFull(stream, rLen)
			pLen, _ := sa.Open(nil, sn, rLen, nil)
			NextNonce(sn)
			expLen := int(binary.BigEndian.Uint16(pLen))
			rPay := make([]byte, expLen+16)
			io.ReadFull(stream, rPay)
			sa.Open(nil, sn, rPay, nil)

			stream.Close()
		}()
	}

	// Wait for goroutines to wind down (quic-go transport goroutines need time)
	runtime.GC()
	time.Sleep(5 * time.Second)
	runtime.GC()

	current := runtime.NumGoroutine()
	t.Logf("After 10 connections: %d goroutines (baseline was %d)", current, baseline)

	// Allow margin for quic-go internal transport goroutines that linger
	if current > baseline+30 {
		t.Errorf("possible goroutine leak: baseline=%d, current=%d (delta=%d)", baseline, current, current-baseline)
	}
}

func TestConnectionCleanupAfterWebTransport(t *testing.T) {
	echoAddr, cleanupEcho := startEchoServer(t)
	defer cleanupEcho()

	password := "cleanup-wt-test"
	server, err := NewServer("127.0.0.1:0", password, "", 2, 2, false)
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

	runtime.GC()
	time.Sleep(200 * time.Millisecond)
	baseline := runtime.NumGoroutine()
	t.Logf("Baseline goroutines: %d", baseline)

	for i := 0; i < 10; i++ {
		func() {
			var clientConn quic.EarlyConnection
			tlsConf := &tls.Config{InsecureSkipVerify: true, NextProtos: []string{"h3"}}
			d := webtransport.Dialer{
				TLSClientConfig: tlsConf,
				DialAddr: func(ctx context.Context, addr string, tlsCfg *tls.Config, cfg *quic.Config) (quic.EarlyConnection, error) {
					c, err := quic.DialAddrEarly(ctx, addr, tlsCfg, cfg)
					if err == nil {
						clientConn = c
					}
					return c, err
				},
			}
			defer d.Close()
			defer func() {
				if clientConn != nil {
					clientConn.CloseWithError(0, "")
				}
			}()
			_, sess, err := d.Dial(context.Background(), fmt.Sprintf("https://%s/brook", serverAddr), nil)
			if err != nil {
				t.Fatalf("WT dial %d: %v", i, err)
			}
			defer sess.CloseWithError(0, "")

			stream, err := sess.OpenStreamSync(context.Background())
			if err != nil {
				t.Fatalf("WT open stream %d: %v", i, err)
			}

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
			io.ReadFull(stream, sn)
			sk, _ := DeriveKey([]byte(password), sn, brookInfo)
			sa, _ := NewGCMCipher(sk)

			testData := []byte(fmt.Sprintf("wt-cleanup-test-%d", i))
			dataLenBuf := make([]byte, 2)
			binary.BigEndian.PutUint16(dataLenBuf, uint16(len(testData)))
			sLen := ca.Seal(nil, cn, dataLenBuf, nil)
			NextNonce(cn)
			sPay := ca.Seal(nil, cn, testData, nil)
			NextNonce(cn)
			stream.Write(append(sLen, sPay...))

			rLen := make([]byte, 18)
			io.ReadFull(stream, rLen)
			pLen, _ := sa.Open(nil, sn, rLen, nil)
			NextNonce(sn)
			expLen := int(binary.BigEndian.Uint16(pLen))
			rPay := make([]byte, expLen+16)
			io.ReadFull(stream, rPay)
			sa.Open(nil, sn, rPay, nil)

			stream.Close()
		}()
	}

	runtime.GC()
	time.Sleep(5 * time.Second)
	runtime.GC()

	current := runtime.NumGoroutine()
	t.Logf("After 10 WT connections: %d goroutines (baseline was %d)", current, baseline)

	if current > baseline+30 {
		buf := make([]byte, 1024*1024)
		n := runtime.Stack(buf, true)
		t.Logf("Running goroutines:\n%s", string(buf[:n]))
		t.Errorf("possible goroutine leak: baseline=%d, current=%d (delta=%d)", baseline, current, current-baseline)
	}
}

func TestProbeTimeoutCleansUp(t *testing.T) {
	password := "probe-timeout-test"
	server, err := NewServer("127.0.0.1:0", password, "", 2, 2, false)
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

	runtime.GC()
	time.Sleep(200 * time.Millisecond)
	baseline := runtime.NumGoroutine()
	t.Logf("Baseline goroutines: %d", baseline)

	// Connect with h3 ALPN but never open any streams — should trigger probe timeout
	for i := 0; i < 5; i++ {
		func() {
			tlsConf := &tls.Config{InsecureSkipVerify: true, NextProtos: []string{"h3"}}
			conn, err := quic.DialAddr(context.Background(), serverAddr, tlsConf, &quic.Config{EnableDatagrams: true})
			if err != nil {
				t.Fatalf("dial %d: %v", i, err)
			}
			// Don't open any streams, just wait for server to timeout
			time.Sleep(4 * time.Second)
			conn.CloseWithError(0, "test done")
		}()
	}

	runtime.GC()
	time.Sleep(5 * time.Second)
	runtime.GC()

	current := runtime.NumGoroutine()
	t.Logf("After 5 probe-timeout connections: %d goroutines (baseline was %d)", current, baseline)

	if current > baseline+20 {
		t.Errorf("possible goroutine leak from probe timeouts: baseline=%d, current=%d (delta=%d)", baseline, current, current-baseline)
	}
}

func TestManyConnectionsNoGoroutineLeak(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping stress test in short mode")
	}

	echoAddr, cleanupEcho := startEchoServer(t)
	defer cleanupEcho()

	password := "stress-leak-test"
	server, err := NewServer("127.0.0.1:0", password, "", 2, 2, false)
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

	runtime.GC()
	time.Sleep(500 * time.Millisecond)
	baseline := runtime.NumGoroutine()
	t.Logf("Baseline goroutines: %d", baseline)

	const N = 50
	var wg sync.WaitGroup

	for i := 0; i < N; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			tlsConf := &tls.Config{InsecureSkipVerify: true, NextProtos: []string{"brook-quic"}}
			conn, err := quic.DialAddr(context.Background(), serverAddr, tlsConf, &quic.Config{EnableDatagrams: true})
			if err != nil {
				t.Errorf("dial %d: %v", idx, err)
				return
			}
			defer conn.CloseWithError(0, "")

			stream, err := conn.OpenStreamSync(context.Background())
			if err != nil {
				t.Errorf("open stream %d: %v", idx, err)
				return
			}

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
				t.Errorf("read sn %d: %v", idx, err)
				return
			}
			sk, _ := DeriveKey([]byte(password), sn, brookInfo)
			sa, _ := NewGCMCipher(sk)

			testData := []byte(fmt.Sprintf("stress-%d", idx))
			dataLenBuf := make([]byte, 2)
			binary.BigEndian.PutUint16(dataLenBuf, uint16(len(testData)))
			sLen := ca.Seal(nil, cn, dataLenBuf, nil)
			NextNonce(cn)
			sPay := ca.Seal(nil, cn, testData, nil)
			NextNonce(cn)
			stream.Write(append(sLen, sPay...))

			rLen := make([]byte, 18)
			if _, err := io.ReadFull(stream, rLen); err != nil {
				t.Errorf("read resp len %d: %v", idx, err)
				return
			}
			pLen, _ := sa.Open(nil, sn, rLen, nil)
			NextNonce(sn)
			expLen := int(binary.BigEndian.Uint16(pLen))
			rPay := make([]byte, expLen+16)
			if _, err := io.ReadFull(stream, rPay); err != nil {
				t.Errorf("read resp pay %d: %v", idx, err)
				return
			}
			plain, _ := sa.Open(nil, sn, rPay, nil)
			if string(plain) != string(testData) {
				t.Errorf("mismatch %d: expected %q got %q", idx, string(testData), string(plain))
			}

			stream.Close()
		}(i)
	}

	wg.Wait()

	// Allow goroutines to settle (quic-go transport goroutines need time)
	runtime.GC()
	time.Sleep(5 * time.Second)
	runtime.GC()

	current := runtime.NumGoroutine()
	t.Logf("After %d connections: %d goroutines (baseline was %d, delta=%d)", N, current, baseline, current-baseline)

	// With the leak fixed, goroutine count should return close to baseline.
	// Allow margin for quic-go internal transport goroutines that linger.
	if current > baseline+50 {
		t.Errorf("goroutine leak detected: baseline=%d, current=%d (delta=%d, expected <50)", baseline, current, current-baseline)
	} else {
		t.Logf("✅ No goroutine leak: %d goroutines within acceptable range of baseline %d", current, baseline)
	}
}
