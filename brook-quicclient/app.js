/**
 * Brook QUIC Client IWA — Main Application Bootstrap & Orchestrator.
 */

import { initTrustedTypesPolicy } from './src/ui/trusted-types-policy.js';
import { LogStream } from './src/ui/log-stream.js';
import { SessionTracker } from './src/server/session-tracker.js';
import { QuicConnectionManager } from './src/quic/quic-connection-manager.js';
import { ProxyDispatcher } from './src/server/proxy-dispatcher.js';
import { UiController } from './src/ui/ui-controller.js';
import { QuicWorkerPool } from './src/workers/quic-worker-pool.js';
import { ListenerWorkerClient } from './src/workers/listener-worker-client.js';

// 1. Initialize Trusted Types Policy for Strict IWA CSP
initTrustedTypesPolicy();

// 2. State & Components
let logStream = null;
let sessionTracker = null;
let quicWorkerPool = null;
let listenerClient = null;
let fallbackQuicManager = null;
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

  logStream.add('info', `🚀 Brook QUIC Client IWA v1.32.0 initialized (Multi-Worker Engine: ${HAS_WORKER_SUPPORT ? 'Enabled' : 'Single-Thread Fallback'})`);

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
      logStream.add('info', `Starting multi-threaded proxy with server ${config.serverHost}:${config.serverPort}...`);

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

        if (HAS_WORKER_SUPPORT) {
          // 2. Setup QUIC Worker Pool (Up to 10 QUIC connection workers)
          quicWorkerPool = new QuicWorkerPool({
            serverHost: config.serverHost,
            serverPort: config.serverPort,
            alpn: ['h3'],
            password: config.password,
            withoutBrook: config.withoutBrook,
            clockOffsetSec: clockDriftSec,
            maxWorkers: 10,
            minWorkers: 1,
            maxStreamsPerWorker: 8,
            onStateChange: (state, details) => {
              if (uiController) {
                uiController.updateConnectionState(state, details);
              }
            },
            onLog: (lvl, msg, meta) => {
              logStream.add(lvl, msg, meta);
            }
          });

          await quicWorkerPool.start();

          // 3. Setup Listener Worker (Worker #1)
          listenerClient = new ListenerWorkerClient({
            quicWorkerPool,
            onLog: (lvl, msg, meta) => {
              logStream.add(lvl, msg, meta);
            },
            onBoundPorts: (ports) => {
              if (uiController) {
                uiController.updateBoundPorts(ports);
              }
            }
          });

          const boundPorts = await listenerClient.start({
            socks5Port: config.socks5Port,
            httpPort: config.httpPort,
            enableSocks5: true,
            enableHttp: true,
            autoDetectMode: config.autoDetectMode
          });

          sessionTracker.setSnapshotProvider(() => {
            return quicWorkerPool ? quicWorkerPool.getSnapshot(listenerClient.getStats()) : {};
          });

          if (boundPorts && uiController) {
            uiController.updateBoundPorts(boundPorts);
          }
        } else {
          // Fallback single-thread mode for non-worker environments
          fallbackQuicManager = new QuicConnectionManager({
            serverHost: config.serverHost,
            serverPort: config.serverPort,
            alpn: ['h3'],
            onStateChange: (state, details) => {
              if (uiController) uiController.updateConnectionState(state, details);
            },
            onLog: (lvl, msg, meta) => logStream.add(lvl, msg, meta)
          });
          await fallbackQuicManager.connect();

          fallbackDispatcher = new ProxyDispatcher({
            quicManager: fallbackQuicManager,
            sessionTracker,
            password: config.password,
            withoutBrook: config.withoutBrook,
            clockOffsetSec: clockDriftSec,
            onLog: (lvl, msg, meta) => logStream.add(lvl, msg, meta)
          });

          sessionTracker.setSnapshotProvider(() => {
            return fallbackQuicManager ? fallbackQuicManager.getSnapshot(fallbackDispatcher) : {};
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
        }
      } catch (err) {
        logStream.add('error', `❌ Failed to start proxy: ${err.message}`);
        if (listenerClient) {
          try { await listenerClient.stop(); } catch (e) {}
          listenerClient = null;
        }
        if (quicWorkerPool) {
          try { await quicWorkerPool.close(); } catch (e) {}
          quicWorkerPool = null;
        }
        if (fallbackDispatcher) {
          try { await fallbackDispatcher.stop(); } catch (e) {}
          fallbackDispatcher = null;
        }
        if (fallbackQuicManager) {
          try { await fallbackQuicManager.close(); } catch (e) {}
          fallbackQuicManager = null;
        }
        throw err;
      }
    },
    onStop: async () => {
      logStream.add('warning', 'Stopping all proxy workers and listeners...');

      if (listenerClient) {
        try { await listenerClient.stop(); } catch (e) {}
        listenerClient = null;
      }

      if (quicWorkerPool) {
        try { await quicWorkerPool.close(); } catch (e) {}
        quicWorkerPool = null;
      }

      if (fallbackDispatcher) {
        try { await fallbackDispatcher.stop(); } catch (e) {}
        fallbackDispatcher = null;
      }

      if (fallbackQuicManager) {
        try { await fallbackQuicManager.close(); } catch (e) {}
        fallbackQuicManager = null;
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
