/**
 * Network Monitor & Active Connectivity Health Prober.
 * Continuously validates internet connectivity against 3 CORS-enabled public HTTPS endpoints.
 * Checks every 5s with a 3s timeout per endpoint.
 *
 * Rules:
 *  - If ALL 3 endpoints fail -> OFFLINE.
 *  - If ANY 1 endpoint succeeds -> ONLINE.
 *
 * URLs selected from ../help/online-urls.md (all verified HTTP/3 + CORS *):
 *  1. Dog CEO:    https://dog.ceo/api/breeds/image/random
 *  2. Cat Facts:  https://catfact.ninja/fact
 *  3. cdnjs API:  https://api.cdnjs.com/libraries/lodash.js?fields=name,version,description
 */

export const PROBE_URLS = [
  'https://dog.ceo/api/breeds/image/random',
  'https://catfact.ninja/fact',
  'https://api.cdnjs.com/libraries/lodash.js?fields=name,version,description'
];

export class NetworkMonitor {
  constructor({
    probeUrls = PROBE_URLS,
    checkIntervalMs = 5000,
    timeoutMs = 3000,
    maxConsecutiveFailures = 2,
    recentTrafficCheck = null,
    onStatusChange = null,
    onLog = null
  } = {}) {
    this.probeUrls = [...probeUrls];
    this.checkIntervalMs = checkIntervalMs;
    this.timeoutMs = timeoutMs;
    this.maxConsecutiveFailures = Math.max(1, maxConsecutiveFailures);
    this.consecutiveFailures = 0;
    this.recentTrafficCheck = recentTrafficCheck;
    this.onStatusChange = onStatusChange;
    this.onLog = onLog;

    this.isOnline = true;
    this.isChecking = false;
    this.isRunning = false;
    this.intervalId = null;
    this.lastCheckTime = 0;
  }

  _log(level, message, meta = null) {
    if (this.onLog) {
      this.onLog(level, message, meta);
    }
  }

  /**
   * Execute a single active connectivity check across all 3 URLs in parallel with 3s timeout.
   * @returns {Promise<boolean>} true if at least 1 URL succeeds, false if all fail
   */
  async checkOnce() {
    if (this.isChecking) return this.isOnline;
    this.isChecking = true;

    try {
      const probePromises = this.probeUrls.map(async (url) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
          const resp = await fetch(url, {
            method: 'GET',
            mode: 'cors',
            cache: 'no-store',
            signal: controller.signal
          });
          clearTimeout(timer);
          return resp.ok;
        } catch (err) {
          clearTimeout(timer);
          return false;
        }
      });

      const results = await Promise.allSettled(probePromises);
      const anySuccess = results.some((r) => r.status === 'fulfilled' && r.value === true);
      let hasRecentTraffic = false;
      if (!anySuccess && typeof this.recentTrafficCheck === 'function') {
        try {
          hasRecentTraffic = Boolean(this.recentTrafficCheck());
        } catch (e) {}
      }

      this.lastCheckTime = Date.now();
      const wasOnline = this.isOnline;

      // Asymmetric hysteresis: recover immediately on 1 success (or active Brook QUIC traffic),
      // require maxConsecutiveFailures consecutive probe failures before transitioning offline.
      if (anySuccess || hasRecentTraffic) {
        this.consecutiveFailures = 0;
        this.isOnline = true;
      } else {
        this.consecutiveFailures++;
        if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
          this.isOnline = false;
        }
      }

      if (wasOnline !== this.isOnline) {
        if (!this.isOnline) {
          this._log('warning', `⚠️ Network offline: All ${this.probeUrls.length} probe endpoints failed ${this.consecutiveFailures}x consecutively (timeout: ${this.timeoutMs}ms).`);
        } else {
          this._log('success', `🌐 Network online: Connectivity verified across probe endpoints.`);
        }
        if (this.onStatusChange) {
          try {
            this.onStatusChange(this.isOnline);
          } catch (e) {}
        }
      }

      return anySuccess || hasRecentTraffic;
    } finally {
      this.isChecking = false;
    }
  }

  /**
   * Start periodic connectivity probing every 5 seconds.
   */
  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    // Initial check immediately
    this.checkOnce().catch(() => {});
    this.intervalId = setInterval(() => {
      this.checkOnce().catch(() => {});
    }, this.checkIntervalMs);
  }

  /**
   * Stop periodic connectivity probing.
   */
  stop() {
    this.isRunning = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}
