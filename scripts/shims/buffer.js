// Polyfill global Node.js environment objects for pure browser execution

export const Buffer = {
  isBuffer: (val) => val instanceof Uint8Array || (val && val.buffer instanceof ArrayBuffer),
  from: (val, encoding) => {
    if (typeof val === 'string') {
      if (encoding === 'hex') {
        const clean = val.replace(/[^0-9a-fA-F]/g, '');
        const bytes = new Uint8Array(Math.floor(clean.length / 2));
        for (let i = 0; i < bytes.length; i++) {
          bytes[i] = parseInt(clean.substr(i * 2, 2), 16);
        }
        return bytes;
      }
      if (encoding === 'base64') {
        const bin = atob(val);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return bytes;
      }
      return new TextEncoder().encode(val);
    }
    if (val instanceof Uint8Array) return val;
    if (Array.isArray(val)) return new Uint8Array(val);
    if (val instanceof ArrayBuffer) return new Uint8Array(val);
    return new Uint8Array(0);
  },
  alloc: (size) => new Uint8Array(size),
  allocUnsafe: (size) => new Uint8Array(size),
  concat: (list, totalLength) => {
    if (!totalLength) totalLength = list.reduce((acc, b) => acc + (b ? b.length : 0), 0);
    const res = new Uint8Array(totalLength);
    let offset = 0;
    for (const b of list) {
      if (!b) continue;
      res.set(b, offset);
      offset += b.length;
    }
    return res;
  }
};

// Assign global Buffer
if (typeof globalThis !== 'undefined') {
  globalThis.Buffer = Buffer;
}
if (typeof window !== 'undefined') {
  window.Buffer = Buffer;
}
if (typeof global !== 'undefined') {
  global.Buffer = Buffer;
}

// Polyfill process
if (typeof globalThis.process === 'undefined') {
  globalThis.process = {
    env: {},
    nextTick: (fn, ...args) => queueMicrotask(() => fn(...args)),
    browser: true
  };
} else {
  if (!globalThis.process.env) globalThis.process.env = {};
  if (!globalThis.process.nextTick) globalThis.process.nextTick = (fn, ...args) => queueMicrotask(() => fn(...args));
}

// Polyfill setImmediate / clearImmediate
if (typeof globalThis.setImmediate === 'undefined') {
  globalThis.setImmediate = (fn, ...args) => setTimeout(fn, 0, ...args);
}
if (typeof globalThis.clearImmediate === 'undefined') {
  globalThis.clearImmediate = (id) => clearTimeout(id);
}

// Ensure Uint8Array has buffer-like helper methods for zero-copy compatibility
if (typeof Uint8Array !== 'undefined') {
  if (!Uint8Array.prototype.copy) {
    Uint8Array.prototype.copy = function(target, targetStart = 0, sourceStart = 0, sourceEnd = this.length) {
      const slice = this.subarray(sourceStart, sourceEnd);
      target.set(slice, targetStart);
      return slice.length;
    };
  }
  if (!Uint8Array.prototype.readUInt32BE) {
    Uint8Array.prototype.readUInt32BE = function(offset = 0) {
      return ((this[offset] << 24) >>> 0) | (this[offset + 1] << 16) | (this[offset + 2] << 8) | this[offset + 3];
    };
  }
  if (!Uint8Array.prototype.readUInt16BE) {
    Uint8Array.prototype.readUInt16BE = function(offset = 0) {
      return (this[offset] << 8) | this[offset + 1];
    };
  }
  if (!Uint8Array.prototype.writeUInt32BE) {
    Uint8Array.prototype.writeUInt32BE = function(val, offset = 0) {
      this[offset] = (val >>> 24) & 0xFF;
      this[offset + 1] = (val >>> 16) & 0xFF;
      this[offset + 2] = (val >>> 8) & 0xFF;
      this[offset + 3] = val & 0xFF;
      return offset + 4;
    };
  }
  if (!Uint8Array.prototype.writeUInt16BE) {
    Uint8Array.prototype.writeUInt16BE = function(val, offset = 0) {
      this[offset] = (val >>> 8) & 0xFF;
      this[offset + 1] = val & 0xFF;
      return offset + 2;
    };
  }
  if (!Uint8Array.prototype.toString) {
    Uint8Array.prototype.toString = function(encoding) {
      if (encoding === 'hex') {
        return Array.from(this).map(b => b.toString(16).padStart(2, '0')).join('');
      }
      if (encoding === 'base64') {
        let binary = '';
        for (let i = 0; i < this.length; i++) binary += String.fromCharCode(this[i]);
        return btoa(binary);
      }
      return new TextDecoder().decode(this);
    };
  }
}

export default { Buffer };
