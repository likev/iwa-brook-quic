/**
 * Dedicated Per-Connection QUIC Session Web Worker.
 * Exclusively owns 1 QUIC Connection + 1 Direct Sockets UDPSocket for 1 Proxy Tunnel.
 * Spawned on-demand per connection and terminated on completion.
 */

import { QUICConnection } from '../../vendor/quic-engine.bundle.js';
import { UdpSocketAdapter } from '../quic/udp-socket-adapter.js';
import { BrookTunnel } from '../core/brook-tunnel.js';
import { createPortStreamBridge } from './worker-tunnel-bridge.js';

let sessionId = '';
let targetStr = 'unknown';
let udpAdapter = null;
let quic = null;
let isClosed = false;
let isConnected = false;

let nextStreamId = 0;
const streamHandlers = new Map(); // streamId -> { onData, onClose, onError }

function log(level, message, meta = null) {
  self.postMessage({
    type: 'LOG',
    level,
    message: `[QUIC Worker #${sessionId}] ${message}`,
    meta
  });
}

function postStats() {
  const udpStats = udpAdapter ? udpAdapter.getStats() : {};
  const stats = {
    sessionId,
    targetStr,
    isConnected,
    isClosed,
    rtt: quic && quic.context ? (quic.context.srtt || 0) : 0,
    rttVar: quic && quic.context ? (quic.context.rttvar || 0) : 0,
    cwnd: quic && quic.context ? (quic.context.limit_packets_in_flight || 0) : 0,
    bytesInFlight: quic && quic.context ? (quic.context.bytes_in_flight || 0) : 0,
    lostPackets: quic && quic.context ? (quic.context.lost_count || 0) : 0,
    bytesSent: udpStats.bytesSent || 0,
    bytesReceived: udpStats.bytesReceived || 0,
    packetsSent: udpStats.packetsSent || 0,
    packetsReceived: udpStats.packetsReceived || 0,
    udpQueue: udpStats.udpQueue || 0,
    udpQueueMax: udpStats.udpQueueMax || 0,
    packetEvictions: udpStats.packetEvictions || 0
  };
  self.postMessage({ type: 'STATS', sessionId, stats });
}

function cleanup(reason = 'Tunnel finished') {
  if (isClosed) return;
  isClosed = true;
  isConnected = false;

  for (const [sid, handler] of streamHandlers.entries()) {
    if (handler.onClose) handler.onClose();
  }
  streamHandlers.clear();

  if (quic) {
    try { quic.close(0, reason); } catch (e) {}
    quic = null;
  }
  if (udpAdapter) {
    try { udpAdapter.close(); } catch (e) {}
    udpAdapter = null;
  }

  postStats();
}

