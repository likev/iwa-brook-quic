/**
 * Proxy DNS Resolver over Brook QUIC Tunnel (No DoH).
 * When Firefox/clients connect with Proxy DNS (ATYP 0x03), queries 8.8.8.8 / 1.1.1.1
 * directly through the remote Brook server over an encrypted stream, parses IPv4 A records,
 * and caches them with round-robin Anycast distribution so concurrent requests spread across A-records.
 */

import { generateNonce, deriveKey } from './brook-crypto.js';
import { sealFrame, openLength, openPayload, buildBrookHeader } from './brook-framing.js';
import { parseIpv6 } from './byte-utils.js';

export class DnsResolver {
  static cache = new Map(); // host -> { ips: [{ip, ttl}], roundRobinIdx: number, expiresAt: number }
  static pending = new Map(); // host -> Promise<Array<{ip: string, ttl: number}> | null>
  static MAX_CACHE_SIZE = 1000;

  static isIpv4(host) {
    return /^(\d{1,3}\.){3}\d{1,3}$/.test(host || '');
  }

  static isIpv6(host) {
    return parseIpv6(host) !== null;
  }

  /**
   * Resolve a hostname to IPv4 address by querying upstream DNS through the Brook tunnel.
   *
   * @param {string} host
   * @param {QuicConnectionManager} quicManager
   * @param {string} password
   * @param {Object|number} options - Options object or timeoutMs
   * @param {boolean} [options.withoutBrook=false]
   * @param {number} [options.clockOffsetSec=0]
   * @param {number} [options.timeoutMs=3500]
   * @returns {Promise<string|null>}
   */
  static async resolveIpv4(host, quicManager = null, password = '', options = {}) {
    if (!host || typeof host !== 'string') return null;
    const cleanHost = host.trim().toLowerCase().replace(/^\[|\]$/g, '');

    if (this.isIpv4(cleanHost)) return cleanHost;
    if (this.isIpv6(cleanHost)) return cleanHost;
    if (cleanHost === 'localhost') return '127.0.0.1';

    let timeoutMs = 2000;
    let withoutBrook = false;
    let clockOffsetSec = 0;

    if (typeof options === 'number') {
      timeoutMs = options;
    } else if (options && typeof options === 'object') {
      if (typeof options.timeoutMs === 'number') timeoutMs = options.timeoutMs;
      if (typeof options.withoutBrook === 'boolean') withoutBrook = options.withoutBrook;
      if (typeof options.clockOffsetSec === 'number') clockOffsetSec = options.clockOffsetSec;
    }

    const now = Date.now();
    const cached = this.cache.get(cleanHost);
    if (cached && cached.expiresAt > now && cached.ips && cached.ips.length > 0) {
      const chosen = cached.ips[cached.roundRobinIdx % cached.ips.length];
      cached.roundRobinIdx = (cached.roundRobinIdx + 1) % cached.ips.length;
      return chosen.ip;
    } else if (cached) {
      this.cache.delete(cleanHost);
    }

    if (this.pending.has(cleanHost)) {
      try {
        const ips = await this.pending.get(cleanHost);
        if (ips && ips.length > 0) {
          const entry = this.cache.get(cleanHost);
          if (entry && entry.ips && entry.ips.length > 0) {
            const chosen = entry.ips[entry.roundRobinIdx % entry.ips.length];
            entry.roundRobinIdx = (entry.roundRobinIdx + 1) % entry.ips.length;
            return chosen.ip;
          }
          return ips[Math.floor(Math.random() * ips.length)].ip;
        }
      } catch (e) {
        return null;
      }
      return null;
    }

    if (!quicManager || !password) {
      return null;
    }

    const promise = this._resolveViaBrook(cleanHost, quicManager, password, {
      timeoutMs,
      withoutBrook,
      clockOffsetSec
    });
    this.pending.set(cleanHost, promise);

    try {
      const ips = await promise;
      if (ips && ips.length > 0) {
        const entry = this.cache.get(cleanHost);
        if (entry && entry.ips && entry.ips.length > 0) {
          const chosen = entry.ips[entry.roundRobinIdx % entry.ips.length];
          entry.roundRobinIdx = (entry.roundRobinIdx + 1) % entry.ips.length;
          return chosen.ip;
        }
        return ips[0].ip;
      }
      return null;
    } finally {
      this.pending.delete(cleanHost);
    }
  }

  static clear() {
    this.cache.clear();
    this.pending.clear();
  }

  static async _resolveViaBrook(host, quicManager, password, { timeoutMs = 2000, withoutBrook = false, clockOffsetSec = 0 } = {}) {
    let session = null;
    let streamId = null;
    try {
      session = await quicManager.createSession();
      streamId = session.allocateStreamId();

      // Destination: 8.8.8.8:53 (TCP)
      const dstBytes = new Uint8Array([0x01, 8, 8, 8, 8, 0x00, 53]);
      const cn = generateNonce();
      const cnCopy = new Uint8Array(cn);
      const ck = await deriveKey(password, cnCopy, 'brook', withoutBrook);
      const header = await sealFrame(ck, cnCopy, buildBrookHeader(dstBytes, true, clockOffsetSec));

      const dnsPayload = this._buildDnsQuery(host);
      const sealedDns = await sealFrame(ck, cnCopy, dnsPayload);

      await session.ensureConnected();

      let sn = null;
      let sk = null;
      let rxBuf = new Uint8Array(0);

      const ips = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('DNS resolution timed out')), timeoutMs);

