/**
 * Dedicated WebTransport Session Web Worker.
 * Handles WebTransport streaming off the main UI thread.
 */

import { WebTransportConnectionManager } from '../webtransport/wt-connection-manager.js';
import { BrookTunnel } from '../core/brook-tunnel.js';
import { createPortStreamBridge } from './worker-tunnel-bridge.js';

let sessionId = '';
let targetStr = 'unknown';
let wtManager = null;
let streamSession = null;
let isClosed = false;

function log(level, message, meta = null) {
  self.postMessage({
    type: 'LOG',
    level,
    message: `[WT Worker #${sessionId}] ${message}`,
    meta
  });
}

function cleanup() {
  if (isClosed) return;
  isClosed = true;

  if (streamSession) {
    try { streamSession.close(); } catch (e) {}
    streamSession = null;
  }
}

async function runWtTunnel({
  session,
  target,
  dstBytes,
  leftover,
  dialTimeoutMs = 8000,
  serverHost,
  serverPort,
  path = '/brook',
  password,
  withoutBrook = true,
  clockOffsetSec = 0,
  port
}) {
  sessionId = session;
  targetStr = target;
  isClosed = false;

  if (port && port.start) {
    try { port.start(); } catch (e) {}
  }

  const bridge = createPortStreamBridge(port);

  try {
    log('info', `Opening WebTransport stream to ${serverHost}:${serverPort}${path} for ${targetStr}`);

    wtManager = new WebTransportConnectionManager({
      serverHost,
      serverPort,
      path,
      onLog: (lvl, msg, meta) => log(lvl, msg, meta)
    });

    streamSession = await wtManager.createSession();

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
      onLog: (lvl, msg, meta) => log(lvl, msg, meta)
    });

    self.postMessage({
      type: 'DONE',
      sessionId,
      targetStr,
      outcome
    });
  } catch (err) {
    log('error', `❌ WebTransport tunnel failed for ${targetStr}: ${err.message}`);
    try { bridge.sendFailure(0x05); } catch (e) {}
    self.postMessage({
      type: 'DONE',
      sessionId,
      targetStr,
      outcome: { success: false, kind: 'wt_worker_error', error: err.message }
    });
  } finally {
    bridge.close();
    cleanup();
  }
}

self.onmessage = async (event) => {
  const msg = event.data;
  if (!msg) return;

  switch (msg.type) {
    case 'START_TUNNEL': {
      const port = event.ports ? event.ports[0] : msg.port;
      runWtTunnel({
        session: msg.sessionId,
        target: msg.targetStr,
        dstBytes: msg.dstBytes,
        leftover: msg.leftover,
        dialTimeoutMs: msg.dialTimeoutMs,
        serverHost: msg.serverHost,
        serverPort: msg.serverPort,
        path: msg.path || '/brook',
        password: msg.password,
        withoutBrook: msg.withoutBrook,
        clockOffsetSec: msg.clockOffsetSec,
        port
      });
      break;
    }
    case 'CLOSE': {
      cleanup();
      break;
    }
  }
};
