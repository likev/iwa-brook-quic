/**
 * SOCKS5 Protocol Parser (RFC 1928).
 * Includes deadline protection, max buffer caps, and one-shot safe reply functions.
 */

import { readUInt16BE, formatIpv6 } from '../core/byte-utils.js';

export class Socks5Parser {
  static async handshake(initialChunk, reader, writer, timeoutMs = 8000) {
    return this.handleHandshake(initialChunk, reader, writer, timeoutMs);
  }

  /**
   * Parse SOCKS5 initial method negotiation and CONNECT request.
   *
   * @param {Uint8Array} initialChunk - First chunk read from TCP client
   * @param {ReadableStreamDefaultReader} reader - Stream reader for subsequent chunks if needed
   * @param {WritableStreamDefaultWriter} writer - Stream writer to send SOCKS5 replies
   * @param {number} [timeoutMs=8000] - Total negotiation timeout in ms
   * @returns {Promise<{ dstBytes: Uint8Array, targetStr: string, leftover: Uint8Array, sendSuccess: () => Promise<void>, sendFailure: (code?: number) => Promise<void> }>}
   */
  static async handleHandshake(initialChunk, reader, writer, timeoutMs = 8000) {
    let buf = initialChunk;
    const startTime = Date.now();

    // Helper to ensure buffer has at least minLen bytes with deadline protection
    async function ensureBytes(minLen) {
      const MAX_SOCKS5_BUF = 1024;
      while (buf.length < minLen) {
        if (buf.length > MAX_SOCKS5_BUF) {
          throw new Error(`SOCKS5 buffer exceeded limit (${buf.length} > ${MAX_SOCKS5_BUF})`);
        }
        const remainingMs = timeoutMs - (Date.now() - startTime);
        if (remainingMs <= 0) {
          throw new Error(`SOCKS5 handshake negotiation timed out (expected ${minLen} bytes, got ${buf.length})`);
        }

        let timer = null;
        try {
          const readPromise = reader.read();
          const timeoutPromise = new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('SOCKS5 read chunk timed out')), remainingMs);
          });
          const { value, done } = await Promise.race([readPromise, timeoutPromise]);
          clearTimeout(timer);

          if (done || !value) {
            throw new Error(`Client disconnected during SOCKS5 negotiation (expected ${minLen} bytes, got ${buf.length})`);
          }
          const merged = new Uint8Array(buf.length + value.length);
          merged.set(buf, 0);
          merged.set(value, buf.length);
          buf = merged;
        } catch (err) {
          if (timer) clearTimeout(timer);
          throw err;
        }
      }
    }

    // 1. Method Selection
    await ensureBytes(2);
    if (buf[0] !== 0x05) {
      throw new Error(`Invalid SOCKS version: 0x${buf[0].toString(16)}`);
    }

    const nMethods = buf[1];
    await ensureBytes(2 + nMethods);

    // Reply NO AUTH (0x05 0x00)
    await writer.write(new Uint8Array([0x05, 0x00]));

    // Advance buffer past method negotiation
    buf = buf.slice(2 + nMethods);

    // 2. CONNECT Request
    await ensureBytes(4); // VER, CMD, RSV, ATYP
    if (buf[0] !== 0x05) {
      throw new Error(`Invalid SOCKS request version: 0x${buf[0].toString(16)}`);
    }
    if (buf[1] !== 0x01) {
      // Send Command Not Supported error (0x07)
      try {
        await writer.write(new Uint8Array([0x05, 0x07, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]));
      } catch (e) {}
      throw new Error(`Unsupported SOCKS5 command: 0x${buf[1].toString(16)} (only CONNECT 0x01 is supported)`);
    }

    const atyp = buf[3];
    let dstAddrLen = 0;
    let targetHost = '';

    if (atyp === 0x01) {
      // IPv4: 4 bytes + 2 bytes port
      dstAddrLen = 4;
      await ensureBytes(4 + dstAddrLen + 2);
      const ip = `${buf[4]}.${buf[5]}.${buf[6]}.${buf[7]}`;
      const port = readUInt16BE(buf, 8);
      targetHost = `${ip}:${port}`;
    } else if (atyp === 0x03) {
      // Domain Name: 1 byte len + domain bytes + 2 bytes port
      await ensureBytes(5);
      const domainLen = buf[4];
      dstAddrLen = 1 + domainLen;
      await ensureBytes(4 + dstAddrLen + 2);
      const domain = new TextDecoder().decode(buf.subarray(5, 5 + domainLen));
      const port = readUInt16BE(buf, 4 + dstAddrLen);
      targetHost = `${domain}:${port}`;
    } else if (atyp === 0x04) {
      // IPv6: 16 bytes + 2 bytes port
      dstAddrLen = 16;
      await ensureBytes(4 + dstAddrLen + 2);
      const ipv6 = formatIpv6(buf, 4);
      const port = readUInt16BE(buf, 20);
      targetHost = `[${ipv6}]:${port}`;
    } else {
      try {
        await writer.write(new Uint8Array([0x05, 0x08, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]));
      } catch (e) {}
      throw new Error(`Unsupported ATYP: 0x${atyp.toString(16)}`);
    }

    const totalReqLen = 4 + dstAddrLen + 2;
    // Extract Brook dst: [ATYP, DST.ADDR..., DST.PORT (2B)]
    const dstBytes = buf.slice(3, totalReqLen);
    const leftover = buf.slice(totalReqLen);

    let replySent = false;

    const sendSuccess = async () => {
      if (replySent) return;
      replySent = true;
      await writer.write(new Uint8Array([
        0x05, 0x00, 0x00, 0x01,
        0x00, 0x00, 0x00, 0x00,
        0x00, 0x00
      ]));
    };

    const sendFailure = async (code = 0x05) => {
      if (replySent) return;
      replySent = true;
      try {
        await writer.write(new Uint8Array([
          0x05, code, 0x00, 0x01,
          0x00, 0x00, 0x00, 0x00,
          0x00, 0x00
        ]));
      } catch (e) {}
    };

    return {
      dstBytes,
      targetStr: targetHost,
      leftover,
      sendSuccess,
      sendFailure
    };
  }
}
