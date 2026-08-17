/**
 * Session Tracker and Real-Time Telemetry / Speed Engine.
 */

export class SessionTracker {
  constructor({ onStatsUpdate }) {
    this.onStatsUpdate = onStatsUpdate;

    this.sessions = new Map(); // id -> sessionObj
    this.nextSessionId = 1;

    this.totalBytesSent = 0;
    this.totalBytesReceived = 0;
    this.totalSessionsCount = 0;

    // Rate calculation history
    this.lastBytesSent = 0;
    this.lastBytesReceived = 0;
    this.lastTimestamp = Date.now();
    this.currentUploadSpeed = 0; // Bytes/sec
    this.currentDownloadSpeed = 0; // Bytes/sec

    this.tickerInterval = null;
    this._startTicker();
  }

  _startTicker() {
    this.tickerInterval = setInterval(() => {
      const now = Date.now();
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
    return {
      activeSessions: this.sessions.size,
      totalSessions: this.totalSessionsCount,
      totalBytesSent: this.totalBytesSent,
      totalBytesReceived: this.totalBytesReceived,
      uploadSpeed: this.currentUploadSpeed,
      downloadSpeed: this.currentDownloadSpeed,
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
