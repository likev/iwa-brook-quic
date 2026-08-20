package main

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"io"

	"golang.org/x/crypto/hkdf"
)

// NextNonce increments the first 8 bytes of a 12-byte nonce as a little-endian uint64.
func NextNonce(nonce []byte) {
	if len(nonce) < 8 {
		return
	}
	v := binary.LittleEndian.Uint64(nonce[:8])
	binary.LittleEndian.PutUint64(nonce[:8], v+1)
}

// DeriveKey derives a 32-byte AES-GCM key using HKDF-SHA256.
func DeriveKey(password, nonce []byte, info []byte) ([]byte, error) {
	key := make([]byte, 32)
	kdf := hkdf.New(sha256.New, password, nonce, info)
	if _, err := io.ReadFull(kdf, key); err != nil {
		return nil, err
	}
	return key, nil
}

// NewGCMCipher creates an AEAD cipher for the given 32-byte key.
func NewGCMCipher(key []byte) (cipher.AEAD, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

// GenerateNonce creates 12 cryptographically random bytes.
func GenerateNonce() ([]byte, error) {
	nonce := make([]byte, 12)
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, err
	}
	return nonce, nil
}

// SHA256Bytes returns the SHA-256 hash of data.
func SHA256Bytes(data []byte) []byte {
	h := sha256.Sum256(data)
	return h[:]
}