async function runQuicTunnel({
  session,
  target,
  dstBytes,
  leftover,
  dialTimeoutMs = 8000,
  serverHost,
  serverPort,
  alpn = ['h3'],
  password,
  withoutBrook = false,
  clockOffsetSec = 0,
  port
}) {
  sessionId = session;
  targetStr = target;
  isClosed = false;
  isConnected = false;
  nextStreamId = 0;

  if (port && port.start) {
    try { port.start(); } catch (e) {}
  }

  const bridge = createPortStreamBridge(port);

  try {
    log('info', `Initializing dedicated QUIC session to ${serverHost}:${serverPort} for ${targetStr}`);

    // 1. Open dedicated Direct Sockets UDPSocket for this connection (Chromium resolves hostnames internally)
    udpAdapter = new UdpSocketAdapter({
      remoteAddress: serverHost,
      remotePort: serverPort,
      onDatagram: (data, fromAddr, fromPort) => {
        if (quic && !isClosed) {
          quic.feedDatagram(fromAddr, fromPort, data);
        }
      },
      onError: (err) => {
        if (!isClosed) log('warning', `UDP Socket error: ${err.message}`);
      },
      onClose: () => {
        if (!isClosed) cleanup('UDP socket closed');
      },
      onLog: (lvl, msg, meta) => log(lvl, msg, meta)
    });

    await udpAdapter.open();

    // 2. Establish dedicated QUIC Connection
    await new Promise((resolve, reject) => {
      let resolved = false;
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          cleanup('Handshake timeout');
          reject(new Error(`QUIC handshake timed out for ${targetStr}`));
        }
      }, 25000);

      quic = new QUICConnection({
        isServer: false,
        hostname: serverHost,
        alpn: Array.isArray(alpn) ? alpn : [alpn],
        keepAlive: 2000,
        idleTimeout: 45000,
        handshakeTimeout: 25000,
        rejectUnauthorized: false
      });

      quic.on('packet', (data, meta) => {
        if (udpAdapter && !isClosed) {
          udpAdapter.send(data, meta).catch((err) => {
            log('error', `Failed to send UDP datagram: ${err.message}`);
          });
        }
      });

      quic.on('stream', (streamId, data, fin) => {
        const handler = streamHandlers.get(streamId);
        if (handler && handler.onData) handler.onData(data, fin);
      });

      quic.on('stream_close', (streamId) => {
        const handler = streamHandlers.get(streamId);
        if (handler && handler.onClose) handler.onClose();
      });

      quic.on('stream_error', (streamId, err) => {
        const handler = streamHandlers.get(streamId);
        if (handler && handler.onError) handler.onError(err);
      });

      quic.on('connect', () => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeout);
        isConnected = true;
        log('success', `⚡ QUIC connection established for ${targetStr}`);
        postStats();
        resolve();
      });

      quic.on('error', (err) => {
        log('error', `QUIC error: ${err.message}`);
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          reject(err);
        }
        cleanup(err.message);
      });

      quic.on('close', () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          reject(new Error('QUIC connection closed unexpectedly'));
        }
        cleanup('QUIC closed');
      });
    });

    // 3. Build virtual stream manager interface for BrookTunnel
    const streamSession = {
      allocateStreamId: () => {
        const id = nextStreamId;
        nextStreamId += 4;
        return id;
      },
      registerStream: (id, callbacks) => {
        streamHandlers.set(id, callbacks);
      },
      unregisterStream: (id) => {
        streamHandlers.delete(id);
      },
      ensureConnected: async () => {
        if (!isConnected || isClosed) throw new Error('QUIC not connected');
      },
      sendStreamData: async (id, data, fin = false) => {
        if (!quic || isClosed) throw new Error('QUIC session is closed');
        quic.sendStream(id, data, fin);
      }
    };

    // 4. Run BrookTunnel with zero-copy stream bridge to client
    const outcome = await BrookTunnel.run({
      clientReader: bridge.clientReader,
      clientWriter: bridge.clientWriter,
      quicManager: streamSession,
      dstBytes,
      leftover: leftover ? (leftover instanceof Uint8Array ? leftover : new Uint8Array(leftover)) : new Uint8Array(0),
      password,
      withoutBrook: Boolean(withoutBrook),
      clockOffsetSec: clockOffsetSec || 0,
      targetStr,
      sessionId,
      sendSuccess: bridge.sendSuccess,
      sendFailure: bridge.sendFailure,
      dialTimeoutMs,
      onBytes: () => postStats(),
      onLog: (lvl, msg, meta) => log(lvl, msg, meta)
    });

    self.postMessage({
      type: 'DONE',
      sessionId,
      targetStr,
      outcome
    });
  } catch (err) {
    log('error', `❌ Tunnel failed for ${targetStr}: ${err.message}`);
    try { bridge.sendFailure(0x05); } catch (e) {}
    self.postMessage({
      type: 'DONE',
      sessionId,
      targetStr,
      outcome: { success: false, kind: 'quic_worker_error', error: err.message }
    });
  } finally {
    bridge.close();
    cleanup();
  }
}

// Receive message from Main Thread
self.onmessage = async (event) => {
  const msg = event.data;
  if (!msg) return;

  switch (msg.type) {
    case 'START_TUNNEL': {
      const port = event.ports ? event.ports[0] : msg.port;
      runQuicTunnel({
        session: msg.sessionId,
        target: msg.targetStr,
        dstBytes: msg.dstBytes,
        leftover: msg.leftover,
        dialTimeoutMs: msg.dialTimeoutMs,
        serverHost: msg.serverHost,
        serverPort: msg.serverPort,
        alpn: msg.alpn,
        password: msg.password,
        withoutBrook: msg.withoutBrook,
        clockOffsetSec: msg.clockOffsetSec,
        port
      });
      break;
    }
    case 'CLOSE': {
      cleanup(msg.reason || 'Closed by manager');
      break;
    }
  }
};
