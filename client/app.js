/**
 * TCP Client - Isolated Web App
 * Uses Direct Sockets API: TCPSocket
 */

// Initialize Trusted Types Policy for IWA Strict CSP Compliance
if (typeof window !== 'undefined' && window.trustedTypes && window.trustedTypes.createPolicy) {
  try {
    window.trustedTypes.createPolicy('default', {
      createHTML: (string) => string,
      createScript: (string) => string,
      createScriptURL: (string) => string,
    });
  } catch (e) {
    // Policy already exists or cannot be created
  }
}

class TcpClientApp {
  constructor() {
    this.socket = null;
    this.reader = null;
    this.writer = null;
    this.isConnected = false;
    this.isConnecting = false;
    this.logs = [];
    this.logIdCounter = 0;
    this.viewMode = 'text'; // 'text' | 'hex'
    this.filterMode = 'all'; // 'all' | 'tx' | 'rx' | 'evt'
    this.composerMode = 'text'; // 'text' | 'hex'
    this.isSimMode = false;
    this.repeatTimer = null;
    this.pingTimestamp = null;

    this.stats = {
      pktsTx: 0,
      pktsRx: 0,
      bytesTx: 0,
      bytesRx: 0,
      lastRtt: null
    };

    this.initElements();
    this.bindEvents();
    this.checkEnvironment();
  }

  initElements() {
    this.el = {
      apiStatusBadge: document.getElementById('api-status-badge'),
      apiStatusText: document.getElementById('api-status-text'),
      coiStatusBadge: document.getElementById('coi-status-badge'),
      coiStatusText: document.getElementById('coi-status-text'),
      diagnosticsBanner: document.getElementById('diagnostics-banner'),
      diagnosticsMsg: document.getElementById('diagnostics-msg'),
      toggleSimMode: document.getElementById('toggle-sim-mode'),

      connStatePill: document.getElementById('conn-state-pill'),
      connStateText: document.getElementById('conn-state-text'),
      targetIp: document.getElementById('target-ip'),
      targetPort: document.getElementById('target-port'),
      btnQuickFillPort: document.getElementById('btn-quick-fill-port'),
      optNoDelay: document.getElementById('opt-no-delay'),
      optKeepAlive: document.getElementById('opt-keep-alive'),
      btnToggleConnect: document.getElementById('btn-toggle-connect'),

      connBanner: document.getElementById('conn-banner'),
      bannerRemoteIp: document.getElementById('banner-remote-ip'),
      bannerRemotePort: document.getElementById('banner-remote-port'),
      bannerLocalEndpoint: document.getElementById('banner-local-endpoint'),

      statPktsTx: document.getElementById('stat-pkts-tx'),
      statPktsRx: document.getElementById('stat-pkts-rx'),
      statBytesTx: document.getElementById('stat-bytes-tx'),
      statBytesRx: document.getElementById('stat-bytes-rx'),
      statRtt: document.getElementById('stat-rtt'),

      composerTextMode: document.getElementById('composer-text-mode'),
      composerHexMode: document.getElementById('composer-hex-mode'),
      composerInput: document.getElementById('composer-input'),
      lineEnding: document.getElementById('line-ending'),
      optRepeatSend: document.getElementById('opt-repeat-send'),
      repeatIntervalMs: document.getElementById('repeat-interval-ms'),
      btnSendMessage: document.getElementById('btn-send-message'),

      trafficStream: document.getElementById('traffic-stream'),
      viewTextBtn: document.getElementById('view-text-btn'),
      viewHexBtn: document.getElementById('view-hex-btn'),
      btnClearLogs: document.getElementById('btn-clear-logs'),
      btnExportLogs: document.getElementById('btn-export-logs'),

      hexModal: document.getElementById('hex-modal'),
      modalTitle: document.getElementById('modal-title'),
      packetMeta: document.getElementById('packet-meta'),
      hexDumpContent: document.getElementById('hex-dump-content'),
      btnCloseModal: document.getElementById('btn-close-modal'),
      btnCopyHex: document.getElementById('btn-copy-hex'),
      btnCopyAscii: document.getElementById('btn-copy-ascii'),

      toast: document.getElementById('toast')
    };
  }

