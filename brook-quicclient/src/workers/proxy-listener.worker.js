/**
 * Dedicated Proxy Listener Web Worker.
 * Owns inbound TCPServerSockets (SOCKS5 & HTTP CONNECT), client handshakes, and pipes client streams to QUIC Workers.
 */

import { TcpListener } from '../server/tcp-listener.js';
import { ProtocolDetector, ProtocolType } from '../protocols/protocol-detector.js';
import { Socks5Parser } from '../protocols/socks5-parser.js';
import { HttpProxyParser } from '../protocols/http-proxy-parser.js';
import { DnsResolver } from '../core/dns-resolver.js';
import { encodeAddress, parseHostPort } from '../core/byte-utils.js';

const listeners = new Map(); // name -> TcpListener
let isRunning = false;
let sessionCounter = 0;
const activeSessions = new Map(); // sessionId -> { socket, port, close }

function log(level, message, meta = null) {
  self.postMessage({
    type: 'LOG',
    level,
    message: `[Listener Worker] ${message}`,
    meta
  });
}

function postStats() {
  self.postMessage({
    type: 'STATS',
    stats: {
      activeClientConnections: activeSessions.size,
      totalSessionsServed: sessionCounter
    }
  });
}

async function startListeners(config) {
  await stopListeners();
  isRunning = true;

  const { socks5Port = 10808, httpPort = 8080, enableSocks5 = true, enableHttp = true, autoDetectMode = false } = config;
  let boundS5Port = socks5Port;
  let boundHttpPort = httpPort;

  try {
    if (autoDetectMode) {
      const listener = new TcpListener({
        localPort: socks5Port,
        onConnection: (socket, onDone) => handleClientConnection(socket, 'auto', onDone),
        onError: (err) => log('error', `Unified listener error: ${err.message}`),
        onClose: () => log('info', 'Unified listener closed'),
        onFallback: (reqPort, actualPort) => {
          log('warning', `⚠️ Chrome blocked fixed port ${reqPort}. Automatically assigned dynamic port ${actualPort}!`);
        }
      });
      await listener.start();
      boundS5Port = listener.localPort;
      boundHttpPort = listener.localPort;
      listeners.set('unified', listener);
      log('success', `⚡ Unified Auto-Detect Proxy listening on 127.0.0.1:${listener.localPort}`);
    } else {
      if (enableSocks5) {
        const s5Listener = new TcpListener({
          localPort: socks5Port,
          onConnection: (socket, onDone) => handleClientConnection(socket, 'socks5', onDone),
          onError: (err) => log('error', `SOCKS5 listener error: ${err.message}`),
          onClose: () => log('info', 'SOCKS5 listener closed'),
          onFallback: (reqPort, actualPort) => {
            log('warning', `⚠️ Chrome blocked fixed port ${reqPort}. Automatically assigned dynamic port ${actualPort}!`);
          }
        });
        await s5Listener.start();
        boundS5Port = s5Listener.localPort;
        listeners.set('socks5', s5Listener);
        log('success', `🧦 SOCKS5 Proxy listening on 127.0.0.1:${s5Listener.localPort}`);
      }

      if (enableHttp) {
        const httpListener = new TcpListener({
          localPort: httpPort,
          onConnection: (socket, onDone) => handleClientConnection(socket, 'http', onDone),
          onError: (err) => log('error', `HTTP Proxy listener error: ${err.message}`),
          onClose: () => log('info', 'HTTP Proxy listener closed'),
          onFallback: (reqPort, actualPort) => {
            log('warning', `⚠️ Chrome blocked fixed port ${reqPort}. Automatically assigned dynamic port ${actualPort}!`);
          }
        });
        await httpListener.start();
        boundHttpPort = httpListener.localPort;
        listeners.set('http', httpListener);
        log('success', `🌐 HTTP/HTTPS Proxy listening on 127.0.0.1:${httpListener.localPort}`);
      }
    }

    self.postMessage({
      type: 'LISTENERS_BOUND',
      boundPorts: {
        socks5Port: boundS5Port,
        httpPort: boundHttpPort
      }
    });
  } catch (err) {
    log('error', `Failed to start listeners: ${err.message}`);
    await stopListeners();
    throw err;
  }
}

async function stopListeners() {
  isRunning = false;
  for (const [name, listener] of listeners.entries()) {
    try {
      await listener.stop();
    } catch (e) {}
  }
  listeners.clear();

  for (const [id, session] of activeSessions.entries()) {
    try { session.close(); } catch (e) {}
  }
  activeSessions.clear();
  postStats();
}

