//go:build windows

package main

// RaiseLimits is a no-op on Windows.
func RaiseLimits() {}
