/**
 * Byte and binary data manipulation utilities for Brook IWA.
 */

export function concatUint8Arrays(arrays) {
  const total = arrays.reduce((acc, a) => acc + (a ? a.length : 0), 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    if (!a || a.length === 0) continue;
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

export function readUInt16BE(buf, offset = 0) {
  return (buf[offset] << 8) | buf[offset + 1];
}

export function writeUInt16BE(buf, val, offset = 0) {
  buf[offset] = (val >>> 8) & 0xFF;
  buf[offset + 1] = val & 0xFF;
  return offset + 2;
}

export function readUInt32BE(buf, offset = 0) {
  return ((buf[offset] << 24) >>> 0) | (buf[offset + 1] << 16) | (buf[offset + 2] << 8) | buf[offset + 3];
}

export function writeUInt32BE(buf, val, offset = 0) {
  buf[offset] = (val >>> 24) & 0xFF;
  buf[offset + 1] = (val >>> 16) & 0xFF;
  buf[offset + 2] = (val >>> 8) & 0xFF;
  buf[offset + 3] = val & 0xFF;
  return offset + 4;
}

export function bytesToHex(buf) {
  if (!buf || buf.length === 0) return '';
  return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function hexToBytes(hex) {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '');
  const bytes = new Uint8Array(Math.floor(clean.length / 2));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return bytes;
}

export function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function parseIpv6(ipStr) {
  if (!ipStr || typeof ipStr !== 'string') return null;
  let str = ipStr.trim();
  if (str.startsWith('[') && str.endsWith(']')) str = str.slice(1, -1);
  if (!str.includes(':')) return null;

  const parts = str.split('::');
  if (parts.length > 2) return null;

  let head = parts[0] ? parts[0].split(':') : [];
  let tail = parts[1] ? parts[1].split(':') : [];

  if (tail.length > 0 && tail[tail.length - 1].includes('.')) {
    const v4 = tail.pop().split('.').map(Number);
    if (v4.length === 4 && v4.every(n => !isNaN(n) && n >= 0 && n <= 255)) {
      tail.push(((v4[0] << 8) | v4[1]).toString(16));
      tail.push(((v4[2] << 8) | v4[3]).toString(16));
    } else {
      return null;
    }
  } else if (head.length > 0 && head[head.length - 1].includes('.')) {
    const v4 = head.pop().split('.').map(Number);
    if (v4.length === 4 && v4.every(n => !isNaN(n) && n >= 0 && n <= 255)) {
      head.push(((v4[0] << 8) | v4[1]).toString(16));
      head.push(((v4[2] << 8) | v4[3]).toString(16));
    } else {
      return null;
    }
  }

  const fillCount = 8 - (head.length + tail.length);
  if (parts.length === 2 && fillCount < 0) return null;
  if (parts.length === 1 && head.length !== 8) return null;

  const words = [
    ...head,
    ...(parts.length === 2 ? Array(fillCount).fill('0') : []),
    ...tail
  ];

  if (words.length !== 8) return null;

  const out = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    const w = parseInt(words[i] || '0', 16);
    if (isNaN(w) || w < 0 || w > 0xffff) return null;
    out[i * 2] = (w >>> 8) & 0xff;
    out[i * 2 + 1] = w & 0xff;
  }
  return out;
}

export function formatIpv6(buf, offset = 0) {
  if (!buf || buf.length < offset + 16) return '';
  const words = [];
  for (let i = offset; i < offset + 16; i += 2) {
    words.push(((buf[i] << 8) | buf[i + 1]).toString(16));
  }
  return words.join(':');
}

export function parseHostPort(str, defaultPort = 80) {
  if (!str || typeof str !== 'string') return { host: '', port: defaultPort };
  const trimmed = str.trim();
  if (trimmed.startsWith('[')) {
    const closeBracket = trimmed.indexOf(']');
    if (closeBracket !== -1) {
      const host = trimmed.substring(1, closeBracket);
      const rest = trimmed.substring(closeBracket + 1);
      const colon = rest.indexOf(':');
      const port = colon !== -1 ? parseInt(rest.substring(colon + 1), 10) : defaultPort;
      return { host, port: isNaN(port) ? defaultPort : port };
    }
  }
  const lastColon = trimmed.lastIndexOf(':');
  if (lastColon !== -1) {
    const host = trimmed.substring(0, lastColon);
    const port = parseInt(trimmed.substring(lastColon + 1), 10);
    return { host, port: isNaN(port) ? defaultPort : port };
  }
  return { host: trimmed, port: defaultPort };
}

export function encodeAddress(host, port) {
  const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const m4 = (host || '').match(ipv4Regex);
  if (m4) {
    const out = new Uint8Array(1 + 4 + 2);
    out[0] = 0x01;
    out[1] = parseInt(m4[1], 10);
    out[2] = parseInt(m4[2], 10);
    out[3] = parseInt(m4[3], 10);
    out[4] = parseInt(m4[4], 10);
    out[5] = (port >>> 8) & 0xFF;
    out[6] = port & 0xFF;
    return out;
  }

  const v6Bytes = parseIpv6(host);
  if (v6Bytes) {
    const out = new Uint8Array(1 + 16 + 2);
    out[0] = 0x04;
    out.set(v6Bytes, 1);
    out[17] = (port >>> 8) & 0xFF;
    out[18] = port & 0xFF;
    return out;
  }

  const domainBytes = new TextEncoder().encode(host || '');
  const out = new Uint8Array(1 + 1 + domainBytes.length + 2);
  out[0] = 0x03;
  out[1] = domainBytes.length;
  out.set(domainBytes, 2);
  out[2 + domainBytes.length] = (port >>> 8) & 0xFF;
  out[3 + domainBytes.length] = port & 0xFF;
  return out;
}

export function formatSpeed(bytesPerSec) {
  return `${formatBytes(bytesPerSec)}/s`;
}

export function formatHexDump(buf, maxBytes = 256) {
  if (!buf || buf.length === 0) return 'Empty payload';
  const slice = buf.subarray(0, maxBytes);
  const lines = [];
  
  for (let i = 0; i < slice.length; i += 16) {
    const chunk = slice.subarray(i, Math.min(i + 16, slice.length));
    const offsetHex = i.toString(16).padStart(4, '0');
    
    // Hex representation
    const hexParts = [];
    for (let j = 0; j < 16; j++) {
      if (j < chunk.length) {
        hexParts.push(chunk[j].toString(16).padStart(2, '0'));
      } else {
        hexParts.push('  ');
      }
      if (j === 7) hexParts.push(' ');
    }
    
    // ASCII representation
    let ascii = '';
    for (let j = 0; j < chunk.length; j++) {
      const b = chunk[j];
      ascii += (b >= 32 && b <= 126) ? String.fromCharCode(b) : '.';
    }
    
    lines.push(`${offsetHex}  ${hexParts.join(' ')}  |${ascii}|`);
  }
  
  if (buf.length > maxBytes) {
    lines.push(`... (+${buf.length - maxBytes} more bytes)`);
  }
  return lines.join('\n');
}
