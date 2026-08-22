/**
 * Network Monitor & Active Connectivity Health Prober.
 * Continuously validates internet connectivity against 3 CORS-enabled public HTTPS endpoints.
 * Checks every 5s with a 3s timeout per endpoint.
 *
 * Rules:
 *  - If ALL 3 endpoints fail -> OFFLINE.
 *  - If ANY 1 endpoint succeeds -> ONLINE.
 *
 * URLs selected from ../help/online-urls.md:
 *  1. ipify:        https://api.ipify.org?format=json
 *  2. Open-Meteo:   https://api.open-meteo.com/v1/forecast?latitude=52.52&longitude=13.41&current_weather=true
 *  3. Cat Facts:    https://catfact.ninja/fact
 */

export const PROBE_URLS = [
  'https://api.ipify.org?format=json',
  'https://api.open-meteo.com/v1/forecast?latitude=52.52&longitude=13.41&current_weather=true',
  'https://catfact.ninja/fact'
];

export class NetworkMonitor {
  constructor({
    probeUrls = PROBE_URLS,
    checkIntervalMs = 5000,
    timeoutMs = 3000,
    onStatusChange = null,
    onLog = null
  } = {}) {
    this.probeUrls = [...probeUrls];
    this.checkIntervalMs = checkIntervalMs;
    this.timeoutMs = timeoutMs;
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

      this.lastCheckTime = Date.now();
      const wasOnline = this.isOnline;
      this.isOnline = anySuccess;

      if (wasOnline !== anySuccess) {
        if (!anySuccess) {
          this._log('warning', `⚠️ Network offline: All ${this.probeUrls.length} probe endpoints failed (timeout: ${this.timeoutMs}ms).`);
        } else {
          this._log('success', `🌐 Network online: Connectivity verified across probe endpoints.`);
        }
        if (this.onStatusChange) {
          try {
            this.onStatusChange(anySuccess);
          } catch (e) {}
        }
      }

      return anySuccess;
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
