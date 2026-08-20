/**
 * Dedicated QUIC Session Web Worker.
 * Owns 1 QUIC Connection + 1 Direct Sockets UDPSocket, running crypto and multiplexed tunnels in isolation.
 */

import { QUICConnection } from '../../vendor/quic-engine.bundle.js';
import { UdpSocketAdapter } from '../quic/udp-socket-adapter.js';
import { BrookTunnel } from '../core/brook-tunnel.js';
import { createPortStreamBridge } from './worker-tunnel-bridge.js';

let workerId = 0;
let serverHost = '127.0.0.1';
let serverPort = 4433;
let alpn = ['h3'];
let password = '';
let withoutBrook = false;
let clockOffsetSec = 0;

let udpAdapter = null;
let quic = null;
let isConnected = false;
let isClosed = false;

let nextStreamId = 0;
let activeStreams = 0;
const maxConcurrentStreams = 8;
let totalStreamsServed = 0;
let lastPacketReceivedTime = Date.now();
const activeTunnels = new Map(); // sessionId -> tunnelState

const streamHandlers = new Map(); // streamId -> { onData, onClose, onError }

function log(level, message, meta = null) {
  self.postMessage({
    type: 'LOG',
    level,
    message: `[QUIC Worker #${workerId}] ${message}`,
    meta
  });
}

function postStats() {
  const udpStats = udpAdapter ? udpAdapter.getStats() : {};
  const stats = {
    workerId,
    isConnected,
    isClosed,
    activeStreams,
    totalStreamsServed,
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
  self.postMessage({ type: 'STATS', stats });
}

async function initQuicSession(config) {
  workerId = config.workerId || 0;
  serverHost = config.serverHost;
  serverPort = config.serverPort;
  alpn = config.alpn || ['h3'];
  password = config.password;
  withoutBrook = Boolean(config.withoutBrook);
  clockOffsetSec = config.clockOffsetSec || 0;

  isClosed = false;
  isConnected = false;
  nextStreamId = 0;
  activeStreams = 0;

  self.postMessage({ type: 'STATE_CHANGE', state: 'connecting', details: `Connecting to ${serverHost}:${serverPort}...` });

  udpAdapter = new UdpSocketAdapter({
    remoteAddress: serverHost,
    remotePort: serverPort,
    onDatagram: (data, fromAddr, fromPort) => {
      lastPacketReceivedTime = Date.now();
      if (quic && !isClosed) {
        quic.feedDatagram(fromAddr, fromPort, data);
      }
    },
    onError: (err) => {
      if (!isClosed) {
        log('warning', `UDP Socket error: ${err.message}`);
      }
    },
    onClose: () => {
      if (!isClosed) {
        closeSession('UDP transport closed');
      }
    },
    onLog: (lvl, msg, meta) => log(lvl, msg, meta)
  });

  await udpAdapter.open();

  return new Promise((resolve, reject) => {
    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        closeSession('Handshake timeout');
        reject(new Error(`QUIC handshake timed out in Worker #${workerId}`));
      }
    }, 25000);

    quic = new QUICConnection({
      isServer: false,
      hostname: serverHost,
      alpn: alpn,
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
      if (handler && handler.onData) {
        handler.onData(data, fin);
      }
    });

    quic.on('stream_close', (streamId) => {
      const handler = streamHandlers.get(streamId);
      if (handler && handler.onClose) {
        handler.onClose();
      }
    });

    quic.on('stream_error', (streamId, err) => {
      const handler = streamHandlers.get(streamId);
      if (handler && handler.onError) {
        handler.onError(err);
      }
    });

    quic.on('connected', () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      isConnected = true;
      self.postMessage({ type: 'STATE_CHANGE', state: 'connected', details: `QUIC session ready on Worker #${workerId}` });
      log('success', `⚡ QUIC connection established on Worker #${workerId}`);
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
      closeSession(err.message);
    });

    quic.on('close', () => {
      closeSession('QUIC closed');
    });

    quic.init();
  });
}

function closeSession(reason = 'Normal close') {
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

  self.postMessage({ type: 'STATE_CHANGE', state: 'disconnected', details: reason });
  log('info', `Session closed: ${reason}`);
  postStats();
}

async function handleAllocateTunnel({ sessionId, dstBytes, targetStr, leftover, dialTimeoutMs, port }) {
  if (!isConnected || isClosed) {
    port.postMessage({ type: 'STREAM_FAILED', errorCode: 0x01 });
    port.close();
    return;
  }

  activeStreams++;
  totalStreamsServed++;
  postStats();

  const bridge = createPortStreamBridge(port);
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

  try {
    const outcome = await BrookTunnel.run({
      clientReader: bridge.clientReader,
      clientWriter: bridge.clientWriter,
      quicManager: streamSession,
      dstBytes,
      leftover: leftover ? (leftover instanceof Uint8Array ? leftover : new Uint8Array(leftover)) : new Uint8Array(0),
      password,
      withoutBrook,
      clockOffsetSec,
      targetStr,
      sessionId,
      sendSuccess: bridge.sendSuccess,
      sendFailure: bridge.sendFailure,
      dialTimeoutMs: dialTimeoutMs || 8000,
      onBytes: (sent, recv) => {
        // Accounting
      },
      onLog: (lvl, msg, meta) => log(lvl, msg, meta)
    });

    self.postMessage({
      type: 'TUNNEL_OUTCOME',
      sessionId,
      outcome
    });
  } catch (err) {
    self.postMessage({
      type: 'TUNNEL_OUTCOME',
      sessionId,
      outcome: { success: false, kind: 'worker_tunnel_error', error: err.message }
    });
  } finally {
    activeStreams = Math.max(0, activeStreams - 1);
    bridge.close();
    postStats();
  }
}

// Listen for commands from Main Orchestrator
self.onmessage = async (event) => {
  const msg = event.data;
  if (!msg) return;

  switch (msg.type) {
    case 'INIT': {
      try {
        await initQuicSession(msg.config);
        self.postMessage({ type: 'INIT_SUCCESS', workerId });
      } catch (err) {
        self.postMessage({ type: 'INIT_FAILURE', workerId, error: err.message });
      }
      break;
    }
    case 'ALLOCATE_TUNNEL': {
      const port = event.ports ? event.ports[0] : msg.port;
      handleAllocateTunnel({
        sessionId: msg.sessionId,
        dstBytes: msg.dstBytes,
        targetStr: msg.targetStr,
        leftover: msg.leftover,
        dialTimeoutMs: msg.dialTimeoutMs,
        port
      });
      break;
    }
    case 'GET_STATS': {
      postStats();
      break;
    }
    case 'CLOSE': {
      closeSession(msg.reason || 'Requested by orchestrator');
      break;
    }
  }
};
