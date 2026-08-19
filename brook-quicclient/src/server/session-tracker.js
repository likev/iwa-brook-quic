/**
 * Session Tracker and Real-Time Telemetry / Speed Engine.
 */

export class SessionTracker {
  constructor({ onStatsUpdate, getSnapshotFn = null } = {}) {
    this.onStatsUpdate = onStatsUpdate;
    this.getSnapshotFn = getSnapshotFn;

    this.sessions = new Map(); // id -> sessionObj
    this.nextSessionId = 1;

    this.totalBytesSent = 0;
    this.totalBytesReceived = 0;
    this.totalSessionsCount = 0;

    // Rate calculation history
    this.lastBytesSent = 0;
    this.lastBytesReceived = 0;
    this.lastTimestamp = Date.now();
    this.lastPerfTime = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    this.currentUploadSpeed = 0; // Bytes/sec
    this.currentDownloadSpeed = 0; // Bytes/sec
    this.eventLoopDelayMs = 0;

    this.tickerInterval = null;
    this._startTicker();
  }

  setSnapshotProvider(fn) {
    this.getSnapshotFn = fn;
  }

  _startTicker() {
    this.tickerInterval = setInterval(() => {
      const now = Date.now();
      const perfNow = (typeof performance !== 'undefined') ? performance.now() : Date.now();
      const actualDeltaMs = perfNow - this.lastPerfTime;
      this.lastPerfTime = perfNow;
      this.eventLoopDelayMs = Math.round(Math.max(0, actualDeltaMs - 500) * 10) / 10;

      const elapsedSec = (now - this.lastTimestamp) / 1000;
      if (elapsedSec > 0) {
        const sentDelta = this.totalBytesSent - this.lastBytesSent;
        const recvDelta = this.totalBytesReceived - this.lastBytesReceived;

        this.currentUploadSpeed = Math.round(sentDelta / elapsedSec);
        this.currentDownloadSpeed = Math.round(recvDelta / elapsedSec);

        this.lastBytesSent = this.totalBytesSent;
        this.lastBytesReceived = this.totalBytesReceived;
        this.lastTimestamp = now;

        if (this.onStatsUpdate) {
          this.onStatsUpdate(this.getStats());
        }
      }
    }, 500);
  }

  createSession({ protocol, target, clientAddr = '127.0.0.1' }) {
    const id = this.nextSessionId++;
    const session = {
      id,
      protocol,
      target,
      clientAddr,
      startTime: Date.now(),
      bytesSent: 0,
      bytesReceived: 0,
      status: 'active'
    };

    this.sessions.set(id, session);
    this.totalSessionsCount++;
    return session;
  }

  recordBytes(sessionId, sentBytes = 0, receivedBytes = 0) {
    const s = this.sessions.get(sessionId);
    if (s) {
      s.bytesSent += sentBytes;
      s.bytesReceived += receivedBytes;
    }
    this.totalBytesSent += sentBytes;
    this.totalBytesReceived += receivedBytes;
  }

  closeSession(sessionId) {
    const s = this.sessions.get(sessionId);
    if (s) {
      s.status = 'closed';
      s.endTime = Date.now();
      this.sessions.delete(sessionId);
    }
  }

  getStats() {
    const transportSnapshot = this.getSnapshotFn ? this.getSnapshotFn() : {};
    transportSnapshot.eventLoopDelayMs = this.eventLoopDelayMs;

    return {
      activeSessions: this.sessions.size,
      totalSessions: this.totalSessionsCount,
      totalBytesSent: this.totalBytesSent,
      totalBytesReceived: this.totalBytesReceived,
      uploadSpeed: this.currentUploadSpeed,
      downloadSpeed: this.currentDownloadSpeed,
      eventLoopDelayMs: this.eventLoopDelayMs,
      transportSnapshot,
      activeSessionList: Array.from(this.sessions.values())
    };
  }

  destroy() {
    if (this.tickerInterval) {
      clearInterval(this.tickerInterval);
      this.tickerInterval = null;
    }
    this.sessions.clear();
  }
}