        session.registerStream(streamId, {
          onData: async (data) => {
            if (!data || data.length === 0) return;
            const merged = new Uint8Array(rxBuf.length + data.length);
            merged.set(rxBuf, 0);
            merged.set(data, rxBuf.length);
            rxBuf = merged;

            if (!sn && rxBuf.length >= 12) {
              sn = rxBuf.slice(0, 12);
              rxBuf = rxBuf.slice(12);
              sk = await deriveKey(password, sn, 'brook', withoutBrook);
            }

            if (sk && rxBuf.length >= 18) {
              try {
                const payloadLen = await openLength(sk, sn, rxBuf.slice(0, 18));
                if (rxBuf.length >= 18 + payloadLen + 16) {
                  const plain = await openPayload(sk, sn, rxBuf.slice(18, 18 + payloadLen + 16));
                  clearTimeout(timer);
                  const parsed = this._parseDnsResponse(plain);
                  resolve(parsed);
                }
              } catch (e) {
                clearTimeout(timer);
                reject(e);
              }
            }
          },
          onError: (err) => {
            clearTimeout(timer);
            reject(err);
          },
          onClose: () => {
            clearTimeout(timer);
            resolve([]);
          }
        });

        session.sendStreamData(streamId, cn, false)
          .then(() => session.sendStreamData(streamId, header, false))
          .then(() => session.sendStreamData(streamId, sealedDns, false))
          .catch((err) => {
            clearTimeout(timer);
            reject(err);
          });
      });

      if (ips && ips.length > 0) {
        const ttlSec = Math.max(60, Math.min(ips[0].ttl || 300, 600));
        this._setCache(host, ips, ttlSec);
        return ips;
      }
    } catch (e) {
      // Fallback
    } finally {
      if (session) {
        session.close();
      }
    }

    return null;
  }

  static _buildDnsQuery(domain) {
    const parts = domain.split('.');
    const qname = [];
    for (const part of parts) {
      const b = new TextEncoder().encode(part);
      qname.push(b.length, ...b);
    }
    qname.push(0);

    const id = (Math.random() * 0xffff) | 0;
    const flags = 0x0100; // Standard query, Recursion Desired (RD = 1)
    const header = [
      (id >> 8) & 0xff, id & 0xff,
      (flags >> 8) & 0xff, flags & 0xff,
      0x00, 0x01, // QDCOUNT = 1
      0x00, 0x00, // ANCOUNT = 0
      0x00, 0x00, // NSCOUNT = 0
      0x00, 0x00  // ARCOUNT = 0
    ];
    const question = [
      ...qname,
      0x00, 0x01, // QTYPE = A (IPv4)
      0x00, 0x01  // QCLASS = IN
    ];
    const query = new Uint8Array([...header, ...question]);
    const lenPrefixed = new Uint8Array(2 + query.length);
    lenPrefixed[0] = (query.length >> 8) & 0xff;
    lenPrefixed[1] = query.length & 0xff;
    lenPrefixed.set(query, 2);
    return lenPrefixed;
  }

  static _parseDnsResponse(buf) {
    if (buf.length < 14) return [];
    let offset = (buf[0] << 8 | buf[1]) === buf.length - 2 ? 2 : 0;
    const ancount = (buf[offset + 6] << 8) | buf[offset + 7];
    offset += 12; // Skip DNS header

    // Skip question QNAME
    while (offset < buf.length && buf[offset] !== 0) {
      if ((buf[offset] & 0xc0) === 0xc0) { offset += 2; break; }
      offset += 1 + buf[offset];
    }
    if (offset < buf.length && buf[offset] === 0) offset++;
    offset += 4; // Skip QTYPE + QCLASS

    const ips = [];
    for (let i = 0; i < ancount && offset < buf.length; i++) {
      if ((buf[offset] & 0xc0) === 0xc0) {
        offset += 2;
      } else {
        while (offset < buf.length && buf[offset] !== 0) {
          offset += 1 + buf[offset];
        }
        if (buf[offset] === 0) offset++;
      }
      if (offset + 10 > buf.length) break;
      const type = (buf[offset] << 8) | buf[offset + 1];
      offset += 2;
      offset += 2; // Skip CLASS
      const ttl = (buf[offset] << 24) | (buf[offset + 1] << 16) | (buf[offset + 2] << 8) | buf[offset + 3];
      offset += 4;
      const rdlen = (buf[offset] << 8) | buf[offset + 1];
      offset += 2;
      if (type === 1 && rdlen === 4 && offset + 4 <= buf.length) { // Type A (IPv4)
        const ip = `${buf[offset]}.${buf[offset + 1]}.${buf[offset + 2]}.${buf[offset + 3]}`;
        ips.push({ ip, ttl });
      }
      offset += rdlen;
    }
    return ips;
  }

  static _setCache(host, ips, ttlSec = 300) {
    if (this.cache.size >= this.MAX_CACHE_SIZE) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(host, {
      ips: Array.isArray(ips) ? ips : [{ ip: ips, ttl: ttlSec }],
      roundRobinIdx: 0,
      expiresAt: Date.now() + (ttlSec * 1000)
    });
  }
}
