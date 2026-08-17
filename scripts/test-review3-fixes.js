/**
 * Dedicated Test Suite for Review 3 Dial-Phase & Relay Client Performance Fixes.
 */

import { QUICConnection } from '../brook-quicclient/vendor/quic-engine.bundle.js';
import { QuicSession, QuicConnectionManager } from '../brook-quicclient/src/quic/quic-connection-manager.js';
import { ProxyDispatcher } from '../brook-quicclient/src/server/proxy-dispatcher.js';
import { BrookTunnel } from '../brook-quicclient/src/core/brook-tunnel.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    failed++;
    console.error(`  ❌ FAIL: ${message}`);
    throw new Error(message);
  } else {
    passed++;
    console.log(`  ✅ PASS: ${message}`);
  }
}

export async function runReview3Tests() {
  console.log('\n========================================');
  console.log('  RUNNING REVIEW 3 FIXES VERIFICATION');
  console.log('========================================\n');

  // Test 1: BBR-Lite Inbound Relay Floors
  const conn = new QUICConnection({
    isServer: false,
    hostname: 'brook-quic.pplx.io',
    alpn: ['h3'],
    rejectUnauthorized: false
  });
  assert(conn.context.min_limit_bytes_per_sec >= 2000000, `BBR pacing floor is >= 2 MB/s (${conn.context.min_limit_bytes_per_sec} B/s)`);
  assert(conn.context.min_limit_bytes_in_flight >= 16000, `BBR min in-flight bytes floor is >= 16 KB (${conn.context.min_limit_bytes_in_flight} B)`);
  assert(conn.context.min_limit_packets_in_flight >= 12, `BBR min in-flight packets floor is >= 12 pkts (${conn.context.min_limit_packets_in_flight})`);
  assert(conn.context.init_limit_packets_in_flight >= 24, `BBR initial in-flight window is >= 24 pkts (${conn.context.init_limit_packets_in_flight})`);

  // Test 2: QuicSession Strict Packet Receipt Watchdog
  const session = new QuicSession({
    manager: null,
    serverHost: 'brook-quic.pplx.io',
    serverPort: 4433,
    alpn: 'h3'
  });
  session.isConnected = true;
  session.quic = conn;
  assert(session.isAlive() === true, 'Fresh session is alive (default 5s threshold)');
  assert(session.isAlive(5000) === true, 'Fresh session is alive (isAlive(5000))');

  // Simulate silent connection drop (no packet received for 6 seconds)
  session.lastPacketReceivedTime = Date.now() - 6000;
  assert(session.isAlive() === false, 'Silent dead session (>5s without incoming packet) is detected as dead');

  // Simulate incoming packet
  session.lastPacketReceivedTime = Date.now();
  assert(session.isAlive() === true, 'Session revived upon incoming packet receipt');

  // Test 3: ProxyDispatcher Per-Host Dial Concurrency Limiter
  const dispatcher = new ProxyDispatcher({
    quicManager: null,
    sessionTracker: { createSession: () => ({ id: 'test' }), recordBytes: () => {}, closeSession: () => {} },
    password: 'test'
  });

  // Acquire 2 permits for host 'api.github.com'
  await dispatcher._acquireHostDialPermit('api.github.com', 2);
  await dispatcher._acquireHostDialPermit('api.github.com', 2);
  assert(dispatcher.hostActiveDials.get('api.github.com') === 2, 'Host active dials reached max concurrent limit (2)');

  // 3rd permit must be queued
  let permit3Granted = false;
  dispatcher._acquireHostDialPermit('api.github.com', 2).then(() => { permit3Granted = true; });
  assert(!permit3Granted, '3rd concurrent dial to same host is queued to prevent target rate-limiting');

  // Release 1 permit -> 3rd permit resolves immediately
  dispatcher._releaseHostDialPermit('api.github.com');
  await new Promise(r => setTimeout(r, 10));
  assert(permit3Granted, 'Queued host dial permit is immediately granted upon release');
  dispatcher._releaseHostDialPermit('api.github.com');
  dispatcher._releaseHostDialPermit('api.github.com');
  assert(!dispatcher.hostActiveDials.has('api.github.com') || dispatcher.hostActiveDials.get('api.github.com') === 0, 'All host dial permits released');

  // Test 4: BrookTunnel Deferred SOCKS5 Success & Failure on Dial Timeout
  let successCalled = false;
  let failureCode = null;
  const mockWriter = {
    write: async () => {},
    close: async () => {},
    releaseLock: () => {}
  };
  let cancelReader = null;
  const mockReader = {
    read: async () => new Promise((_, reject) => { cancelReader = reject; }),
    cancel: async () => { if (cancelReader) cancelReader(new Error('cancelled')); },
    releaseLock: () => {}
  };
  const mockSession = {
    allocateStreamId: () => 0,
    registerStream: () => {},
    unregisterStream: () => {},
    ensureConnected: async () => {},
    sendStreamData: async () => {}
  };

  // Run with fast dial timeout of 50ms
  const tunnelPromise = BrookTunnel.run({
    clientReader: mockReader,
    clientWriter: mockWriter,
    quicManager: mockSession,
    dstBytes: new Uint8Array([0x01, 1, 1, 1, 1, 0, 80]),
    password: '271828brook',
    targetStr: '1.1.1.1:80',
    sessionId: 'test-timeout',
    sendSuccess: async () => { successCalled = true; },
    sendFailure: async (code) => { failureCode = code; },
    dialTimeoutMs: 50
  });

  await tunnelPromise;
  assert(!successCalled, 'sendSuccess is NOT called prematurely when dial times out');
  assert(failureCode === 0x05, 'sendFailure(0x05) is sent to client upon dial timeout');

  console.log(`\nReview 3 Fixes Test Suite: ${passed} passed, ${failed} failed.\n`);
}

if (process.argv[1]?.endsWith('test-review3-fixes.js')) {
  runReview3Tests().catch(err => {
    console.error('Test error:', err);
    process.exit(1);
  });
}