async function handleClientConnection(socket, listenerType, onDone) {
  sessionCounter++;
  const sessionId = String(sessionCounter);
  const logTag = `[#${sessionId}]`;

  let reader = null;
  let writer = null;

  const cleanupSession = () => {
    activeSessions.delete(sessionId);
    postStats();
    if (onDone) onDone();
  };

  try {
    const opened = socket.opened ? (await socket.opened) : socket;
    reader = opened.readable.getReader();
    writer = opened.writable.getWriter();

    let targetStr = 'unknown';
    let dstBytes = null;
    let leftover = new Uint8Array(0);
    let isConnect = false;
    // 1. Initial Protocol Detection & Parsing
    const { value: initialChunk, done: initialDone } = await reader.read();
    if (initialDone || !initialChunk || initialChunk.length === 0) {
      reader.releaseLock();
      writer.releaseLock();
      cleanupSession();
      return;
    }

    let detectedProto = listenerType;
    if (listenerType === 'auto') {
      detectedProto = ProtocolDetector.detect(initialChunk);
    }

    let sendSuccess = null;
    let sendFailure = null;

    if (detectedProto === 'socks5' || detectedProto === ProtocolType.SOCKS5) {
      const s5Result = await Socks5Parser.handleHandshake(initialChunk, reader, writer, 8000);
      targetStr = s5Result.targetStr;
      dstBytes = s5Result.dstBytes;
      sendSuccess = s5Result.sendSuccess;
      sendFailure = s5Result.sendFailure;
    } else {
      const httpResult = await HttpProxyParser.handleHandshake(initialChunk, reader, writer, 8000);
      targetStr = httpResult.targetStr;
      dstBytes = httpResult.dstBytes;
      leftover = httpResult.leftover || new Uint8Array(0);
      isConnect = httpResult.isConnect;
      sendSuccess = httpResult.sendSuccess;
      sendFailure = httpResult.sendFailure;
    }

    log('info', `${logTag} Inbound proxy connection for ${targetStr}`);

    // 2. Create MessageChannel for zero-copy stream data piping to QUIC Worker
    const channel = new MessageChannel();
    const port1 = channel.port1;
    const port2 = channel.port2;

    activeSessions.set(sessionId, {
      socket,
      port: port1,
      close: () => {
        try { reader.cancel().catch(() => {}); } catch (e) {}
        try { writer.close().catch(() => {}); } catch (e) {}
        try { port1.close(); } catch (e) {}
      }
    });
    postStats();

    // Setup port message handler (QUIC Worker -> Client TCP Writer)
    let hasSentSuccess = false;
    port1.onmessage = async (e) => {
      const msg = e.data;
      if (!msg) return;

      if (msg.type === 'STREAM_READY') {
        if (!hasSentSuccess && sendSuccess) {
          hasSentSuccess = true;
          try { await sendSuccess(); } catch (err) {}
        }
      } else if (msg.type === 'STREAM_FAILED') {
        if (!hasSentSuccess && sendFailure) {
          hasSentSuccess = true;
          try { await sendFailure(msg.errorCode || 0x05); } catch (err) {}
        }
        cleanupSession();
      } else if (msg.type === 'STREAM_DATA') {
        try {
          const chunk = msg.chunk instanceof Uint8Array ? msg.chunk : new Uint8Array(msg.chunk);
          await writer.write(chunk);
        } catch (err) {
          port1.postMessage({ type: 'CLIENT_ABORT', reason: err.message });
          cleanupSession();
        }
      } else if (msg.type === 'STREAM_FIN') {
        try { await writer.close(); } catch (e) {}
        cleanupSession();
      } else if (msg.type === 'STREAM_ERROR' || msg.type === 'STREAM_CANCEL') {
        cleanupSession();
      }
    };

    // 3. Request QUIC Worker assignment from Main Thread
    self.postMessage({
      type: 'REQUEST_TUNNEL',
      sessionId,
      dstBytes,
      targetStr,
      leftover,
      dialTimeoutMs: 8000
    }, [port2]); // Transfers port2 directly to Main Thread -> QUIC Worker

    // 4. Start Client TCP Reader loop -> MessagePort
    (async () => {
      try {
        while (isRunning) {
          const { value, done } = await reader.read();
          if (done) {
            port1.postMessage({ type: 'CLIENT_FIN' });
            break;
          }
          if (value && value.length > 0) {
            const u8 = value instanceof Uint8Array ? value : new Uint8Array(value);
            if (u8.byteOffset === 0 && u8.byteLength === u8.buffer.byteLength) {
              port1.postMessage({ type: 'CLIENT_DATA', chunk: u8 }, [u8.buffer]);
            } else {
              const copy = new Uint8Array(u8);
              port1.postMessage({ type: 'CLIENT_DATA', chunk: copy }, [copy.buffer]);
            }
          }
        }
      } catch (err) {
        port1.postMessage({ type: 'CLIENT_ABORT', reason: err.message });
      } finally {
        try { reader.releaseLock(); } catch (e) {}
      }
    })();
  } catch (err) {
    log('error', `${logTag} Client handshake error: ${err.message}`);
    if (reader) {
      try { reader.releaseLock(); } catch (e) {}
    }
    if (writer) {
      try { writer.releaseLock(); } catch (e) {}
    }
    cleanupSession();
  }
}

// Message handler for commands from Main Thread
self.onmessage = async (event) => {
  const msg = event.data;
  if (!msg) return;

  switch (msg.type) {
    case 'START_LISTENERS': {
      try {
        await startListeners(msg.config);
      } catch (err) {
        self.postMessage({ type: 'LISTENERS_ERROR', error: err.message });
      }
      break;
    }
    case 'STOP_LISTENERS': {
      await stopListeners();
      self.postMessage({ type: 'LISTENERS_STOPPED' });
      break;
    }
  }
};
