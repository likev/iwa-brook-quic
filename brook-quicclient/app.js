/**
 * Brook QUIC Client IWA — Main Application Bootstrap & Orchestrator.
 */

import { initTrustedTypesPolicy } from './src/ui/trusted-types-policy.js';
import { LogStream } from './src/ui/log-stream.js';
import { SessionTracker } from './src/server/session-tracker.js';
import { QuicConnectionManager } from './src/quic/quic-connection-manager.js';
import { ProxyDispatcher } from './src/server/proxy-dispatcher.js';
import { UiController } from './src/ui/ui-controller.js';

// 1. Initialize Trusted Types Policy for Strict IWA CSP
initTrustedTypesPolicy();

// 2. State & Components
let logStream = null;
let sessionTracker = null;
let quicManager = null;
let proxyDispatcher = null;
let uiController = null;

async function bootstrap() {
  // Initialize UI Log Stream
  const logContainer = document.getElementById('log-stream-container');
  const modalContainer = document.getElementById('modal-container');
  logStream = new LogStream({
    container: logContainer,
    maxLogs: 500,
    modalContainer
  });

  logStream.add('info', '🚀 Brook QUIC Client IWA v1.30.1 initialized');

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
      logStream.add('info', `Starting proxy services with server ${config.serverHost}:${config.serverPort}...`);

      // 0. Preflight check for Direct Sockets / IWA isolation
      if (typeof window !== 'undefined' && (!window.crossOriginIsolated || typeof window.UDPSocket === 'undefined')) {
        logStream.add('warning', '⚠️ Direct Sockets requires an Isolated Web App context (isolated-app://) or Chrome IWA flags.');
      }

      try {
        // 1. Auto-synchronize network clock drift
        const clockDriftSec = await QuicConnectionManager.measureClockDrift();
        if (Math.abs(clockDriftSec) > 1) {
          logStream.add('info', `⏱️ Network time sync: local clock drift is ${clockDriftSec > 0 ? '+' : ''}${clockDriftSec}s (auto-compensated)`);
        }

        // 2. Setup QUIC Connection Manager
        quicManager = new QuicConnectionManager({
          serverHost: config.serverHost,
          serverPort: config.serverPort,
          alpn: ['h3'],
          onStateChange: (state, details) => {
            if (uiController) {
              uiController.updateConnectionState(state, details);
            }
          },
          onLog: (lvl, msg, meta) => {
            logStream.add(lvl, msg, meta);
          }
        });

        // Connect to Brook QUIC server
        await quicManager.connect();

        // 3. Setup Proxy Dispatcher
        proxyDispatcher = new ProxyDispatcher({
          quicManager,
          sessionTracker,
          password: config.password,
          withoutBrook: config.withoutBrook,
          clockOffsetSec: clockDriftSec,
          onLog: (lvl, msg, meta) => {
            logStream.add(lvl, msg, meta);
          }
        });

        sessionTracker.setSnapshotProvider(() => {
          return quicManager ? quicManager.getSnapshot(proxyDispatcher) : {};
        });

        // 4. Start Inbound Listeners
        const boundPorts = await proxyDispatcher.start({
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
        // Transactional rollback on startup failure
        if (proxyDispatcher) {
          try { await proxyDispatcher.stop(); } catch (e) {}
          proxyDispatcher = null;
        }
        if (quicManager) {
          try { await quicManager.close(); } catch (e) {}
          quicManager = null;
        }
        throw err;
      }
    },
    onStop: async () => {
      logStream.add('warning', 'Stopping all proxy listeners and closing QUIC session...');

      if (proxyDispatcher) {
        try { await proxyDispatcher.stop(); } catch (e) {}
        proxyDispatcher = null;
      }

      if (quicManager) {
        try { await quicManager.close(); } catch (e) {}
        quicManager = null;
      }

      sessionTracker.setSnapshotProvider(null);

      logStream.add('info', 'All proxy services stopped.');
    }
  });
}

// Start application when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
