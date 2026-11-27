/**
 * Dedicated Proxy Engine Web Worker.
 * Runs the entire proxy stack off the main UI thread so background tab timer throttling
 * does not disrupt keepalives, NetworkMonitor probes, dial timeouts, or throughput:
 *   - WsBridgeClient (local Zig TCP-over-WS bridge)
 *   - WebTransportConnectionManager (HTTP/3 QUIC pool + automatic /brook-ws TCP fallback)
 *   - ProxyDispatcher (SOCKS5 + HTTP/HTTPS CONNECT + Auto-Detect + Hedged retries)
 *   - NetworkMonitor (active 3-URL HTTP/3 + CORS probe)
 *   - SessionTracker (500ms telemetry ticker)
 */

import { WsBridgeClient } from '../server/ws-bridge-client.js';
import { TcpListener } from '../server/tcp-listener.js';
import { SessionTracker } from '../server/session-tracker.js';
import { WebTransportConnectionManager } from '../webtransport/wt-connection-manager.js';
import { ProxyDispatcher } from '../server/proxy-dispatcher.js';
import { NetworkMonitor, PROBE_URLS } from '../core/network-monitor.js';

let bridge = null;
let sessionTracker = null;
let networkMonitor = null;
let wtManager = null;
let dispatcher = null;
let isRunning = false;

function postLog(level, message, meta = null) {
  self.postMessage({ type: 'LOG', level, message, meta });
}

function postState(state, detail = '') {
  self.postMessage({ type: 'STATE', state, detail });
}

function postBridgeState(state, detail = '') {
  self.postMessage({ type: 'BRIDGE_STATE', state, detail });
}

async function initBridge(wsUrl) {
  if (bridge) {
    bridge.close();
    bridge = null;
  }

  sessionTracker = new SessionTracker({
    onStatsUpdate: (stats) => {
      self.postMessage({ type: 'STATS', stats });
    }
  });

  bridge = new WsBridgeClient({
    wsUrl,
    onLog: (lvl, msg) => postLog(lvl, msg),
    onStateChange: (state, detail) => postBridgeState(state, detail),
    onReady: (msg) => {
      self.postMessage({ type: 'BRIDGE_READY', info: msg });
    }
  });

  TcpListener.setBridge(bridge);

  try {
    const info = await bridge.connect();
    postLog('success', `🔌 Worker connected to Zig TCP bridge (HTTP :${info.httpPort})`);
  } catch (err) {
    postLog('error', `❌ Failed to connect to Zig TCP bridge: ${err.message}`);
    postBridgeState('disconnected', err.message);
  }
}

