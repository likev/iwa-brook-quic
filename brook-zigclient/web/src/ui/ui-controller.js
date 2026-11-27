/**
 * UI Controller for Brook Zig Client.
 * Binds DOM elements to the Web Worker Proxy Engine, telemetry gauges,
 * and persists configuration via the Zig host (/api/config) across random ports.
 */

import { DomBuilder } from './dom-builder.js';
import { formatBytes, formatSpeed, parseHostPort } from '../core/byte-utils.js';
import { ConnectionState } from '../webtransport/wt-connection-manager.js';

export class UiController {
  constructor({
    onStart,
    onStop,
    logStream,
    token = '',
    initialConfig = null
  }) {
    this.onStart = onStart;
    this.onStop = onStop;
    this.logStream = logStream;
    this.token = token;

    this.isRunning = false;
    this._bindElements();
    this._attachEventListeners();
    this._loadSettings(initialConfig);
    this._updateCommandPreviews();
  }

  _bindElements() {
    this.inputServer = document.getElementById('input-server');
    this.inputPassword = document.getElementById('input-password');
    this.inputSocks5Port = document.getElementById('input-socks5-port');
    this.inputHttpPort = document.getElementById('input-http-port');
    this.toggleAutoDetect = document.getElementById('toggle-autodetect');
    this.toggleWithoutBrook = document.getElementById('toggle-without-brook');

    this.btnToggle = document.getElementById('btn-toggle');
    this.statusBadge = document.getElementById('status-badge');
    this.statusDetail = document.getElementById('status-detail');
    this.bridgeBadge = document.getElementById('bridge-badge');

    this.statSpeedDown = document.getElementById('stat-speed-down');
    this.statSpeedUp = document.getElementById('stat-speed-up');
    this.statTotalDown = document.getElementById('stat-total-down');
    this.statTotalUp = document.getElementById('stat-total-up');
    this.statActiveSessions = document.getElementById('stat-active-sessions');
    this.statTotalSessions = document.getElementById('stat-total-sessions');

    this.sessionTableBody = document.getElementById('session-table-body');
    this.emptySessionNotice = document.getElementById('empty-session-notice');

    this.btnCopySocksCurl = document.getElementById('btn-copy-socks-curl');
    this.btnCopyHttpCurl = document.getElementById('btn-copy-http-curl');
    this.codeSocksCurl = document.getElementById('code-socks-curl');
    this.codeHttpCurl = document.getElementById('code-http-curl');

    this.selectLogFilter = document.getElementById('select-log-filter');
    this.btnCopyLogs = document.getElementById('btn-copy-logs');
    this.btnClearLogs = document.getElementById('btn-clear-logs');
  }

