/**
 * TCP Listener - Isolated Web App
 * Uses Direct Sockets API: TCPServerSocket and TCPSocket
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

class TcpListenerApp {
  constructor() {
    this.serverSocket = null;
    this.serverReader = null;
    this.isListening = false;
    this.clients = new Map(); // id -> clientInfo
    this.clientCounter = 0;
    this.logs = [];
    this.logIdCounter = 0;
    this.viewMode = 'text'; // 'text' | 'hex'
    this.filterMode = 'all'; // 'all' | 'rx' | 'tx' | 'evt'
    this.isSimMode = false;
    this.simInterval = null;

    this.stats = {
      totalAccepted: 0,
      bytesRx: 0,
      bytesTx: 0
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

      serverStatePill: document.getElementById('server-state-pill'),
      serverStateText: document.getElementById('server-state-text'),
      bindIp: document.getElementById('bind-ip'),
      listenPort: document.getElementById('listen-port'),
      randomPortToggle: document.getElementById('random-port-toggle'),
      portHint: document.getElementById('port-hint'),
      backlogSize: document.getElementById('backlog-size'),
      btnToggleServer: document.getElementById('btn-toggle-server'),

      listeningBanner: document.getElementById('listening-banner'),
      boundAddress: document.getElementById('bound-address'),
      boundPort: document.getElementById('bound-port'),
      btnCopyEndpoint: document.getElementById('btn-copy-endpoint'),

      statActiveClients: document.getElementById('stat-active-clients'),
      statTotalAccepted: document.getElementById('stat-total-accepted'),
      statBytesRx: document.getElementById('stat-bytes-rx'),
      statBytesTx: document.getElementById('stat-bytes-tx'),

      optAutoEcho: document.getElementById('opt-auto-echo'),
      optWelcomeMsg: document.getElementById('opt-welcome-msg'),
      welcomeMsgText: document.getElementById('welcome-msg-text'),

      clientsCount: document.getElementById('clients-count'),
      clientsList: document.getElementById('clients-list'),
      btnBroadcastModal: document.getElementById('btn-broadcast-modal'),

      trafficStream: document.getElementById('traffic-stream'),
      viewTextBtn: document.getElementById('view-text-btn'),
      viewHexBtn: document.getElementById('view-hex-btn'),
      btnClearLogs: document.getElementById('btn-clear-logs'),
      btnExportLogs: document.getElementById('btn-export-logs'),

      targetClientSelect: document.getElementById('target-client-select'),
      manualMsgInput: document.getElementById('manual-msg-input'),
      btnSendManual: document.getElementById('btn-send-manual'),

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
    // Port mode toggle
    this.el.randomPortToggle.addEventListener('change', (e) => {
      const isRandom = e.target.checked;
      this.el.listenPort.disabled = isRandom;
      if (isRandom) {
        this.el.listenPort.value = 0;
        this.el.portHint.textContent = 'OS will pick an available ephemeral port';
      } else {
        if (this.el.listenPort.value === '0') this.el.listenPort.value = '8080';
        this.el.portHint.textContent = 'Specify a custom TCP port (1024 - 65535)';
      }
    });

    // Preset IP buttons
    document.querySelectorAll('.pill-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.pill-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.el.bindIp.value = btn.dataset.ip;
      });
    });

    // Start / Stop Server
    this.el.btnToggleServer.addEventListener('click', () => {
      if (this.isListening) {
        this.stopServer();
      } else {
        this.startServer();
      }
    });

    // Copy endpoint
    this.el.btnCopyEndpoint.addEventListener('click', () => {
      const endpoint = `${this.el.boundAddress.textContent}:${this.el.boundPort.textContent}`;
      navigator.clipboard.writeText(endpoint).then(() => {
        this.showToast(`Copied ${endpoint} to clipboard!`);
      });
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

    // Send manual message
    this.el.btnSendManual.addEventListener('click', () => this.handleManualSend());
    this.el.manualMsgInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.handleManualSend();
    });

    // Sim mode toggle button
    this.el.toggleSimMode.addEventListener('click', () => {
      this.isSimMode = !this.isSimMode;
      if (this.isSimMode) {
        this.el.toggleSimMode.textContent = 'Disable Simulator Mode';
        this.el.apiStatusBadge.className = 'status-pill status-muted';
        this.el.apiStatusText.textContent = 'Simulated TCPServerSocket';
        this.addLog('SYSTEM', 'Interactive TCP Simulator Mode activated. Ready to simulate connections.', 'evt');
      } else {
        this.el.toggleSimMode.textContent = 'Enable Interactive Simulator Mode';
        this.checkEnvironment();
      }
    });

    // Hex Modal controls
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

    const hasTCPServer = typeof window.TCPServerSocket !== 'undefined';
    if (hasTCPServer) {
      this.el.apiStatusBadge.className = 'status-pill status-success';
      this.el.apiStatusText.textContent = 'Direct Sockets Active';
      this.el.diagnosticsBanner.classList.add('hidden');
    } else {
      this.el.apiStatusBadge.className = 'status-pill status-checking';
      this.el.apiStatusText.textContent = 'TCPServerSocket Unavailable';
      this.el.diagnosticsBanner.classList.remove('hidden');
    }
  }

  async startServer() {
    const bindIp = this.el.bindIp.value.trim() || '0.0.0.0';
    const isRandom = this.el.randomPortToggle.checked;
    const requestedPort = isRandom ? 0 : parseInt(this.el.listenPort.value, 10) || 0;
    const backlog = parseInt(this.el.backlogSize.value, 10) || 100;

    this.setServerState('starting');

    if (typeof window.TCPServerSocket === 'undefined' || this.isSimMode) {
      if (!this.isSimMode) {
        this.addLog('SYSTEM', 'TCPServerSocket API not detected. Falling back to Interactive Simulator Mode.', 'evt');
        this.isSimMode = true;
      }
      this.startSimulatedServer(bindIp, requestedPort || Math.floor(20000 + Math.random() * 40000));
      return;
    }

    try {
      const options = { backlog };
      if (requestedPort > 0) {
        options.localPort = requestedPort;
      }

      this.addLog('SYSTEM', `Binding TCPServerSocket to ${bindIp}:${requestedPort === 0 ? '(random port)' : requestedPort}...`, 'evt');
      this.serverSocket = new TCPServerSocket(bindIp, options);

      const { readable, localAddress, localPort } = await this.serverSocket.opened;
      this.isListening = true;

      this.el.boundAddress.textContent = localAddress || bindIp;
      this.el.boundPort.textContent = localPort;

      this.setServerState('listening');
      this.addLog('SYSTEM', `TCPServerSocket listening on ${localAddress || bindIp}:${localPort}`, 'evt');
      this.showToast(`Server listening on port ${localPort}!`);

      this.listenForConnections(readable);
    } catch (err) {
      console.error('Server failed to start:', err);
      this.setServerState('stopped');
      this.addLog('ERROR', `Failed to open TCPServerSocket: ${err.message}`, 'err');
      this.showToast(`Error starting server: ${err.message}`);
    }
  }

  async listenForConnections(readableStream) {
    this.serverReader = readableStream.getReader();
    try {
      while (this.isListening) {
        const { value: clientSocket, done } = await this.serverReader.read();
        if (done) break;
        if (clientSocket) {
          this.handleIncomingClient(clientSocket);
        }
      }
    } catch (err) {
      if (this.isListening) {
        console.error('Error accepting client connection:', err);
        this.addLog('ERROR', `Accept error: ${err.message}`, 'err');
      }
    } finally {
      try {
        this.serverReader.releaseLock();
      } catch (e) {}
    }
  }

  async handleIncomingClient(clientSocket) {
    this.clientCounter++;
    const clientId = `client-${this.clientCounter}`;
    this.stats.totalAccepted++;

    try {
      const { readable, writable, remoteAddress, remotePort, localAddress, localPort } = await clientSocket.opened;
      const remoteInfo = `${remoteAddress || '127.0.0.1'}:${remotePort || '?'}`;

      const clientInfo = {
        id: clientId,
        num: this.clientCounter,
        socket: clientSocket,
        readable,
        writable,
        remoteAddress: remoteAddress || '127.0.0.1',
        remotePort: remotePort || 0,
        endpoint: remoteInfo,
        connectedAt: new Date(),
        bytesRx: 0,
        bytesTx: 0,
        isAlive: true,
        reader: null,
        writer: null
      };

      this.clients.set(clientId, clientInfo);
      this.updateStats();
      this.renderClients();
      this.updateClientSelect();

      this.addLog('EVENT', `[${clientId}] Connected from ${remoteInfo}`, 'evt', clientId);
      this.showToast(`New connection from ${remoteInfo}`);

      // Send welcome message if enabled
      if (this.el.optWelcomeMsg.checked) {
        const welcome = this.unescapeText(this.el.welcomeMsgText.value);
        this.sendToClient(clientId, new TextEncoder().encode(welcome));
      }

      // Start reading client stream
      this.readClientStream(clientInfo);
    } catch (err) {
      console.error(`Failed to initialize client ${clientId}:`, err);
      this.addLog('ERROR', `Failed client open ${clientId}: ${err.message}`, 'err');
    }
  }

  async readClientStream(client) {
    client.reader = client.readable.getReader();
    const decoder = new TextDecoder();

    try {
      while (client.isAlive) {
        const { value, done } = await client.reader.read();
        if (done) break;
        if (value && value.byteLength > 0) {
          const rawBytes = value;
          const text = decoder.decode(rawBytes);
          client.bytesRx += rawBytes.byteLength;
          this.stats.bytesRx += rawBytes.byteLength;
          this.updateStats();
          this.renderClients();

          this.addLog('RX', text, 'rx', client.id, rawBytes);

          // Auto echo
          if (this.el.optAutoEcho.checked) {
            await this.sendToClient(client.id, rawBytes, true);
          }
        }
      }
    } catch (err) {
      console.warn(`Read error on ${client.id}:`, err);
    } finally {
      this.disconnectClient(client.id, 'Disconnected by remote host');
    }
  }

  async sendToClient(clientId, uint8ArrayData, isEcho = false) {
    const client = this.clients.get(clientId);
    if (!client || !client.isAlive) return;

    try {
      if (!client.writer) {
        client.writer = client.writable.getWriter();
      }
      await client.writer.write(uint8ArrayData);
      client.bytesTx += uint8ArrayData.byteLength;
      this.stats.bytesTx += uint8ArrayData.byteLength;
      this.updateStats();
      this.renderClients();

      const text = new TextDecoder().decode(uint8ArrayData);
      const tag = isEcho ? 'TX (Echo)' : 'TX';
      this.addLog(tag, text, 'tx', client.id, uint8ArrayData);
    } catch (err) {
      console.error(`Failed sending to ${clientId}:`, err);
      this.addLog('ERROR', `Send error to [${clientId}]: ${err.message}`, 'err');
    }
  }

  async broadcast(uint8ArrayData) {
    if (this.clients.size === 0) {
      this.showToast('No clients connected to broadcast to.');
      return;
    }
    for (const [id] of this.clients) {
      await this.sendToClient(id, uint8ArrayData);
    }
  }

  async disconnectClient(clientId, reason = 'Closed') {
    const client = this.clients.get(clientId);
    if (!client || !client.isAlive) return;

    client.isAlive = false;
    try {
      if (client.reader) {
        await client.reader.cancel();
        client.reader.releaseLock();
      }
    } catch (e) {}

    try {
      if (client.writer) {
        await client.writer.close();
        client.writer.releaseLock();
      }
    } catch (e) {}

    try {
      if (client.socket && client.socket.close) {
        await client.socket.close();
      }
    } catch (e) {}

    this.clients.delete(clientId);
    this.updateStats();
    this.renderClients();
    this.updateClientSelect();

    this.addLog('EVENT', `[${clientId}] ${reason}`, 'evt', clientId);
  }

  async stopServer() {
    this.setServerState('stopping');
    this.isListening = false;

    if (this.simInterval) {
      clearInterval(this.simInterval);
      this.simInterval = null;
    }

    // Disconnect all clients
    for (const [id] of this.clients) {
      await this.disconnectClient(id, 'Server shutting down');
    }

    // Close server reader and socket
    try {
      if (this.serverReader) {
        await this.serverReader.cancel();
        this.serverReader.releaseLock();
      }
    } catch (e) {}

    try {
      if (this.serverSocket && this.serverSocket.close) {
        await this.serverSocket.close();
      }
    } catch (e) {}

    this.serverSocket = null;
    this.serverReader = null;

    this.setServerState('stopped');
    this.addLog('SYSTEM', 'TCPServerSocket stopped.', 'evt');
    this.showToast('Server stopped.');
  }

  setServerState(state) {
    const btnSpan = this.el.btnToggleServer.querySelector('span');
    if (state === 'listening') {
      this.el.serverStatePill.className = 'status-pill status-listening';
      this.el.serverStateText.textContent = 'Listening';
      this.el.btnToggleServer.className = 'btn btn-danger btn-lg';
      if (btnSpan) btnSpan.textContent = 'Stop Server';
      this.el.listeningBanner.classList.remove('hidden');
      this.el.bindIp.disabled = true;
      this.el.randomPortToggle.disabled = true;
      this.el.listenPort.disabled = true;
      this.el.backlogSize.disabled = true;
    } else if (state === 'starting' || state === 'stopping') {
      this.el.serverStatePill.className = 'status-pill status-checking';
      this.el.serverStateText.textContent = state === 'starting' ? 'Starting...' : 'Stopping...';
      this.el.btnToggleServer.disabled = true;
    } else {
      this.el.serverStatePill.className = 'status-pill status-stopped';
      this.el.serverStateText.textContent = 'Stopped';
      this.el.btnToggleServer.className = 'btn btn-primary btn-lg';
      this.el.btnToggleServer.disabled = false;
      if (btnSpan) btnSpan.textContent = 'Start Listening';
      this.el.listeningBanner.classList.add('hidden');
      this.el.bindIp.disabled = false;
      this.el.randomPortToggle.disabled = false;
      this.el.listenPort.disabled = this.el.randomPortToggle.checked;
      this.el.backlogSize.disabled = false;
    }
  }

  // --- Simulation Mode for non-IWA testing ---
  startSimulatedServer(bindIp, port) {
    this.isListening = true;
    this.el.boundAddress.textContent = bindIp;
    this.el.boundPort.textContent = port;
    this.setServerState('listening');
    this.addLog('SYSTEM', `[SIMULATOR] Server listening on ${bindIp}:${port}`, 'evt');
    this.showToast(`[SIMULATOR] Listening on port ${port}!`);

    // Simulate an initial incoming client after 1.5s
    setTimeout(() => {
      if (!this.isListening) return;
      this.simulateClientConnect('127.0.0.1', Math.floor(40000 + Math.random() * 20000));
    }, 1500);
  }

  simulateClientConnect(remoteIp, remotePort) {
    this.clientCounter++;
    const clientId = `client-${this.clientCounter}`;
    this.stats.totalAccepted++;

    const clientInfo = {
      id: clientId,
      num: this.clientCounter,
      socket: null,
      remoteAddress: remoteIp,
      remotePort: remotePort,
      endpoint: `${remoteIp}:${remotePort}`,
      connectedAt: new Date(),
      bytesRx: 0,
      bytesTx: 0,
      isAlive: true
    };

    this.clients.set(clientId, clientInfo);
    this.updateStats();
    this.renderClients();
    this.updateClientSelect();

    this.addLog('EVENT', `[${clientId}] Connected from ${clientInfo.endpoint} (Simulated)`, 'evt', clientId);

    if (this.el.optWelcomeMsg.checked) {
      const welcome = this.unescapeText(this.el.welcomeMsgText.value);
      this.sendToClientSim(clientId, new TextEncoder().encode(welcome));
    }

    // Simulate periodic packets from this client
    setTimeout(() => {
      if (clientInfo.isAlive) {
        const pingData = new TextEncoder().encode(`PING seq=${Date.now()}\r\n`);
        this.simulateIncomingData(clientId, pingData);
      }
    }, 2000);
  }

  simulateIncomingData(clientId, uint8Array) {
    const client = this.clients.get(clientId);
    if (!client || !client.isAlive) return;

    client.bytesRx += uint8Array.byteLength;
    this.stats.bytesRx += uint8Array.byteLength;
    this.updateStats();
    this.renderClients();

    const text = new TextDecoder().decode(uint8Array);
    this.addLog('RX', text, 'rx', clientId, uint8Array);

    if (this.el.optAutoEcho.checked) {
      this.sendToClientSim(clientId, uint8Array, true);
    }
  }

  sendToClientSim(clientId, uint8Array, isEcho = false) {
    const client = this.clients.get(clientId);
    if (!client || !client.isAlive) return;

    client.bytesTx += uint8Array.byteLength;
    this.stats.bytesTx += uint8Array.byteLength;
    this.updateStats();
    this.renderClients();

    const text = new TextDecoder().decode(uint8Array);
    const tag = isEcho ? 'TX (Echo)' : 'TX';
    this.addLog(tag, text, 'tx', clientId, uint8Array);
  }

  // --- Manual Send ---
  handleManualSend() {
    const target = this.el.targetClientSelect.value;
    const text = this.el.manualMsgInput.value;
    if (!text) return;

    const data = new TextEncoder().encode(this.unescapeText(text));
    if (target === 'all') {
      if (this.isSimMode) {
        for (const [id] of this.clients) this.sendToClientSim(id, data);
      } else {
        this.broadcast(data);
      }
    } else {
      if (this.isSimMode) {
        this.sendToClientSim(target, data);
      } else {
        this.sendToClient(target, data);
      }
    }

    this.el.manualMsgInput.value = '';
  }

  // --- UI Renders ---
  renderClients() {
    this.el.clientsCount.textContent = this.clients.size;
    this.el.btnBroadcastModal.disabled = this.clients.size === 0;
    this.el.clientsList.replaceChildren();

    if (this.clients.size === 0) {
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'empty-state';
      
      const icon = document.createElement('div');
      icon.className = 'empty-icon';
      icon.textContent = '🔌';
      
      const text = document.createElement('div');
      text.className = 'empty-text';
      text.textContent = 'No clients currently connected';
      
      const sub = document.createElement('div');
      sub.className = 'empty-sub';
      sub.textContent = 'Start the server and connect with a TCP client';
      
      emptyDiv.append(icon, text, sub);
      this.el.clientsList.appendChild(emptyDiv);
      return;
    }

    for (const [id, c] of this.clients) {
      const durationSec = Math.floor((Date.now() - c.connectedAt.getTime()) / 1000);
      
      const clientItem = document.createElement('div');
      clientItem.className = 'client-item';
      clientItem.dataset.id = id;

      const header = document.createElement('div');
      header.className = 'client-item-header';

      const info = document.createElement('div');
      info.className = 'client-info';
      const idSpan = document.createElement('span');
      idSpan.className = 'client-id';
      idSpan.textContent = c.id;
      const epSpan = document.createElement('span');
      epSpan.className = 'client-endpoint';
      epSpan.textContent = c.endpoint;
      info.append(idSpan, epSpan);

      const btnDc = document.createElement('button');
      btnDc.className = 'btn btn-xs btn-danger btn-disconnect-client';
      btnDc.dataset.id = id;
      btnDc.textContent = 'Disconnect';
      btnDc.addEventListener('click', () => {
        this.disconnectClient(id, 'Disconnected by server operator');
      });

      header.append(info, btnDc);

      const meta = document.createElement('div');
      meta.className = 'client-meta';
      const durSpan = document.createElement('span');
      durSpan.textContent = `⏱️ ${durationSec}s`;
      const rxSpan = document.createElement('span');
      rxSpan.textContent = `⬇️ ${this.formatBytes(c.bytesRx)}`;
      const txSpan = document.createElement('span');
      txSpan.textContent = `⬆️ ${this.formatBytes(c.bytesTx)}`;
      meta.append(durSpan, rxSpan, txSpan);

      const replyBox = document.createElement('div');
      replyBox.className = 'client-reply-box';
      const replyInput = document.createElement('input');
      replyInput.type = 'text';
      replyInput.className = 'client-quick-reply';
      replyInput.placeholder = `Reply to ${id}...`;
      replyInput.dataset.id = id;

      const btnSend = document.createElement('button');
      btnSend.className = 'btn btn-xs btn-secondary btn-send-quick';
      btnSend.dataset.id = id;
      btnSend.textContent = 'Send';
      btnSend.addEventListener('click', () => {
        if (replyInput.value) {
          const bytes = new TextEncoder().encode(this.unescapeText(replyInput.value));
          if (this.isSimMode) this.sendToClientSim(id, bytes);
          else this.sendToClient(id, bytes);
          replyInput.value = '';
        }
      });

      replyBox.append(replyInput, btnSend);
      clientItem.append(header, meta, replyBox);
      this.el.clientsList.appendChild(clientItem);
    }
  }

  updateClientSelect() {
    this.el.targetClientSelect.replaceChildren();
    const allOpt = document.createElement('option');
    allOpt.value = 'all';
    allOpt.textContent = '📢 Broadcast to All Clients';
    this.el.targetClientSelect.appendChild(allOpt);

    for (const [id, c] of this.clients) {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = `Target: ${id} (${c.endpoint})`;
      this.el.targetClientSelect.appendChild(opt);
    }
  }

  updateStats() {
    this.el.statActiveClients.textContent = this.clients.size;
    this.el.statTotalAccepted.textContent = this.stats.totalAccepted;
    this.el.statBytesRx.textContent = this.formatBytes(this.stats.bytesRx);
    this.el.statBytesTx.textContent = this.formatBytes(this.stats.bytesTx);
  }

  addLog(tag, text, type, clientId = null, rawBytes = null) {
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
      clientId,
      rawBytes: new Uint8Array(rawBytes),
      byteLength: rawBytes.byteLength
    };

    this.logs.push(logEntry);
    if (this.logs.length > 500) {
      this.logs.shift(); // Keep buffer manageable
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

    entryDiv.append(timeSpan, tagSpan);

    if (log.clientId) {
      const clientSpan = document.createElement('span');
      clientSpan.className = 'entry-client';
      clientSpan.textContent = `${log.clientId}:`;
      entryDiv.appendChild(clientSpan);
    }

    const contentSpan = document.createElement('span');
    contentSpan.className = 'entry-content';
    contentSpan.textContent = displayContent;
    entryDiv.appendChild(contentSpan);

    entryDiv.addEventListener('click', () => this.showHexModal(log));

    this.el.trafficStream.appendChild(entryDiv);
    this.el.trafficStream.scrollTop = this.el.trafficStream.scrollHeight;
  }

  renderLogs() {
    this.el.trafficStream.replaceChildren();
    const filtered = this.logs.filter(l => this.filterMode === 'all' || this.filterMode === l.type);
    filtered.forEach(log => this.appendLogEntry(log));
  }

  // --- Hex Modal Inspector ---
  showHexModal(log) {
    this.currentInspectedLog = log;
    this.el.modalTitle.textContent = `Packet Inspector #${log.id} (${log.tag})`;
    
    this.el.packetMeta.replaceChildren();
    const spanMeta = document.createElement('span');
    spanMeta.textContent = `Timestamp: ${log.timestamp} | Length: ${log.byteLength} bytes`;
    if (log.clientId) {
      spanMeta.textContent += ` | Client: ${log.clientId}`;
    }
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

  exportLogs() {
    const data = JSON.stringify(this.logs, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tcp-listener-traffic-${Date.now()}.json`;
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
  window.app = new TcpListenerApp();
});
