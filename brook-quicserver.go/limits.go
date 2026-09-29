//go:build !windows

package main

import (
	"context"
	"log"
	"os/exec"
	"runtime"
	"syscall"
	"time"
)

// RaiseLimits raises system file descriptor and socket buffer limits.
func RaiseLimits() {
	var rLimit syscall.Rlimit
	if err := syscall.Getrlimit(syscall.RLIMIT_NOFILE, &rLimit); err == nil {
		rLimit.Cur = rLimit.Max
		_ = syscall.Setrlimit(syscall.RLIMIT_NOFILE, &rLimit)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	if runtime.GOOS == "linux" {
		c := exec.CommandContext(ctx, "sysctl", "-w", "net.core.rmem_max=2500000")
		if out, err := c.CombinedOutput(); err != nil {
			log.Printf("[limits] Warning raising UDP receive buffer: %s %v", string(out), err)
		}
	}
	if runtime.GOOS == "darwin" {
		c := exec.CommandContext(ctx, "sysctl", "-w", "kern.ipc.maxsockbuf=3014656")
		if out, err := c.CombinedOutput(); err != nil {
			log.Printf("[limits] Warning raising UDP receive buffer: %s %v", string(out), err)
		}
	}
}
