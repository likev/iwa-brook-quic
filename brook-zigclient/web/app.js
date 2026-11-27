/**
 * Brook Zig Client — Main Thread UI Shell.
 * Delegates the entire proxy engine (Zig WS TCP Bridge, SOCKS5/HTTP parsers,
 * Brook crypto, NetworkMonitor, WebTransport/HTTP3 + WS fallback) to a dedicated
 * Module Web Worker so background tab throttling cannot interrupt active tunnels.
 */

import { initTrustedTypesPolicy } from './src/ui/trusted-types-policy.js';
import { LogStream } from './src/ui/log-stream.js';
import { UiController } from './src/ui/ui-controller.js';

initTrustedTypesPolicy();

let logStream = null;
let uiController = null;
let engineWorker = null;
let pendingStart = null;
let pendingStop = null;
let didAutoStart = false;

async function fetchHostConfig(token) {
  if (!token) return null;
  try {
    const resp = await fetch(`/api/config?token=${encodeURIComponent(token)}`, { cache: 'no-store' });
    if (resp.ok) {
      return await resp.json();
    }
  } catch (e) {}
  return null;
}

async function bootstrap() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token') || '';

  const logContainer = document.getElementById('log-stream-container');
  const modalContainer = document.getElementById('modal-container');
  logStream = new LogStream({
    container: logContainer,
    maxLogs: 500,
    modalContainer
  });

  logStream.add('info', '🚀 Brook Zig Client v1.0.0 initialized (Engine: Dedicated Web Worker + Zig Native TCP Bridge)');

  if (!token) {
    logStream.add('error', '❌ Missing ?token= query parameter. Open the exact URL printed by brook-zigclient.');
  }

  const hostConfig = await fetchHostConfig(token);

  // Spawn Dedicated Proxy Engine Web Worker
  const workerUrl = new URL('./src/workers/proxy-engine.worker.js', import.meta.url);
  engineWorker = new Worker(workerUrl, { type: 'module' });

  uiController = new UiController({
    logStream,
    token,
    initialConfig: hostConfig,
    onStart: (config) => new Promise((resolve, reject) => {
      pendingStart = { resolve, reject };
      engineWorker.postMessage({ type: 'START', config });
    }),
    onStop: () => new Promise((resolve) => {
      pendingStop = { resolve };
      engineWorker.postMessage({ type: 'STOP' });
    })
  });

  engineWorker.onmessage = (event) => {
    const msg = event.data;
    if (!msg || !msg.type) return;

    switch (msg.type) {
      case 'LOG':
        logStream.add(msg.level || 'info', msg.message || '', msg.meta || null);
        break;
      case 'STATS':
        uiController.updateStats(msg.stats);
        break;
      case 'STATE':
        uiController.updateConnectionState(msg.state, msg.detail || '');
        break;
      case 'BRIDGE_STATE':
        uiController.updateBridgeState(msg.state, msg.detail || '');
        break;
      case 'BOUND_PORTS':
        if (msg.boundPorts) uiController.updateBoundPorts(msg.boundPorts);
        break;
      case 'BRIDGE_READY':
        if (msg.info && msg.info.config) {
          uiController.applyConfig(msg.info.config);
        }
        if (msg.info && msg.info.autoStart && !didAutoStart && !uiController.isRunning) {
          didAutoStart = true;
          logStream.add('info', '⚡ Auto-starting proxy (--auto-start enabled)...');
          uiController.handleStart();
        }
        break;
      case 'STARTED':
        if (msg.boundPorts) uiController.updateBoundPorts(msg.boundPorts);
        if (pendingStart) {
          const { resolve } = pendingStart;
          pendingStart = null;
          resolve(msg.boundPorts);
        }
        break;
      case 'START_ERROR':
        if (pendingStart) {
          const { reject } = pendingStart;
          pendingStart = null;
          reject(new Error(msg.error || 'Failed to start proxy'));
        }
        break;
      case 'STOPPED':
        if (pendingStop) {
          const { resolve } = pendingStop;
          pendingStop = null;
          resolve();
        }
        break;
      default:
        break;
    }
  };

  engineWorker.onerror = (err) => {
    logStream.add('error', `❌ Proxy Engine Worker error: ${err.message || err}`);
    if (pendingStart) {
      const { reject } = pendingStart;
      pendingStart = null;
      reject(new Error(err.message || 'Worker error'));
    }
  };

  const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${wsProto}//${window.location.host}/ws?token=${encodeURIComponent(token)}`;
  engineWorker.postMessage({ type: 'INIT', wsUrl });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