  _attachEventListeners() {
    this.btnToggle?.addEventListener('click', () => {
      if (this.isRunning) {
        this.handleStop();
      } else {
        this.handleStart();
      }
    });

    this.selectLogFilter?.addEventListener('change', (e) => {
      this.logStream.setFilter(e.target.value);
    });

    this.btnClearLogs?.addEventListener('click', () => {
      this.logStream.clear();
    });

    this.btnCopyLogs?.addEventListener('click', async () => {
      const stats = this.lastStats || {};
      const snap = stats.transportSnapshot || {};
      const logText = this.logStream.getFormattedLogs(true);
      const totalCount = this.logStream.getTotalLogsCount();
      const reportHeader = [
        `================================================================`,
        `  BROOK QUIC ZIG CLIENT (WEB WORKER) - DIAGNOSTIC REPORT & LOG`,
        `  Generated: ${new Date().toISOString()}`,
        `================================================================`,
        `  Connection Status:    ${this.statusBadge?.textContent || 'STOPPED'}`,
        `  Bridge Status:        ${this.bridgeBadge?.textContent || 'UNKNOWN'}`,
        `  Target Server:        ${this.inputServer?.value || 'N/A'}`,
        `  Download Speed:       ${this.statSpeedDown?.textContent || '0 B/s'}`,
        `  Upload Speed:         ${this.statSpeedUp?.textContent || '0 B/s'}`,
        `  Total Received:       ${this.statTotalDown?.textContent || '0 B'}`,
        `  Total Sent:           ${this.statTotalUp?.textContent || '0 B'}`,
        `  Active Streams:       ${this.statActiveSessions?.textContent || '0'}`,
        `  Total Sessions:       ${this.statTotalSessions?.textContent || '0'}`,
        `----------------------------------------------------------------`,
        `  TRANSPORT SNAPSHOT JSON:`,
        JSON.stringify(snap, null, 2),
        `================================================================`,
        `\n--- COMPLETE LOG ENTRIES SINCE APP START (${totalCount} entries) ---\n`
      ].join('\n');

      const fullReport = reportHeader + logText;

      try {
        await navigator.clipboard.writeText(fullReport);
        this._showToast('📋 Diagnostic report & logs copied to clipboard!');
      } catch (err) {
        try {
          const textarea = document.createElement('textarea');
          textarea.value = fullReport;
          textarea.style.position = 'fixed';
          textarea.style.opacity = '0';
          document.body.appendChild(textarea);
          textarea.select();
          document.execCommand('copy');
          document.body.removeChild(textarea);
          this._showToast('📋 Diagnostic report & logs copied to clipboard!');
        } catch (e2) {
          this._showToast('Failed to copy to clipboard');
        }
      }
    });

    this.btnCopySocksCurl?.addEventListener('click', () => {
      const port = this.inputSocks5Port?.value || '10808';
      const cmd = `curl -x socks5h://127.0.0.1:${port} https://httpbin.org/ip`;
      navigator.clipboard.writeText(cmd).then(() => {
        this._showToast('Copied SOCKS5 curl command!');
      });
    });

    this.btnCopyHttpCurl?.addEventListener('click', () => {
      const isAuto = this.toggleAutoDetect?.checked;
      const port = isAuto ? (this.inputSocks5Port?.value || '10808') : (this.inputHttpPort?.value || '8080');
      const cmd = `curl -x http://127.0.0.1:${port} https://httpbin.org/ip`;
      navigator.clipboard.writeText(cmd).then(() => {
        this._showToast('Copied HTTP Proxy curl command!');
      });
    });

    this.toggleAutoDetect?.addEventListener('change', () => {
      this._updatePortInputVisibility();
      this._updateCommandPreviews();
    });

    this.inputSocks5Port?.addEventListener('input', () => this._updateCommandPreviews());
    this.inputHttpPort?.addEventListener('input', () => this._updateCommandPreviews());
  }

  _updateCommandPreviews() {
    const isAuto = !!this.toggleAutoDetect?.checked;
    const s5Port = this.inputSocks5Port?.value || '10808';
    const httpPort = isAuto ? s5Port : (this.inputHttpPort?.value || '8080');

    if (this.codeSocksCurl) {
      this.codeSocksCurl.textContent = `curl -x socks5h://127.0.0.1:${s5Port} https://httpbin.org/ip`;
    }
    if (this.codeHttpCurl) {
      this.codeHttpCurl.textContent = `curl -x http://127.0.0.1:${httpPort} https://httpbin.org/ip`;
    }
  }

  _updatePortInputVisibility() {
    const isAuto = this.toggleAutoDetect?.checked;
    const httpGroup = document.getElementById('group-http-port');
    if (httpGroup) {
      if (isAuto) {
        httpGroup.classList.add('hidden');
      } else {
        httpGroup.classList.remove('hidden');
      }
    }
  }

  applyConfig(cfg) {
    if (!cfg || typeof cfg !== 'object') return;
    if (cfg.server && this.inputServer) this.inputServer.value = cfg.server;
    if (cfg.password && this.inputPassword) this.inputPassword.value = cfg.password;
    if (cfg.socks5Port !== undefined && cfg.socks5Port !== null && cfg.socks5Port !== '' && this.inputSocks5Port) {
      this.inputSocks5Port.value = String(cfg.socks5Port);
    }
    if (cfg.httpPort !== undefined && cfg.httpPort !== null && cfg.httpPort !== '' && this.inputHttpPort) {
      this.inputHttpPort.value = String(cfg.httpPort);
    }
    if (cfg.autoDetect !== undefined && this.toggleAutoDetect) {
      this.toggleAutoDetect.checked = Boolean(cfg.autoDetect);
    }
    if (cfg.withoutBrook !== undefined && this.toggleWithoutBrook) {
      this.toggleWithoutBrook.checked = Boolean(cfg.withoutBrook);
    }
    this._updatePortInputVisibility();
    this._updateCommandPreviews();
  }

  _loadSettings(initialConfig) {
    if (initialConfig) {
      this.applyConfig(initialConfig);
      return;
    }
    try {
      const saved = localStorage.getItem('brook_zig_config');
      if (saved) {
        this.applyConfig(JSON.parse(saved));
      }
    } catch (e) {}
    this._updatePortInputVisibility();
  }