async function startProxy(config) {
  if (isRunning) {
    await stopProxy();
  }

  if (!bridge) {
    throw new Error('Zig TCP bridge not initialized');
  }

  if (!bridge.isConnected) {
    await bridge.connect();
  }

  const serverPath = config.serverPath || '/brook';
  postLog('info', `Starting WebTransport proxy in Web Worker -> https://${config.serverHost}:${config.serverPort}${serverPath}...`);

  try {
    // 1. Active Network Monitor (3 HTTP/3 + CORS endpoints, 5s interval, 2-strike hysteresis)
    networkMonitor = new NetworkMonitor({
      probeUrls: PROBE_URLS,
      checkIntervalMs: 5000,
      timeoutMs: 3000,
      maxConsecutiveFailures: 2,
      recentTrafficCheck: () => wtManager && wtManager.hasRecentActivity(10000),
      onStatusChange: async (isOnline) => {
        if (!isOnline) {
          postLog('warning', '⚠️ Network offline detected by probe endpoints. Pausing TCP listening & QUIC retries (existing QUIC sessions preserved)...');
          if (dispatcher) {
            try { await dispatcher.pauseListening('network_offline'); } catch (e) {}
          }
          const quicActive = wtManager && wtManager.isConnected();
          postState(
            'reconnecting',
            quicActive ? 'Offline (TCP Paused, QUIC Active)' : 'Offline (TCP Paused)'
          );
        } else {
          postLog('success', '🌐 Network online (probe verified). Resuming TCP listening, resyncing clock & reconnecting disconnected WebTransport slots...');
          if (dispatcher) {
            try {
              const boundPorts = await dispatcher.resumeListening('network_online');
              if (boundPorts) {
                self.postMessage({ type: 'BOUND_PORTS', boundPorts });
              }
            } catch (e) {
              postLog('error', `❌ Failed to resume TCP listening: ${e.message}`);
            }
          }
          try {
            const drift = await WebTransportConnectionManager.measureClockDrift();
            if (dispatcher) {
              dispatcher.clockOffsetSec = drift;
            }
            if (Math.abs(drift) > 1) {
              postLog('info', `⏱️ Network time sync: clock drift updated to ${drift > 0 ? '+' : ''}${drift}s`);
            }
          } catch (e) {}

          if (wtManager && (!networkMonitor || networkMonitor.isOnline)) {
            try { await wtManager.connect(); } catch (e) {}
          }
          if (!networkMonitor || networkMonitor.isOnline) {
            postState('connected', 'Online');
          }
        }
      },
      onLog: (lvl, msg, meta) => postLog(lvl, msg, meta)
    });
    networkMonitor.start();

    // 2. Clock drift sync
    const clockDriftSec = await WebTransportConnectionManager.measureClockDrift();
    if (Math.abs(clockDriftSec) > 1) {
      postLog('info', `⏱️ Network time sync: local clock drift is ${clockDriftSec > 0 ? '+' : ''}${clockDriftSec}s (auto-compensated)`);
    }

    // 3. WebTransport Connection Manager (adaptive 2->5 QUIC pool + automatic /brook-ws TCP fallback)
    wtManager = new WebTransportConnectionManager({
      serverHost: config.serverHost,
      serverPort: config.serverPort,
      path: serverPath,
      wsPath: '/brook-ws',
      serverCertificateHashes: config.serverCertificateHashes || [],
      poolSize: 5,
      baseWarmSlots: 2,
      enableWsFallback: true,
      networkMonitor,
      onStateChange: (state, details) => postState(state, details),
      onLog: (lvl, msg, meta) => postLog(lvl, msg, meta)
    });

    try {
      await wtManager.connect();
    } catch (e) {
      postLog('warning', `Initial WebTransport pool connection pending: ${e.message} (will connect on first proxy request)`);
    }

    // 4. Proxy Dispatcher (uses Zig-backed TcpListener transparently)
    dispatcher = new ProxyDispatcher({
      quicManager: wtManager,
      sessionTracker,
      password: config.password,
      withoutBrook: config.withoutBrook !== undefined ? config.withoutBrook : true,
      clockOffsetSec: clockDriftSec,
      networkMonitor,
      onLog: (lvl, msg, meta) => postLog(lvl, msg, meta)
    });

    sessionTracker.setSnapshotProvider(() => {
      return wtManager ? wtManager.getSnapshot(dispatcher) : {};
    });

    const boundPorts = await dispatcher.start({
      socks5Port: config.socks5Port,
      httpPort: config.httpPort,
      enableSocks5: true,
      enableHttp: true,
      autoDetectMode: config.autoDetectMode
    });

    isRunning = true;
    self.postMessage({ type: 'BOUND_PORTS', boundPorts });
    self.postMessage({ type: 'STARTED', boundPorts });
  } catch (err) {
    postLog('error', `❌ Failed to start proxy: ${err.message}`);
    await cleanupProxy();
    throw err;
  }
}

async function cleanupProxy() {
  isRunning = false;

  if (networkMonitor) {
    networkMonitor.stop();
    networkMonitor = null;
  }

  if (dispatcher) {
    try { await dispatcher.stop(); } catch (e) {}
    dispatcher = null;
  }

  if (wtManager) {
    try { await wtManager.close(); } catch (e) {}
    wtManager = null;
  }

  if (sessionTracker) {
    sessionTracker.setSnapshotProvider(null);
  }
}

async function stopProxy() {
  postLog('warning', 'Stopping all proxy services and listeners...');
  await cleanupProxy();
  postLog('info', 'All proxy services stopped.');
  self.postMessage({ type: 'STOPPED' });
}

self.onmessage = async (event) => {
  const msg = event.data;
  if (!msg || !msg.type) return;

  switch (msg.type) {
    case 'INIT':
      await initBridge(msg.wsUrl);
      break;
    case 'START':
      try {
        await startProxy(msg.config);
      } catch (err) {
        self.postMessage({ type: 'START_ERROR', error: err.message || String(err) });
      }
      break;
    case 'STOP':
      await stopProxy();
      break;
    default:
      break;
  }
};
