package main

import (
	"context"
	"crypto/tls"
	"flag"
	"io"
	"log"
	"net"
	"os"
	"os/signal"
	"sync"
	"syscall"

	"github.com/quic-go/webtransport-go"
)

func main() {
	serverURL := flag.String("server", "https://127.0.0.1:64433/brook", "Server URL")
	localAddr := flag.String("listen", "127.0.0.1:10809", "Local listening address")
	flag.Parse()

	tlsConf := &tls.Config{
		InsecureSkipVerify: true,
		NextProtos:         []string{"h3"},
	}

	d := webtransport.Dialer{
		TLSClientConfig: tlsConf,
	}

	log.Printf("[WT-Bridge] Connecting to %s...", *serverURL)
	_, sess, err := d.Dial(context.Background(), *serverURL, nil)
	if err != nil {
		log.Fatalf("Failed to connect to %s: %v", *serverURL, err)
	}
	defer sess.CloseWithError(0, "")
	log.Printf("[WT-Bridge] Connected to WebTransport server!")

	ln, err := net.Listen("tcp", *localAddr)
	if err != nil {
		log.Fatalf("Failed to listen on %s: %v", *localAddr, err)
	}
	defer ln.Close()
	log.Printf("[WT-Bridge] Bridge listening on %s -> WebTransport streams", *localAddr)

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-sigChan
		_ = ln.Close()
		os.Exit(0)
	}()

	for {
		client, err := ln.Accept()
		if err != nil {
			return
		}

		go func(c net.Conn) {
			defer c.Close()
			stream, err := sess.OpenStreamSync(context.Background())
			if err != nil {
				log.Printf("Failed to open WT stream: %v", err)
				return
			}
			defer stream.Close()

			var wg sync.WaitGroup
			wg.Add(2)

			go func() {
				defer wg.Done()
				_, _ = io.Copy(stream, c)
				_ = stream.Close()
			}()

			go func() {
				defer wg.Done()
				_, _ = io.Copy(c, stream)
			}()

			wg.Wait()
		}(client)
	}
}
