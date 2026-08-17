/**
 * HTTP Proxy Protocol Parser (RFC 7230 / RFC 7231).
 * Supports both HTTP CONNECT tunneling (for HTTPS) and HTTP forward proxy requests.
 */

import { encodeAddress, parseHostPort } from '../core/byte-utils.js';

function findHeaderEnd(buf) {
  for (let i = 0; i < buf.length - 1; i++) {
    if (buf[i] === 0x0A && buf[i + 1] === 0x0A) {
      return i + 2; // \n\n
    }
    if (i + 3 < buf.length && buf[i] === 0x0D && buf[i + 1] === 0x0A && buf[i + 2] === 0x0D && buf[i + 3] === 0x0A) {
      return i + 4; // \r\n\r\n
    }
  }
  return -1;
}

export class HttpProxyParser {
  /**
   * Parse HTTP Proxy request (CONNECT or plain HTTP).
   *
   * @param {Uint8Array} initialChunk - First chunk from TCP client
   * @param {ReadableStreamDefaultReader} reader - Stream reader for subsequent chunks if needed
   * @param {WritableStreamDefaultWriter} writer - Stream writer to send HTTP replies
   * @returns {Promise<{ dstBytes: Uint8Array, targetStr: string, leftover: Uint8Array, isConnect: boolean, sendSuccess: () => Promise<void>, sendFailure: (status?: number) => Promise<void> }>}
   */
  static async handleHandshake(initialChunk, reader, writer) {
    let buf = initialChunk;

    // Read until we find the end of HTTP headers (\r\n\r\n or \n\n) directly in raw bytes
    let headerBytesLen = findHeaderEnd(buf);

    while (headerBytesLen === -1) {
      if (buf.length > 8192) {
        try {
          await writer.write(new TextEncoder().encode('HTTP/1.1 431 Request Header Fields Too Large\r\n\r\n'));
        } catch (e) {}
        throw new Error('HTTP header too large (> 8KB)');
      }

      const { value, done } = await reader.read();
      if (done || !value) throw new Error('Client disconnected during HTTP header negotiation');
      const merged = new Uint8Array(buf.length + value.length);
      merged.set(buf, 0);
      merged.set(value, buf.length);
      buf = merged;
      headerBytesLen = findHeaderEnd(buf);
    }

    const headerBytes = buf.subarray(0, headerBytesLen);
    const headerStr = new TextDecoder().decode(headerBytes);

    // Parse the first line (e.g. "CONNECT example.com:443 HTTP/1.1" or "GET http://example.com/ HTTP/1.1")
    const firstLineEnd = headerStr.indexOf('\r\n') !== -1 ? headerStr.indexOf('\r\n') : headerStr.indexOf('\n');
    const requestLine = headerStr.substring(0, firstLineEnd);
    const parts = requestLine.trim().split(/\s+/);
    if (parts.length < 2) {
      try {
        await writer.write(new TextEncoder().encode('HTTP/1.1 400 Bad Request\r\n\r\n'));
      } catch (e) {}
      throw new Error(`Malformed HTTP request line: "${requestLine}"`);
    }

    const method = parts[0].toUpperCase();
    const uri = parts[1];
    let host = '';
    let port = 80;
    let isConnect = false;
    let leftover = new Uint8Array(0);

    if (method === 'CONNECT') {
      isConnect = true;
      const parsed = parseHostPort(uri, 443);
      host = parsed.host;
      port = parsed.port;

      leftover = buf.slice(headerBytesLen);
    } else {
      isConnect = false;
      let path = uri;
      if (uri.startsWith('http://') || uri.startsWith('https://')) {
        try {
          const parsedUrl = new URL(uri);
          host = parsedUrl.hostname.replace(/^\[|\]$/g, '');
          port = parsedUrl.port ? parseInt(parsedUrl.port, 10) : (parsedUrl.protocol === 'https:' ? 443 : 80);
          path = parsedUrl.pathname + parsedUrl.search;
        } catch (e) {
          const withoutProto = uri.replace(/^https?:\/\//, '');
          const slashIdx = withoutProto.indexOf('/');
          const hostPort = slashIdx !== -1 ? withoutProto.substring(0, slashIdx) : withoutProto;
          path = slashIdx !== -1 ? withoutProto.substring(slashIdx) : '/';
          const parsed = parseHostPort(hostPort, 80);
          host = parsed.host;
          port = parsed.port;
        }
      } else {
        const hostHeaderMatch = headerStr.match(/\r?\nHost:\s*([^\r\n]+)/i);
        if (hostHeaderMatch) {
          const parsed = parseHostPort(hostHeaderMatch[1].trim(), 80);
          host = parsed.host;
          port = parsed.port;
        } else {
          try {
            await writer.write(new TextEncoder().encode('HTTP/1.1 400 Bad Request\r\n\r\nHost header required\r\n'));
          } catch (e) {}
          throw new Error('Plain HTTP proxy request missing Host header and absolute URI');
        }
      }

      const restOfHeaders = headerStr.substring(firstLineEnd);
      const rewrittenFirstLine = `${method} ${path} ${parts[2] || 'HTTP/1.1'}`;
      const rewrittenHeaders = rewrittenFirstLine + restOfHeaders;
      const rewrittenBytes = new TextEncoder().encode(rewrittenHeaders);

      const bodyBytes = buf.slice(headerBytesLen);

      leftover = new Uint8Array(rewrittenBytes.length + bodyBytes.length);
      leftover.set(rewrittenBytes, 0);
      leftover.set(bodyBytes, rewrittenBytes.length);
    }

    const dstBytes = encodeAddress(host, port);
    const targetStr = `${host}:${port}`;

    const sendSuccess = async () => {
      if (isConnect) {
        const reply = new TextEncoder().encode('HTTP/1.1 200 Connection Established\r\nProxy-Agent: Brook-IWA/1.15.0\r\n\r\n');
        await writer.write(reply);
      }
    };

    const sendFailure = async (status = 502) => {
      try {
        const reply = new TextEncoder().encode(`HTTP/1.1 ${status} Bad Gateway\r\nProxy-Agent: Brook-IWA/1.15.0\r\nContent-Type: text/plain\r\n\r\nProxy connect failed\r\n`);
        await writer.write(reply);
      } catch (e) {}
    };

    return {
      dstBytes,
      targetStr,
      leftover,
      isConnect,
      sendSuccess,
      sendFailure
    };
  }
}
