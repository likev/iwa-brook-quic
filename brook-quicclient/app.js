/**
 * Brook WebTransport Client IWA — Main Application Bootstrap & Orchestrator.
 * Uses native WebTransport (HTTP/3 QUIC) transport for high-performance proxying.
 */

import { initTrustedTypesPolicy } from './src/ui/trusted-types-policy.js';
import { LogStream } from './src/ui/log-stream.js';
import { SessionTracker } from './src/server/session-tracker.js';
import { WebTransportConnectionManager } from './src/webtransport/wt-connection-manager.js';
import { ProxyDispatcher } from './src/server/proxy-dispatcher.js';
import { UiController } from './src/ui/ui-controller.js';
import { WtWorkerManager } from './src/workers/wt-worker-manager.js';
import { ListenerWorkerClient } from './src/workers/listener-worker-client.js';

// 1. Initialize Trusted Types Policy for Strict IWA CSP
initTrustedTypesPolicy();

// 2. State & Components
let logStream = null;
let sessionTracker = null;
let wtWorkerManager = null;
let listenerClient = null;
let fallbackWtManager = null;
let fallbackDispatcher = null;
let uiController = null;

const HAS_WORKER_SUPPORT = typeof window !== 'undefined' && typeof window.Worker !== 'undefined';

async function bootstrap() {
  // Initialize UI Log Stream
  const logContainer = document.getElementById('log-stream-container');
  const modalContainer = document.getElementById('modal-container');
  logStream = new LogStream({
    container: logContainer,
    maxLogs: 500,
    modalContainer
  });

  logStream.add('info', `🚀 Brook WebTransport Client IWA v2.0.0 initialized (Engine: Native WebTransport / HTTP/3 QUIC)`);

  // Initialize Session Tracker & Telemetry
  sessionTracker = new SessionTracker({
    onStatsUpdate: (stats) => {
      if (uiController) {
        uiController.updateStats(stats);
      }
    }
  });

  // Initialize UI Controller
  uiController = new UiController({
    logStream,
    onStart: async (config) => {
      const serverPath = config.serverPath || '/brook';
      logStream.add('info', `Starting WebTransport proxy connected to https://${config.serverHost}:${config.serverPort}${serverPath}...`);

      try {
        // 1. Auto-synchronize network clock drift
        const clockDriftSec = await WebTransportConnectionManager.measureClockDrift();
        if (Math.abs(clockDriftSec) > 1) {
          logStream.add('info', `⏱️ Network time sync: local clock drift is ${clockDriftSec > 0 ? '+' : ''}${clockDriftSec}s (auto-compensated)`);
        }

        // 2. Setup Unified WebTransport Manager (5-session parallel QUIC pool)
        fallbackWtManager = new WebTransportConnectionManager({
          serverHost: config.serverHost,
          serverPort: config.serverPort,
          path: serverPath,
          serverCertificateHashes: config.serverCertificateHashes || [],
          poolSize: 5,
          onStateChange: (state, details) => {
            if (uiController) uiController.updateConnectionState(state, details);
          },
          onLog: (lvl, msg, meta) => logStream.add(lvl, msg, meta)
        });

        // Pre-connect WebTransport session pool in parallel
        try {
          await fallbackWtManager.connect();
        } catch (e) {
          logStream.add('warning', `Initial WebTransport pool connection pending: ${e.message} (will connect on first proxy request)`);
        }

        // 3. Setup Proxy Dispatcher
        fallbackDispatcher = new ProxyDispatcher({
          quicManager: fallbackWtManager,
          sessionTracker,
          password: config.password,
          withoutBrook: config.withoutBrook !== undefined ? config.withoutBrook : true,
          clockOffsetSec: clockDriftSec,
          onLog: (lvl, msg, meta) => logStream.add(lvl, msg, meta)
        });

        sessionTracker.setSnapshotProvider(() => {
          return fallbackWtManager ? fallbackWtManager.getSnapshot(fallbackDispatcher) : {};
        });

        const boundPorts = await fallbackDispatcher.start({
          socks5Port: config.socks5Port,
          httpPort: config.httpPort,
          enableSocks5: true,
          enableHttp: true,
          autoDetectMode: config.autoDetectMode
        });

        if (boundPorts && uiController) {
          uiController.updateBoundPorts(boundPorts);
        }
      } catch (err) {
        logStream.add('error', `❌ Failed to start proxy: ${err.message}`);
        if (fallbackDispatcher) {
          try { await fallbackDispatcher.stop(); } catch (e) {}
          fallbackDispatcher = null;
        }
        if (fallbackWtManager) {
          try { await fallbackWtManager.close(); } catch (e) {}
          fallbackWtManager = null;
        }
        throw err;
      }
    },
    onStop: async () => {
      logStream.add('warning', 'Stopping all proxy services and listeners...');

      if (fallbackDispatcher) {
        try { await fallbackDispatcher.stop(); } catch (e) {}
        fallbackDispatcher = null;
      }

      if (fallbackWtManager) {
        try { await fallbackWtManager.close(); } catch (e) {}
        fallbackWtManager = null;
      }

      sessionTracker.setSnapshotProvider(null);
      logStream.add('info', 'All proxy services stopped.');
    }
  });

  // Fast Wi-Fi & Network Recovery Listeners
  if (typeof window !== 'undefined') {
    window.addEventListener('offline', () => {
      if (logStream) logStream.add('warning', '⚠️ Network/Wi-Fi connection lost (offline). Resetting WebTransport pool sessions...');
      if (fallbackWtManager) fallbackWtManager.resetSession('network_offline');
      if (uiController) uiController.updateConnectionState('reconnecting', 'Wi-Fi Offline');
    });

    window.addEventListener('online', async () => {
      if (logStream) logStream.add('success', '🌐 Network/Wi-Fi connection restored (online). Resyncing clock & reconnecting WebTransport pool...');
      try {
        const drift = await WebTransportConnectionManager.measureClockDrift();
        if (fallbackDispatcher) {
          fallbackDispatcher.clockOffsetSec = drift;
        }
        if (Math.abs(drift) > 1 && logStream) {
          logStream.add('info', `⏱️ Network time sync: clock drift updated to ${drift > 0 ? '+' : ''}${drift}s`);
        }
      } catch (e) {}
      if (fallbackWtManager) fallbackWtManager.connect().catch(() => {});
      if (uiController) uiController.updateConnectionState('connected', 'Online');
    });
  }
}

// Start application when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
