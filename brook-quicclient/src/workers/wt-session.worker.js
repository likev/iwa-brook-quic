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
  let proxyReplied = false;
  let clientDataConsumed = false;

  const sendSuccessOnce = async () => {
    if (!proxyReplied) {
      proxyReplied = true;
      try { await bridge.sendSuccess(); } catch (e) {}
    }
  };

  const sendFailureOnce = async (errorCode = 0x05) => {
    if (!proxyReplied) {
      proxyReplied = true;
      try { await bridge.sendFailure(errorCode); } catch (e) {}
    }
  };

  const MAX_ATTEMPTS = 3;
  let finalOutcome = null;
  let lastError = null;

  try {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (isClosed) break;

      const isFinalAttempt = (attempt === MAX_ATTEMPTS);
      const attemptTimeoutMs = attempt === 1 ? 4000 : (attempt === 2 ? 6000 : 8000);

      try {
        if (wtManager) {
          try { await wtManager.close(); } catch (e) {}
          wtManager = null;
        }

        wtManager = new WebTransportConnectionManager({
          serverHost,
          serverPort,
          path,
          poolSize: 1,
          onLog: (lvl, msg, meta) => log(lvl, msg, meta)
        });

        streamSession = await wtManager.createSession({
          connectTimeoutMs: attemptTimeoutMs,
          streamTimeoutMs: 4000
        });
      } catch (sessErr) {
        lastError = sessErr;
        log('warning', `⚠️ [Attempt ${attempt}/${MAX_ATTEMPTS}] Connection to WebTransport server failed: ${sessErr.message}`);
        if (isFinalAttempt) break;
        await new Promise(r => setTimeout(r, 400));
        continue;
      }

      try {
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
          sendSuccess: sendSuccessOnce,
          sendFailure: isFinalAttempt ? sendFailureOnce : null,
          dialTimeoutMs: attemptTimeoutMs,
          closeClientStreams: isFinalAttempt,
          onClientDataRead: () => {
            clientDataConsumed = true;
          },
          onBytes: (sent, recv) => {
            self.postMessage({
              type: 'BYTES',
              sessionId,
              sent,
              recv
            });
          },
          onLog: (lvl, msg, meta) => log(lvl, msg, meta)
        });

        finalOutcome = outcome;

        if (outcome.success) {
          lastError = null;
          break;
        } else {
          lastError = outcome.error || new Error(`Brook tunnel failed (${outcome.kind})`);
          if (streamSession) {
            try { streamSession.close(); } catch (e) {}
            streamSession = null;
          }

          // If client data was already consumed or server started sending payload or client aborted, do not retry
          if (clientDataConsumed || proxyReplied || (outcome.bytesReceived && outcome.bytesReceived > 0) || outcome.kind === 'client_abort' || outcome.kind === 'client_read_error' || outcome.kind === 'rx_overflow') {
            break;
          }

          if (attempt < MAX_ATTEMPTS) {
            log('info', `🔄 Retrying WebTransport tunnel for ${targetStr} (attempt ${attempt + 1}/${MAX_ATTEMPTS})...`);
            await new Promise(r => setTimeout(r, 400));
          }
        }
      } catch (tunnelErr) {
        lastError = tunnelErr;
        if (clientDataConsumed || proxyReplied || isFinalAttempt) break;
        await new Promise(r => setTimeout(r, 400));
      }
    }

    if (finalOutcome && finalOutcome.success) {
      self.postMessage({
        type: 'DONE',
        sessionId,
        targetStr,
        outcome: finalOutcome
      });
    } else {
      const errMsg = lastError ? (lastError.message || String(lastError)) : 'All connection attempts failed';
      log('error', `❌ WebTransport tunnel failed for ${targetStr}: ${errMsg}`);
      await sendFailureOnce(0x05);
      self.postMessage({
        type: 'DONE',
        sessionId,
        targetStr,
        outcome: finalOutcome || { success: false, kind: 'wt_worker_error', error: errMsg }
      });
    }
  } catch (err) {
    log('error', `❌ WebTransport tunnel fatal exception for ${targetStr}: ${err.message}`);
    await sendFailureOnce(0x05);
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
