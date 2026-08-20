package main

import (
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"strconv"
	"syscall"
)

func main() {
	// Flags
	flagAddr := flag.String("l", "", "Listen address (e.g. :4433 or 0.0.0.0:4433)")
	flagPassword := flag.String("p", "", "Brook secret password")
	flagDomain := flag.String("domain", "", "Domain name for TLS autocert")
	flagWithoutBrook := flag.Bool("withoutbrook", false, "Enable WithoutBrook unencrypted stream mode")
	flagTCPTimeout := flag.Int("tcp-timeout", 0, "TCP connection idle timeout in seconds (0 for no timeout)")
	flagUDPTimeout := flag.Int("udp-timeout", 60, "UDP connection timeout in seconds")
	flag.Parse()

	// Environment variable fallback (matches fly.io and likev/brook-quic environment vars)
	addr := *flagAddr
	if addr == "" {
		if p := os.Getenv("PORT_UDP"); p != "" {
			addr = ":" + p
		} else if p := os.Getenv("PORT"); p != "" {
			addr = ":" + p
		} else if p := os.Getenv("LISTEN_ADDR"); p != "" {
			addr = p
		} else {
			addr = ":4433"
		}
	}

	password := *flagPassword
	if password == "" {
		if p := os.Getenv("SECRET_WS"); p != "" {
			password = p
		} else if p := os.Getenv("PASSWORD"); p != "" {
			password = p
		} else if p := os.Getenv("BROOK_PASSWORD"); p != "" {
			password = p
		} else {
			password = "271828brook"
		}
	}

	domain := *flagDomain
	if domain == "" {
		domain = os.Getenv("DOMAIN")
	}

	withoutBrook := *flagWithoutBrook
	if !withoutBrook {
		if wb := os.Getenv("WITHOUT_BROOK"); wb == "true" || wb == "1" {
			withoutBrook = true
		}
	}

	tcpTimeout := *flagTCPTimeout
	if tcpTimeout == 0 && os.Getenv("TCP_TIMEOUT") != "" {
		if t, err := strconv.Atoi(os.Getenv("TCP_TIMEOUT")); err == nil {
			tcpTimeout = t
		}
	}

	udpTimeout := *flagUDPTimeout
	if udpTimeout == 60 && os.Getenv("UDP_TIMEOUT") != "" {
		if t, err := strconv.Atoi(os.Getenv("UDP_TIMEOUT")); err == nil {
			udpTimeout = t
		}
	}

	log.Println("==================================================================")
	log.Println("🌟 Brook Unified QUIC & WebTransport Server (likev/brook-quic v2.0)")
	log.Printf("🔹 Listen Addr:   %s (UDP)", addr)
	log.Printf("🔹 Domain:        %s", domain)
	log.Printf("🔹 Protocol:      QUIC (ALPN h3, brook-quic) + WebTransport (/brook)")
	log.Printf("🔹 WithoutBrook:  %v", withoutBrook)
	log.Printf("🔹 Timeouts:      TCP: %ds, UDP: %ds", tcpTimeout, udpTimeout)
	log.Println("==================================================================")

	server, err := NewServer(addr, password, domain, tcpTimeout, udpTimeout, withoutBrook)
	if err != nil {
		log.Fatalf("❌ Failed to initialize server: %v", err)
	}

	// Handle graceful shutdown
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)

	go func() {
		<-sigChan
		log.Println("Received termination signal, shutting down server...")
		_ = server.Close()
		os.Exit(0)
	}()

	if err := server.ListenAndServe(); err != nil {
		fmt.Printf("Server exited: %v\n", err)
	}
}
