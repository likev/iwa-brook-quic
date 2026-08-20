/**
 * WebTransport Stream Adapter: adapts a native WebTransportBidirectionalStream
 * to the stream session interface expected by BrookTunnel.
 */

export class WtStreamSession {
  constructor({ bidiStream, streamId = 0, onClose = null, onLog = null }) {
    this.bidiStream = bidiStream;
    this.streamId = streamId;
    this.onCloseCallback = onClose;
    this.onLog = onLog;

    this.reader = bidiStream.readable.getReader();
    this.writer = bidiStream.writable.getWriter();
    this.streamHandlers = new Map();
    this.isClosed = false;
    this.isConnected = true;

    this._startReadPump();
  }

  allocateStreamId() {
    return this.streamId;
  }

  registerStream(streamId, handlers) {
    this.streamHandlers.set(streamId, handlers);
  }

  unregisterStream(streamId) {
    this.streamHandlers.delete(streamId);
  }

  releaseStream(streamId) {
    this.unregisterStream(streamId);
  }

  async ensureConnected() {
    if (this.isClosed || !this.isConnected) {
      throw new Error('WebTransport stream session is closed');
    }
  }

  async sendStreamData(streamId, data, fin = false) {
    if (this.isClosed) {
      throw new Error('Cannot send stream data: WebTransport stream is closed');
    }
    const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
    if (u8.length > 0) {
      await this.writer.write(u8);
    }
    if (fin) {
      try {
        await this.writer.close();
      } catch (e) {}
    }
  }

  async _startReadPump() {
    try {
      while (!this.isClosed) {
        const { value, done } = await this.reader.read();
        if (done) {
          const handler = this.streamHandlers.get(this.streamId);
          if (handler && handler.onData) {
            handler.onData(new Uint8Array(0), true);
          }
          if (handler && handler.onClose) {
            handler.onClose();
          }
          break;
        }

        if (value && value.length > 0) {
          const handler = this.streamHandlers.get(this.streamId);
          if (handler && handler.onData) {
            handler.onData(value, false);
          }
        }
      }
    } catch (err) {
      if (!this.isClosed) {
        const handler = this.streamHandlers.get(this.streamId);
        if (handler && handler.onError) {
          handler.onError(err);
        }
      }
    } finally {
      this.close();
    }
  }

  close() {
    if (this.isClosed) return;
    this.isClosed = true;
    this.isConnected = false;

    for (const [id, handler] of this.streamHandlers.entries()) {
      if (handler.onClose) {
        try { handler.onClose(); } catch (e) {}
      }
    }
    this.streamHandlers.clear();

    try { this.reader.cancel().catch(() => {}); } catch (e) {}
    try { this.reader.releaseLock(); } catch (e) {}
    try { this.writer.close().catch(() => {}); } catch (e) {}
    try { this.writer.releaseLock(); } catch (e) {}

    if (this.onCloseCallback) {
      try { this.onCloseCallback(); } catch (e) {}
      this.onCloseCallback = null;
    }
  }
}