  _saveSettings() {
    const cfg = {
      server: this.inputServer?.value || '',
      password: this.inputPassword?.value || '',
      socks5Port: parseInt(this.inputSocks5Port?.value || '10808', 10),
      httpPort: parseInt(this.inputHttpPort?.value || '8080', 10),
      autoDetect: !!this.toggleAutoDetect?.checked,
      withoutBrook: this.toggleWithoutBrook ? !!this.toggleWithoutBrook.checked : true
    };
    try {
      localStorage.setItem('brook_zig_config', JSON.stringify(cfg));
    } catch (e) {}

    // Persist to Zig host file so config survives random-port restarts
    if (this.token) {
      fetch(`/api/config?token=${encodeURIComponent(this.token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cfg)
      }).catch(() => {});
    }
  }

  getConfig() {
    let rawServer = (this.inputServer?.value || 'https://brook-quic.pplx.io:4433/brook').trim();
    rawServer = rawServer.replace(/^quic:\/\//i, '').replace(/^https:\/\//i, '').replace(/^http:\/\//i, '');

    let path = '/brook';
    if (rawServer.includes('/')) {
      const idx = rawServer.indexOf('/');
      path = rawServer.slice(idx);
      rawServer = rawServer.slice(0, idx);
    }
    const { host: serverHost, port: serverPort } = parseHostPort(rawServer, 4433);

    const socks5Port = parseInt(this.inputSocks5Port?.value || '10808', 10);
    const httpPort = parseInt(this.inputHttpPort?.value || '8080', 10);

    return {
      serverHost,
      serverPort,
      serverPath: path,
      password: this.inputPassword?.value || '271828brook',
      socks5Port: isNaN(socks5Port) ? 10808 : socks5Port,
      httpPort: isNaN(httpPort) ? 8080 : httpPort,
      autoDetectMode: !!this.toggleAutoDetect?.checked,
      withoutBrook: this.toggleWithoutBrook ? !!this.toggleWithoutBrook.checked : true
    };
  }

  async handleStart() {
    const config = this.getConfig();

    if (config.socks5Port < 0 || config.socks5Port > 65535) {
      this._showToast(`Invalid SOCKS5 port: ${config.socks5Port}`);
      return;
    }
    if (!config.autoDetectMode && (config.httpPort < 0 || config.httpPort > 65535)) {
      this._showToast(`Invalid HTTP port: ${config.httpPort}`);
      return;
    }

    this._saveSettings();
    this._setInputsDisabled(true);
    this.btnToggle.textContent = 'Starting...';
    this.btnToggle.disabled = true;

    try {
      await this.onStart(config);
      this.isRunning = true;
      this.btnToggle.textContent = 'Stop Proxy';
      this.btnToggle.classList.remove('btn-primary');
      this.btnToggle.classList.add('btn-danger');
      this.btnToggle.disabled = false;
    } catch (err) {
      this.isRunning = false;
      this._setInputsDisabled(false);
      this.btnToggle.textContent = 'Start Proxy';
      this.btnToggle.disabled = false;
    }
  }

  async handleStop() {
    this.btnToggle.textContent = 'Stopping...';
    this.btnToggle.disabled = true;

    try {
      await this.onStop();
    } finally {
      this.isRunning = false;
      this._setInputsDisabled(false);
      this.btnToggle.textContent = 'Start Proxy';
      this.btnToggle.classList.remove('btn-danger');
      this.btnToggle.classList.add('btn-primary');
      this.btnToggle.disabled = false;
      this.updateConnectionState(ConnectionState.DISCONNECTED, 'Stopped');
      this.updateStats({
        downloadSpeed: 0,
        uploadSpeed: 0,
        totalBytesReceived: this.lastStats?.totalBytesReceived || 0,
        totalBytesSent: this.lastStats?.totalBytesSent || 0,
        activeSessions: 0,
        totalSessions: this.lastStats?.totalSessions || 0,
        activeSessionList: []
      });
    }
  }

  _setInputsDisabled(disabled) {
    if (this.inputServer) this.inputServer.disabled = disabled;
    if (this.inputPassword) this.inputPassword.disabled = disabled;
    if (this.inputSocks5Port) this.inputSocks5Port.disabled = disabled;
    if (this.inputHttpPort) this.inputHttpPort.disabled = disabled;
    if (this.toggleAutoDetect) this.toggleAutoDetect.disabled = disabled;
    if (this.toggleWithoutBrook) this.toggleWithoutBrook.disabled = disabled;
  }

  updateBridgeState(state, detail = '') {
    if (!this.bridgeBadge) return;
    this.bridgeBadge.className = 'status-badge';
    if (state === 'connected') {
      this.bridgeBadge.classList.add('status-connected');
      this.bridgeBadge.textContent = 'BRIDGE: OK';
    } else if (state === 'connecting' || state === 'reconnecting') {
      this.bridgeBadge.classList.add('status-connecting');
      this.bridgeBadge.textContent = 'BRIDGE: SYNC';
    } else {
      this.bridgeBadge.classList.add('status-disconnected');
      this.bridgeBadge.textContent = 'BRIDGE: OFF';
    }
    if (detail) {
      this.bridgeBadge.title = detail;
    }
  }

  updateConnectionState(state, detail = '') {
    if (!this.statusBadge) return;

    this.statusBadge.className = 'status-badge';
    if (state === ConnectionState.CONNECTED) {
      this.statusBadge.classList.add('status-connected');
      this.statusBadge.textContent = 'CONNECTED';
    } else if (state === ConnectionState.CONNECTING || state === 'reconnecting') {
      this.statusBadge.classList.add('status-connecting');
      this.statusBadge.textContent = state.toUpperCase();
    } else {
      this.statusBadge.classList.add('status-disconnected');
      this.statusBadge.textContent = 'STOPPED';
    }

    if (this.statusDetail) {
      this.statusDetail.textContent = detail;
    }
  }

  updateStats(stats) {
    this.lastStats = stats;
    if (this.statSpeedDown) this.statSpeedDown.textContent = formatSpeed(stats.downloadSpeed);
    if (this.statSpeedUp) this.statSpeedUp.textContent = formatSpeed(stats.uploadSpeed);
    if (this.statTotalDown) this.statTotalDown.textContent = formatBytes(stats.totalBytesReceived);
    if (this.statTotalUp) this.statTotalUp.textContent = formatBytes(stats.totalBytesSent);
    if (this.statActiveSessions) this.statActiveSessions.textContent = String(stats.activeSessions);
    if (this.statTotalSessions) this.statTotalSessions.textContent = String(stats.totalSessions);

    this._renderSessionTable(stats.activeSessionList);
  }

  _renderSessionTable(sessions) {
    if (!this.sessionTableBody) return;
    DomBuilder.clear(this.sessionTableBody);

    if (!sessions || sessions.length === 0) {
      if (this.emptySessionNotice) this.emptySessionNotice.classList.remove('hidden');
      return;
    }

    if (this.emptySessionNotice) this.emptySessionNotice.classList.add('hidden');

    const MAX_DISPLAYED_SESSIONS = 25;
    const displayed = sessions.slice(0, MAX_DISPLAYED_SESSIONS);

    for (const s of displayed) {
      const durationSec = Math.round((Date.now() - s.startTime) / 1000);
      const row = DomBuilder.el('tr', {
        classes: ['session-row'],
        children: [
          DomBuilder.el('td', { classes: ['td-id'], text: `#${s.id}` }),
          DomBuilder.el('td', { classes: ['td-proto'], text: s.protocol }),
          DomBuilder.el('td', { classes: ['td-target'], text: s.target }),
          DomBuilder.el('td', { classes: ['td-traffic'], text: `↑ ${formatBytes(s.bytesSent)}  ↓ ${formatBytes(s.bytesReceived)}` }),
          DomBuilder.el('td', { classes: ['td-duration'], text: `${durationSec}s` }),
          DomBuilder.el('td', {
            classes: ['td-status'],
            children: [DomBuilder.el('span', { classes: ['badge-active'], text: 'Active' })]
          })
        ]
      });
      this.sessionTableBody.appendChild(row);
    }
  }

  updateBoundPorts({ socks5Port, httpPort }) {
    if (this.inputSocks5Port && socks5Port) {
      this.inputSocks5Port.value = socks5Port;
    }
    if (this.inputHttpPort && httpPort) {
      this.inputHttpPort.value = httpPort;
    }
    this._updateCommandPreviews();
  }

  _showToast(msg) {
    const toast = DomBuilder.el('div', {
      classes: ['toast-notification'],
      text: msg
    });
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('toast-fadeout');
      setTimeout(() => toast.remove(), 400);
    }, 2500);
  }
}
