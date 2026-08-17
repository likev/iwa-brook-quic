import dgram from 'node:dgram';
import dns from 'node:dns/promises';
import { QUICConnection } from '../brook-quicclient/vendor/quic-engine.bundle.js';
import { getDcidHex } from '../brook-quicclient/src/quic/quic-connection-manager.js';
import { generateNonce, deriveKey } from '../brook-quicclient/src/core/brook-crypto.js';
import { sealFrame, openLength, openPayload, buildBrookHeader } from '../brook-quicclient/src/core/brook-framing.js';

const resolved = await dns.lookup('brook-quic.pplx.io');
const udpSocket = dgram.createSocket('udp4');
const sessionsByCid = new Map();

udpSocket.on('message', (msg, rinfo) => {
  const u8 = new Uint8Array(msg);
  const dcidHex = getDcidHex(u8);
  if (dcidHex && sessionsByCid.has(dcidHex)) {
    sessionsByCid.get(dcidHex).quic.feedDatagram(rinfo.address, rinfo.port, u8);
  }
});
await new Promise(r => udpSocket.bind(0, r));

function buildDnsQuery(domain) {
  const parts = domain.split('.');
  const qname = [];
  for (const part of parts) {
    qname.push(part.length, ...Buffer.from(part));
  }
  qname.push(0);

  const id = 0x1234;
  const flags = 0x0100; // Standard query, RD=1
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

function parseDnsResponse(buf) {
  if (buf.length < 14) return [];
  let offset = (buf[0] << 8 | buf[1]) === buf.length - 2 ? 2 : 0;
  const ancount = (buf[offset + 6] << 8) | buf[offset + 7];
  offset += 12; // Skip DNS header

  // Skip question QNAME
  while (offset < buf.length && buf[offset] !== 0) {
    if ((buf[offset] & 0xc0) === 0xc0) { offset += 2; break; }
    offset += 1 + buf[offset];
  }
  if (buf[offset] === 0) offset++;
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
    const type = (buf[offset] << 8) | buf[offset + 1];
    offset += 2;
    const cls = (buf[offset] << 8) | buf[offset + 1];
    offset += 2;
    const ttl = (buf[offset] << 24) | (buf[offset + 1] << 16) | (buf[offset + 2] << 8) | buf[offset + 3];
    offset += 4;
    const rdlen = (buf[offset] << 8) | buf[offset + 1];
    offset += 2;
    if (type === 1 && rdlen === 4) { // Type A (IPv4)
      const ip = `${buf[offset]}.${buf[offset + 1]}.${buf[offset + 2]}.${buf[offset + 3]}`;
      ips.push({ ip, ttl });
    }
    offset += rdlen;
  }
  return ips;
}

async function queryDnsThroughBrook(domain, dnsServer = '8.8.8.8') {
  const quic = new QUICConnection({
    isServer: false,
    hostname: 'brook-quic.pplx.io',
    alpn: ['h3'],
    rejectUnauthorized: false
  });
  quic.on('packet', (data) => udpSocket.send(data, 4433, resolved.address));

  await new Promise((res, rej) => {
    quic.on('connect', res);
    quic.on('error', rej);
    quic.connect();
    const scidHex = Array.from(quic.context.my_cids[0]).map(b => b.toString(16).padStart(2, '0')).join('');
    sessionsByCid.set(scidHex, { quic });
  });

  // Destination: 8.8.8.8:53 (TCP)
  const dnsIpParts = dnsServer.split('.').map(Number);
  const dstBytes = new Uint8Array([0x01, ...dnsIpParts, 0x00, 53]);

  const cn = generateNonce();
  const cnCopy = new Uint8Array(cn);
  const ck = deriveKey('271828brook', cnCopy, 'brook', false);
  const header = sealFrame(ck, cnCopy, buildBrookHeader(dstBytes, true, 0));

  const dnsPayload = buildDnsQuery(domain);
  const sealedDns = sealFrame(ck, cnCopy, dnsPayload);

  const startT = Date.now();
  quic.sendStream(0, cn, false);
  quic.sendStream(0, header, false);
  quic.sendStream(0, sealedDns, false);

  let sn = null;
  let sk = null;
  let rxBuf = new Uint8Array(0);

  const ips = await new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error('DNS query timed out')), 4000);
    quic.on('stream', (sid, data) => {
      rxBuf = new Uint8Array([...rxBuf, ...data]);
      if (!sn && rxBuf.length >= 12) {
        sn = rxBuf.slice(0, 12);
        rxBuf = rxBuf.slice(12);
        sk = deriveKey('271828brook', sn, 'brook', false);
      }
      if (sk && rxBuf.length >= 18) {
        const payloadLen = openLength(sk, sn, rxBuf.slice(0, 18));
        if (rxBuf.length >= 18 + payloadLen + 16) {
          const plain = openPayload(sk, sn, rxBuf.slice(18, 18 + payloadLen + 16));
          clearTimeout(timer);
          const parsed = parseDnsResponse(plain);
          res(parsed);
        }
      }
    });
  });

  quic.close(0, 'done');
  const elapsed = Date.now() - startT;
  console.log(`✅ Resolved ${domain} via Brook server (8.8.8.8:53) in ${elapsed}ms:`, ips);
  return ips;
}

await queryDnsThroughBrook('www.google.com', '8.8.8.8');
await queryDnsThroughBrook('github.com', '8.8.8.8');
await queryDnsThroughBrook('example.com', '1.1.1.1');
udpSocket.close();
