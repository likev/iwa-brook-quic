/**
 * UI Controller: Binds DOM elements to Proxy Engine, telemetry gauges, and settings.
 */

import { DomBuilder } from './dom-builder.js';
import { formatBytes, formatSpeed, parseHostPort } from '../core/byte-utils.js';
import { ConnectionState } from '../quic/quic-connection-manager.js';
import { CHROME_RESTRICTED_PORTS } from '../server/tcp-listener.js';

export class UiController {
  constructor({
    onStart,
    onStop,
    logStream
  }) {
    this.onStart = onStart;
    this.onStop = onStop;
    this.logStream = logStream;

    this.isRunning = false;
    this._bindElements();
    this._attachEventListeners();
    this._loadSettings();
    this._updateCommandPreviews();
  }

  _bindElements() {
    // Config inputs
    this.inputServer = document.getElementById('input-server');
    this.inputPassword = document.getElementById('input-password');
    this.inputSocks5Port = document.getElementById('input-socks5-port');
    this.inputHttpPort = document.getElementById('input-http-port');
    this.toggleAutoDetect = document.getElementById('toggle-autodetect');
    this.toggleWithoutBrook = document.getElementById('toggle-without-brook');

    // Controls
    this.btnToggle = document.getElementById('btn-toggle');
    this.statusBadge = document.getElementById('status-badge');
    this.statusDetail = document.getElementById('status-detail');

    // Telemetry stats
    this.statSpeedDown = document.getElementById('stat-speed-down');
    this.statSpeedUp = document.getElementById('stat-speed-up');
    this.statTotalDown = document.getElementById('stat-total-down');
    this.statTotalUp = document.getElementById('stat-total-up');
    this.statActiveSessions = document.getElementById('stat-active-sessions');
    this.statTotalSessions = document.getElementById('stat-total-sessions');

    // Session Table
    this.sessionTableBody = document.getElementById('session-table-body');
    this.emptySessionNotice = document.getElementById('empty-session-notice');

    // Copy command buttons & snippets
    this.btnCopySocksCurl = document.getElementById('btn-copy-socks-curl');
    this.btnCopyHttpCurl = document.getElementById('btn-copy-http-curl');
    this.codeSocksCurl = document.getElementById('code-socks-curl');
    this.codeHttpCurl = document.getElementById('code-http-curl');

    // Log filters
    this.selectLogFilter = document.getElementById('select-log-filter');
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

  _loadSettings() {
    const saved = localStorage.getItem('brook_iwa_config');
    if (saved) {
      try {
        const cfg = JSON.parse(saved);
        if (cfg.server && this.inputServer) this.inputServer.value = cfg.server;
        if (cfg.password && this.inputPassword) this.inputPassword.value = cfg.password;
        // Upgrade legacy 1080 to 10808 to avoid Chrome port block
        let s5 = cfg.socks5Port || '10808';
        if (s5 === '1080' || s5 === 1080) s5 = '10808';
        if (this.inputSocks5Port) this.inputSocks5Port.value = s5;
        if (cfg.httpPort && this.inputHttpPort) this.inputHttpPort.value = cfg.httpPort;
        if (cfg.autoDetect !== undefined && this.toggleAutoDetect) this.toggleAutoDetect.checked = cfg.autoDetect;
        if (cfg.withoutBrook !== undefined && this.toggleWithoutBrook) this.toggleWithoutBrook.checked = cfg.withoutBrook;
      } catch (e) {}
    }
    this._updatePortInputVisibility();
  }

  _saveSettings() {
    const cfg = {
      server: this.inputServer?.value,
      password: this.inputPassword?.value,
      socks5Port: this.inputSocks5Port?.value,
      httpPort: this.inputHttpPort?.value,
      autoDetect: this.toggleAutoDetect?.checked,
      withoutBrook: this.toggleWithoutBrook?.checked
    };
    localStorage.setItem('brook_iwa_config', JSON.stringify(cfg));
  }

  getConfig() {
    const rawServer = (this.inputServer?.value || 'quic://brook-quic.pplx.io:4433').trim();
    const cleaned = rawServer.replace(/^quic:\/\//i, '');
    const { host: serverHost, port: serverPort } = parseHostPort(cleaned, 4433);

    const socks5Port = parseInt(this.inputSocks5Port?.value || '10808', 10);
    const httpPort = parseInt(this.inputHttpPort?.value || '8080', 10);

    return {
      serverHost,
      serverPort,
      password: this.inputPassword?.value || '271828brook',
      socks5Port,
      httpPort,
      autoDetectMode: !!this.toggleAutoDetect?.checked,
      withoutBrook: !!this.toggleWithoutBrook?.checked
    };
  }

  async handleStart() {
    const config = this.getConfig();

    // Validate ports before starting
    if (config.socks5Port < 1024) {
      this._showToast(`Port ${config.socks5Port} is < 1024 (system port blocked by Chrome). Use 10808.`);
      return;
    }
    if (CHROME_RESTRICTED_PORTS.has(config.socks5Port)) {
      this._showToast(`Port ${config.socks5Port} (e.g. 1080) is blocked by Chrome's security policy. Please use 10808 or 1081.`);
      return;
    }
    if (!config.autoDetectMode && CHROME_RESTRICTED_PORTS.has(config.httpPort)) {
      this._showToast(`Port ${config.httpPort} is blocked by Chrome's security policy. Please use 8080 or 8085.`);
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

  updateConnectionState(state, detail = '') {
    if (!this.statusBadge) return;

    this.statusBadge.className = 'status-badge';
    if (state === ConnectionState.CONNECTED) {
      this.statusBadge.classList.add('status-connected');
      this.statusBadge.textContent = 'CONNECTED';
    } else if (state === ConnectionState.CONNECTING || state === ConnectionState.RECONNECTING) {
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
