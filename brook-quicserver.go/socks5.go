package main

import (
	"encoding/binary"
	"fmt"
	"net"
	"strconv"
)

const (
	AtypIPv4   = 0x01
	AtypDomain = 0x03
	AtypIPv6   = 0x04
)

// ToAddress converts socks5 address components into a host:port string.
func ToAddress(atyp byte, addrBytes []byte, portBytes []byte) string {
	port := binary.BigEndian.Uint16(portBytes)
	switch atyp {
	case AtypIPv4:
		if len(addrBytes) < 4 {
			return ""
		}
		ip := net.IP(addrBytes[:4])
		return fmt.Sprintf("%s:%d", ip.String(), port)
	case AtypDomain:
		// In socks5 format: first byte of addrBytes is domain length, followed by domain string
		// In Brook: addrBytes might be just the domain string if already sliced, or len-prefixed
		if len(addrBytes) == 0 {
			return ""
		}
		return fmt.Sprintf("%s:%d", string(addrBytes), port)
	case AtypIPv6:
		if len(addrBytes) < 16 {
			return ""
		}
		ip := net.IP(addrBytes[:16])
		return fmt.Sprintf("[%s]:%d", ip.String(), port)
	default:
		return ""
	}
}

// ParseBrookDestination parses the destination slice from a Brook stream header.
// dst slice format: [ATYP (1B), ADDR..., PORT (2B)]
// If ATYP is 0x01: [0x01, 4 bytes IP, 2 bytes port] (total 7 bytes)
// If ATYP is 0x03: [0x03, 1 byte len, domain bytes, 2 bytes port] OR [0x03, domain bytes, 2 bytes port]
// If ATYP is 0x04: [0x04, 16 bytes IP, 2 bytes port] (total 19 bytes)
func ParseBrookDestination(dst []byte) (string, error) {
	if len(dst) < 3 {
		return "", fmt.Errorf("dst too short: %d bytes", len(dst))
	}
	atyp := dst[0]
	portBytes := dst[len(dst)-2:]
	addrBytes := dst[1 : len(dst)-2]

	switch atyp {
	case AtypIPv4:
		if len(addrBytes) != 4 {
			return "", fmt.Errorf("invalid IPv4 address length: %d", len(addrBytes))
		}
		return ToAddress(atyp, addrBytes, portBytes), nil
	case AtypDomain:
		if len(addrBytes) == 0 {
			return "", fmt.Errorf("empty domain name")
		}
		// If domain is length-prefixed:
		domainLen := int(addrBytes[0])
		if len(addrBytes) == domainLen+1 {
			return ToAddress(atyp, addrBytes[1:], portBytes), nil
		}
		return ToAddress(atyp, addrBytes, portBytes), nil
	case AtypIPv6:
		if len(addrBytes) != 16 {
			return "", fmt.Errorf("invalid IPv6 address length: %d", len(addrBytes))
		}
		return ToAddress(atyp, addrBytes, portBytes), nil
	default:
		return "", fmt.Errorf("unsupported address type: 0x%02x", atyp)
	}
}

// ParseAddress parses a standard host:port string into SOCKS5 address components.
func ParseAddress(address string) (byte, []byte, []byte, error) {
	host, portStr, err := net.SplitHostPort(address)
	if err != nil {
		return 0, nil, nil, err
	}
	portNum, err := strconv.Atoi(portStr)
	if err != nil {
		return 0, nil, nil, err
	}
	portBytes := make([]byte, 2)
	binary.BigEndian.PutUint16(portBytes, uint16(portNum))

	ip := net.ParseIP(host)
	if ip == nil {
		// Domain name
		b := []byte(host)
		return AtypDomain, b, portBytes, nil
	}
	if ip4 := ip.To4(); ip4 != nil {
		return AtypIPv4, []byte(ip4), portBytes, nil
	}
	return AtypIPv6, []byte(ip.To16()), portBytes, nil
}
