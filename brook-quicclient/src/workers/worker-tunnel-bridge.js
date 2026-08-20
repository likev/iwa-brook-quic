/**
 * Worker Tunnel Bridge: bridges a MessagePort to the BrookTunnel stream interface.
 * Enables zero-copy ArrayBuffer streaming between Proxy Listener Worker and QUIC Session Workers.
 */

export function createPortStreamBridge(port) {
  const readQueue = [];
  let pendingReadResolve = null;
  let isClosed = false;

  if (port && port.start) {
    try { port.start(); } catch (e) {}
  }

  port.onmessage = (event) => {
    const msg = event.data;
    if (!msg) return;

    if (msg.type === 'CLIENT_DATA') {
      const chunk = msg.chunk instanceof Uint8Array ? msg.chunk : new Uint8Array(msg.chunk);
      if (pendingReadResolve) {
        const resolve = pendingReadResolve;
        pendingReadResolve = null;
        resolve({ value: chunk, done: false });
      } else {
        readQueue.push({ value: chunk, done: false });
      }
    } else if (msg.type === 'CLIENT_FIN') {
      isClosed = true;
      if (pendingReadResolve) {
        const resolve = pendingReadResolve;
        pendingReadResolve = null;
        resolve({ value: undefined, done: true });
      } else {
        readQueue.push({ value: undefined, done: true });
      }
    } else if (msg.type === 'CLIENT_ABORT') {
      isClosed = true;
      if (pendingReadResolve) {
        const resolve = pendingReadResolve;
        pendingReadResolve = null;
        resolve({ value: undefined, done: true });
      }
    }
  };

  const clientReader = {
    read: () => {
      if (readQueue.length > 0) {
        return Promise.resolve(readQueue.shift());
      }
      if (isClosed) {
        return Promise.resolve({ value: undefined, done: true });
      }
      return new Promise((resolve) => {
        pendingReadResolve = resolve;
      });
    },
    releaseLock: () => {},
    cancel: async () => {
      isClosed = true;
      try {
        port.postMessage({ type: 'STREAM_CANCEL' });
      } catch (e) {}
    }
  };

  const clientWriter = {
    write: async (chunk) => {
      const u8 = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
      try {
        // Zero-copy transfer if buffer is aligned/standalone, or direct transfer
        if (u8.byteOffset === 0 && u8.byteLength === u8.buffer.byteLength) {
          port.postMessage({ type: 'STREAM_DATA', chunk: u8 }, [u8.buffer]);
        } else {
          // Subarray view: copy to fresh standalone buffer for zero-copy port transfer
          const copy = new Uint8Array(u8);
          port.postMessage({ type: 'STREAM_DATA', chunk: copy }, [copy.buffer]);
        }
      } catch (e) {
        port.postMessage({ type: 'STREAM_DATA', chunk: u8 });
      }
    },
    close: async () => {
      try {
        port.postMessage({ type: 'STREAM_FIN' });
      } catch (e) {}
    },
    abort: async (reason) => {
      try {
        port.postMessage({ type: 'STREAM_ERROR', error: reason ? (reason.message || String(reason)) : 'Stream aborted' });
      } catch (e) {}
    },
    releaseLock: () => {}
  };

  const sendSuccess = async () => {
    try {
      port.postMessage({ type: 'STREAM_READY' });
    } catch (e) {}
  };

  const sendFailure = async (errorCode = 0x05) => {
    try {
      port.postMessage({ type: 'STREAM_FAILED', errorCode });
    } catch (e) {}
  };

  return {
    clientReader,
    clientWriter,
    sendSuccess,
    sendFailure,
    close: () => {
      isClosed = true;
      try { port.close(); } catch (e) {}
    }
  };
}
