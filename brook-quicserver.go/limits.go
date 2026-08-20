package main

import (
	"log"
	"os/exec"
	"runtime"
	"syscall"
)

// RaiseLimits raises system file descriptor and socket buffer limits.
func RaiseLimits() {
	var rLimit syscall.Rlimit
	if err := syscall.Getrlimit(syscall.RLIMIT_NOFILE, &rLimit); err == nil {
		rLimit.Cur = rLimit.Max
		_ = syscall.Setrlimit(syscall.RLIMIT_NOFILE, &rLimit)
	}

	if runtime.GOOS == "linux" {
		c := exec.Command("sysctl", "-w", "net.core.rmem_max=2500000")
		if out, err := c.CombinedOutput(); err != nil {
			log.Printf("[limits] Warning raising UDP receive buffer: %s %v", string(out), err)
		}
	}
	if runtime.GOOS == "darwin" {
		c := exec.Command("sysctl", "-w", "kern.ipc.maxsockbuf=3014656")
		if out, err := c.CombinedOutput(); err != nil {
			log.Printf("[limits] Warning raising UDP receive buffer: %s %v", string(out), err)
		}
	}
}