  bindEvents() {
    // Preset IP buttons
    document.querySelectorAll('.pill-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.pill-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.el.targetIp.value = btn.dataset.ip;
      });
    });

    // Paste Port
    this.el.btnQuickFillPort.addEventListener('click', async () => {
      try {
        const text = await navigator.clipboard.readText();
        const match = text.trim().match(/(\d{1,5})$/);
        if (match) {
          const port = parseInt(match[1], 10);
          if (port > 0 && port <= 65535) {
            this.el.targetPort.value = port;
            this.showToast(`Pasted Port: ${port}`);
            return;
          }
        }
      } catch (e) {}
      this.showToast('Paste valid port from clipboard');
    });

    // Connect / Disconnect
    this.el.btnToggleConnect.addEventListener('click', () => {
      if (this.isConnected || this.isConnecting) {
        this.disconnect('Disconnected by user');
      } else {
        this.connect();
      }
    });

    // Composer mode
    this.el.composerTextMode.addEventListener('click', () => {
      this.composerMode = 'text';
      this.el.composerTextMode.classList.add('active');
      this.el.composerHexMode.classList.remove('active');
      this.el.composerInput.placeholder = 'Enter message text or payload (Ctrl+Enter to send)...';
    });

    this.el.composerHexMode.addEventListener('click', () => {
      this.composerMode = 'hex';
      this.el.composerHexMode.classList.add('active');
      this.el.composerTextMode.classList.remove('active');
      this.el.composerInput.placeholder = 'Enter hex bytes (e.g. 48 65 6c 6c 6f 21 0a)...';
    });

    // Preset payloads
    document.querySelectorAll('.preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.dataset.hex) {
          this.composerMode = 'hex';
          this.el.composerHexMode.classList.add('active');
          this.el.composerTextMode.classList.remove('active');
          this.el.composerInput.value = btn.dataset.hex;
        } else {
          this.composerMode = 'text';
          this.el.composerTextMode.classList.add('active');
          this.el.composerHexMode.classList.remove('active');
          let payload = btn.dataset.payload;
          if (payload.includes('${Date.now()}')) {
            payload = payload.replace('${Date.now()}', Date.now());
          }
          this.el.composerInput.value = payload;
        }
      });
    });

    // Send Message
    this.el.btnSendMessage.addEventListener('click', () => this.sendMessage());
    this.el.composerInput.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        this.sendMessage();
      }
    });

    // Repeat Sender
    this.el.optRepeatSend.addEventListener('change', (e) => {
      if (e.target.checked) {
        if (!this.isConnected) {
          this.showToast('Connect to server first before starting interval sender.');
          e.target.checked = false;
          return;
        }
        this.startRepeatSender();
      } else {
        this.stopRepeatSender();
      }
    });

    // Filter tabs
    document.querySelectorAll('.tab-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-pill').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.filterMode = btn.dataset.filter;
        this.renderLogs();
      });
    });

    // View mode switch
    this.el.viewTextBtn.addEventListener('click', () => {
      this.viewMode = 'text';
      this.el.viewTextBtn.classList.add('active');
      this.el.viewHexBtn.classList.remove('active');
      this.renderLogs();
    });

    this.el.viewHexBtn.addEventListener('click', () => {
      this.viewMode = 'hex';
      this.el.viewHexBtn.classList.add('active');
      this.el.viewTextBtn.classList.remove('active');
      this.renderLogs();
    });

    // Clear logs
    this.el.btnClearLogs.addEventListener('click', () => {
      this.logs = [];
      this.renderLogs();
      this.showToast('Traffic logs cleared.');
    });

    // Export logs
    this.el.btnExportLogs.addEventListener('click', () => this.exportLogs());

    // Sim mode toggle button
    this.el.toggleSimMode.addEventListener('click', () => {
      this.isSimMode = !this.isSimMode;
      if (this.isSimMode) {
        this.el.toggleSimMode.textContent = 'Disable Simulator Mode';
        this.el.apiStatusBadge.className = 'status-pill status-muted';
        this.el.apiStatusText.textContent = 'Simulated TCPSocket';
        this.addLog('SYSTEM', 'Interactive TCP Simulator Mode activated.', 'evt');
      } else {
        this.el.toggleSimMode.textContent = 'Enable Interactive Simulator Mode';
        this.checkEnvironment();
      }
    });

    // Modal
    this.el.btnCloseModal.addEventListener('click', () => this.hideHexModal());
    this.el.hexModal.querySelector('.modal-backdrop').addEventListener('click', () => this.hideHexModal());
    this.el.btnCopyHex.addEventListener('click', () => {
      if (this.currentInspectedLog) {
        navigator.clipboard.writeText(this.bytesToHexString(this.currentInspectedLog.rawBytes));
        this.showToast('Copied Hex bytes!');
      }
    });
    this.el.btnCopyAscii.addEventListener('click', () => {
      if (this.currentInspectedLog) {
        navigator.clipboard.writeText(this.currentInspectedLog.text);
        this.showToast('Copied ASCII text!');
      }
    });
  }

  checkEnvironment() {
    const isCOI = window.crossOriginIsolated === true;
    this.el.coiStatusBadge.className = isCOI ? 'status-pill status-success' : 'status-pill status-error';
    this.el.coiStatusText.textContent = isCOI ? 'COI: Isolated' : 'COI: Not Isolated';

    const hasTCPSocket = typeof window.TCPSocket !== 'undefined';
    if (hasTCPSocket) {
      this.el.apiStatusBadge.className = 'status-pill status-success';
      this.el.apiStatusText.textContent = 'Direct Sockets Active';
      this.el.diagnosticsBanner.classList.add('hidden');
    } else {
      this.el.apiStatusBadge.className = 'status-pill status-checking';
      this.el.apiStatusText.textContent = 'TCPSocket Unavailable';
      this.el.diagnosticsBanner.classList.remove('hidden');
    }
  }

  async connect() {
    const ip = this.el.targetIp.value.trim() || '127.0.0.1';
    const port = parseInt(this.el.targetPort.value, 10);

    if (!port || port <= 0 || port > 65535) {
      this.showToast('Please enter a valid TCP port (1 - 65535)');
      return;
    }

    this.setConnState('connecting');
    this.isConnecting = true;

    if (typeof window.TCPSocket === 'undefined' || this.isSimMode) {
      if (!this.isSimMode) {
        this.addLog('SYSTEM', 'TCPSocket API not detected. Falling back to Interactive Simulator Mode.', 'evt');
        this.isSimMode = true;
      }
      this.connectSimulated(ip, port);
      return;
    }

    try {
      const options = {
        noDelay: this.el.optNoDelay.checked
      };
      const keepAlive = parseInt(this.el.optKeepAlive.value, 10);
      if (keepAlive > 0) {
        options.keepAliveDelay = keepAlive;
      }

      this.addLog('SYSTEM', `Connecting TCPSocket to ${ip}:${port}...`, 'evt');
      this.socket = new TCPSocket(ip, port, options);

      const { readable, writable, remoteAddress, remotePort, localAddress, localPort } = await this.socket.opened;

      this.isConnected = true;
      this.isConnecting = false;

      this.el.bannerRemoteIp.textContent = remoteAddress || ip;
      this.el.bannerRemotePort.textContent = remotePort || port;
      this.el.bannerLocalEndpoint.textContent = `${localAddress || '127.0.0.1'}:${localPort || 'ephemeral'}`;

      this.setConnState('connected');
      this.addLog('EVENT', `Connected to ${remoteAddress || ip}:${remotePort || port} (Local: ${localAddress || '127.0.0.1'}:${localPort || '?'})`, 'evt');
      this.showToast(`Connected to ${ip}:${port}!`);

      this.writer = writable.getWriter();
      this.readStream(readable);
    } catch (err) {
      console.error('Connection failed:', err);
      this.isConnecting = false;
      this.setConnState('disconnected');
      this.addLog('ERROR', `Failed to connect to ${ip}:${port}: ${err.message}`, 'err');
      this.showToast(`Connection failed: ${err.message}`);
    }
  }

  async readStream(readableStream) {
    this.reader = readableStream.getReader();
    const decoder = new TextDecoder();

    try {
      while (this.isConnected) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (value && value.byteLength > 0) {
          const rawBytes = value;
          const text = decoder.decode(rawBytes);

          this.stats.pktsRx++;
          this.stats.bytesRx += rawBytes.byteLength;

          // RTT calculation if measuring ping
          if (this.pingTimestamp) {
            const rtt = Math.round(performance.now() - this.pingTimestamp);
            this.stats.lastRtt = rtt;
            this.pingTimestamp = null;
          }

          this.updateStats();
          this.addLog('RX', text, 'rx', rawBytes);
        }
      }
    } catch (err) {
      if (this.isConnected) {
        console.warn('Read stream error:', err);
        this.addLog('ERROR', `Read stream error: ${err.message}`, 'err');
      }
    } finally {
      this.disconnect('Server closed connection');
    }
  }

  async sendMessage() {
    if (!this.isConnected) {
      this.showToast('Please connect to a TCP server first.');
      return;
    }

    const rawInput = this.el.composerInput.value;
    if (!rawInput) return;

    let payloadBytes;

    if (this.composerMode === 'hex') {
      try {
        payloadBytes = this.hexStringToBytes(rawInput);
      } catch (err) {
        this.showToast(`Invalid hex string: ${err.message}`);
        return;
      }
    } else {
      let text = this.unescapeText(rawInput);
      const ending = this.el.lineEnding.value;
      if (ending === 'lf' && !text.endsWith('\n')) text += '\n';
      if (ending === 'crlf' && !text.endsWith('\r\n')) text += '\r\n';

      payloadBytes = new TextEncoder().encode(text);
      if (text.includes('PING')) {
        this.pingTimestamp = performance.now();
      }
    }

    if (this.isSimMode) {
      this.sendSimulated(payloadBytes);
      return;
    }

    try {
      if (!this.writer) {
        this.showToast('Socket writer not available.');
        return;
      }

      await this.writer.write(payloadBytes);

      this.stats.pktsTx++;
      this.stats.bytesTx += payloadBytes.byteLength;
      this.updateStats();

      const decoded = new TextDecoder().decode(payloadBytes);
      this.addLog('TX', decoded, 'tx', payloadBytes);
    } catch (err) {
      console.error('Send error:', err);
      this.addLog('ERROR', `Send failed: ${err.message}`, 'err');
      this.showToast(`Send error: ${err.message}`);
    }
  }

  async disconnect(reason = 'Disconnected') {
    this.stopRepeatSender();
    this.isConnected = false;
    this.isConnecting = false;

    try {
      if (this.reader) {
        await this.reader.cancel();
        this.reader.releaseLock();
      }
    } catch (e) {}

    try {
      if (this.writer) {
        await this.writer.close();
        this.writer.releaseLock();
      }
    } catch (e) {}

    try {
      if (this.socket && this.socket.close) {
        await this.socket.close();
      }
    } catch (e) {}

    this.socket = null;
    this.reader = null;
    this.writer = null;

    this.setConnState('disconnected');
    this.addLog('EVENT', reason, 'evt');
    this.showToast(reason);
  }

  setConnState(state) {
    const btnSpan = this.el.btnToggleConnect.querySelector('span');
    if (state === 'connected') {
      this.el.connStatePill.className = 'status-pill status-connected';
      this.el.connStateText.textContent = 'Connected';
      this.el.btnToggleConnect.className = 'btn btn-danger btn-lg';
      if (btnSpan) btnSpan.textContent = 'Disconnect Socket';
      this.el.connBanner.classList.remove('hidden');
      this.el.btnSendMessage.disabled = false;
      this.el.targetIp.disabled = true;
      this.el.targetPort.disabled = true;
    } else if (state === 'connecting') {
      this.el.connStatePill.className = 'status-pill status-connecting';
      this.el.connStateText.textContent = 'Connecting...';
      this.el.btnToggleConnect.disabled = true;
    } else {
      this.el.connStatePill.className = 'status-pill status-stopped';
      this.el.connStateText.textContent = 'Disconnected';
      this.el.btnToggleConnect.className = 'btn btn-primary btn-lg';
      this.el.btnToggleConnect.disabled = false;
      if (btnSpan) btnSpan.textContent = 'Connect to TCP Server';
      this.el.connBanner.classList.add('hidden');
      this.el.btnSendMessage.disabled = true;
      this.el.targetIp.disabled = false;
      this.el.targetPort.disabled = false;
    }
  }

  // --- Repeat / Interval Sender ---
  startRepeatSender() {
    const intervalMs = Math.max(100, parseInt(this.el.repeatIntervalMs.value, 10) || 1000);
    this.repeatTimer = setInterval(() => {
      if (this.isConnected) {
        this.sendMessage();
      } else {
        this.stopRepeatSender();
      }
    }, intervalMs);
    this.showToast(`Auto-repeat started (${intervalMs}ms)`);
  }

  stopRepeatSender() {
    if (this.repeatTimer) {
      clearInterval(this.repeatTimer);
      this.repeatTimer = null;
    }
    this.el.optRepeatSend.checked = false;
  }

  // --- Simulator Mode ---
  connectSimulated(ip, port) {
    setTimeout(() => {
      this.isConnected = true;
      this.isConnecting = false;
      this.el.bannerRemoteIp.textContent = ip;
      this.el.bannerRemotePort.textContent = port;
      this.el.bannerLocalEndpoint.textContent = `127.0.0.1:${Math.floor(40000 + Math.random() * 20000)} (Sim)`;

      this.setConnState('connected');
      this.addLog('EVENT', `[SIMULATOR] Connected to ${ip}:${port}`, 'evt');
      this.showToast(`[SIMULATOR] Connected to ${ip}:${port}!`);

      // Send simulated welcome
      setTimeout(() => {
        if (this.isConnected) {
          const welcome = new TextEncoder().encode('220 Simulated Echo Server Ready\r\n');
          this.stats.pktsRx++;
          this.stats.bytesRx += welcome.byteLength;
          this.updateStats();
          this.addLog('RX', '220 Simulated Echo Server Ready\r\n', 'rx', welcome);
        }
      }, 500);
    }, 600);
  }

  sendSimulated(uint8Array) {
    this.stats.pktsTx++;
    this.stats.bytesTx += uint8Array.byteLength;
    this.updateStats();

    const decoded = new TextDecoder().decode(uint8Array);
    this.addLog('TX', decoded, 'tx', uint8Array);

    // Simulate echo response after small network latency
    const simLatency = Math.floor(15 + Math.random() * 25);
    setTimeout(() => {
      if (this.isConnected) {
        this.stats.pktsRx++;
        this.stats.bytesRx += uint8Array.byteLength;
        this.stats.lastRtt = simLatency;
        this.updateStats();
        this.addLog('RX', decoded, 'rx', uint8Array);
      }
    }, simLatency);
  }

  // --- UI Renders & Logs ---
  updateStats() {
    this.el.statPktsTx.textContent = this.stats.pktsTx;
    this.el.statPktsRx.textContent = this.stats.pktsRx;
    this.el.statBytesTx.textContent = this.formatBytes(this.stats.bytesTx);
    this.el.statBytesRx.textContent = this.formatBytes(this.stats.bytesRx);
    this.el.statRtt.textContent = this.stats.lastRtt !== null ? `${this.stats.lastRtt} ms` : '-- ms';
  }

  addLog(tag, text, type, rawBytes = null) {
    this.logIdCounter++;
    const now = new Date();
    const timeStr = `[${now.toTimeString().split(' ')[0]}.${String(now.getMilliseconds()).padStart(3, '0')}]`;

    if (!rawBytes) {
      rawBytes = new TextEncoder().encode(text);
    }

    const logEntry = {
      id: this.logIdCounter,
      time: timeStr,
      timestamp: now.toISOString(),
      tag,
      text,
      type,
      rawBytes: new Uint8Array(rawBytes),
      byteLength: rawBytes.byteLength
    };

    this.logs.push(logEntry);
    if (this.logs.length > 500) {
      this.logs.shift();
      const oldestNode = this.el.trafficStream.firstElementChild;
      if (oldestNode) oldestNode.remove();
    }

    this.appendLogEntry(logEntry);
  }

  appendLogEntry(log) {
    if (this.filterMode !== 'all' && this.filterMode !== log.type) {
      return;
    }

    const entryDiv = document.createElement('div');
    entryDiv.className = `stream-entry entry-${log.type}`;
    entryDiv.dataset.id = log.id;

    let tagClass = 'tag-system';
    if (log.type === 'rx') tagClass = 'tag-rx';
    if (log.type === 'tx') tagClass = 'tag-tx';
    if (log.type === 'err') tagClass = 'tag-err';

    let displayContent = log.text;
    if (this.viewMode === 'hex' && log.rawBytes) {
      displayContent = this.bytesToHexString(log.rawBytes);
    }

    const timeSpan = document.createElement('span');
    timeSpan.className = 'entry-time';
    timeSpan.textContent = log.time;

    const tagSpan = document.createElement('span');
    tagSpan.className = `entry-tag ${tagClass}`;
    tagSpan.textContent = log.tag;

    const contentSpan = document.createElement('span');
    contentSpan.className = 'entry-content';
    contentSpan.textContent = displayContent;

    entryDiv.append(timeSpan, tagSpan, contentSpan);

    entryDiv.addEventListener('click', () => this.showHexModal(log));

    this.el.trafficStream.appendChild(entryDiv);
    this.el.trafficStream.scrollTop = this.el.trafficStream.scrollHeight;
  }

  renderLogs() {
    this.el.trafficStream.replaceChildren();
    const filtered = this.logs.filter(l => this.filterMode === 'all' || this.filterMode === l.type);
    filtered.forEach(log => this.appendLogEntry(log));
  }

  // --- Modal & Hex Inspector ---
  showHexModal(log) {
    this.currentInspectedLog = log;
    this.el.modalTitle.textContent = `Packet Inspector #${log.id} (${log.tag})`;
    
    this.el.packetMeta.replaceChildren();
    const spanMeta = document.createElement('span');
    spanMeta.textContent = `Timestamp: ${log.timestamp} | Length: ${log.byteLength} bytes`;
    this.el.packetMeta.appendChild(spanMeta);

    this.el.hexDumpContent.textContent = this.formatHexDump(log.rawBytes);
    this.el.hexModal.classList.remove('hidden');
  }

  hideHexModal() {
    this.el.hexModal.classList.add('hidden');
    this.currentInspectedLog = null;
  }

  formatHexDump(uint8Array) {
    if (!uint8Array || uint8Array.length === 0) return '(Empty payload)';
    let result = '';
    const length = uint8Array.length;

    for (let i = 0; i < length; i += 16) {
      const offset = i.toString(16).padStart(8, '0');
      let hexPart = '';
      let asciiPart = '';

      for (let j = 0; j < 16; j++) {
        if (i + j < length) {
          const b = uint8Array[i + j];
          hexPart += b.toString(16).padStart(2, '0') + ' ';
          asciiPart += (b >= 32 && b <= 126) ? String.fromCharCode(b) : '.';
        } else {
          hexPart += '   ';
        }
        if (j === 7) hexPart += ' ';
      }

      result += `${offset}  ${hexPart} |${asciiPart}|\n`;
    }
    return result;
  }

  bytesToHexString(bytes) {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(' ');
  }

  hexStringToBytes(hexString) {
    const cleaned = hexString.replace(/0x/g, '').replace(/[\s,\-_]/g, '');
    if (cleaned.length % 2 !== 0) {
      throw new Error('Hex string must have an even number of digits.');
    }
    const bytes = new Uint8Array(cleaned.length / 2);
    for (let i = 0; i < cleaned.length; i += 2) {
      const byteVal = parseInt(cleaned.substr(i, 2), 16);
      if (isNaN(byteVal)) throw new Error(`Invalid hex character at position ${i}`);
      bytes[i / 2] = byteVal;
    }
    return bytes;
  }

  exportLogs() {
    const data = JSON.stringify(this.logs, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tcp-client-traffic-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    this.showToast('Traffic logs exported.');
  }

  unescapeText(str) {
    return str.replace(/\\r/g, '\r').replace(/\\n/g, '\n').replace(/\\t/g, '\t');
  }

  escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  showToast(msg) {
    this.el.toast.textContent = msg;
    this.el.toast.classList.remove('hidden');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.el.toast.classList.add('hidden');
    }, 2800);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.app = new TcpClientApp();
});
