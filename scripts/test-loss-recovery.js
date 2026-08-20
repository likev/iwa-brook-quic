/**
 * Test Suite for UDP/QUIC Packet Loss Prevention, Control Frame Protection, and Event Logging.
 */

import { QUICConnection } from '../brook-quicclient/vendor/quic-engine.bundle.js';
import { UdpSocketAdapter } from '../brook-quicclient/src/quic/udp-socket-adapter.js';
import { QuicConnectionManager, QuicSession } from '../brook-quicclient/src/quic/quic-connection-manager.js';
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

export async function runLossRecoveryTests() {
  console.log('\n========================================');
  console.log('  RUNNING PACKET LOSS & LOGGING TESTS');
  console.log('========================================\n');

  // Test 1: UdpSocketAdapter control frame protection across long & short headers
  let logMessages = [];
  const adapter = new UdpSocketAdapter({
    remoteAddress: '127.0.0.1',
    remotePort: 4433,
    onLog: (lvl, msg) => {
      logMessages.push({ lvl, msg });
    }
  });
  adapter.writer = { write: async () => {} };
  adapter._waitForDrain = () => Promise.resolve();

  // Fill queue with 2048 short-header data packets
  for (let i = 0; i < 2048; i++) {
    adapter.sendQueue.push({
      data: new Uint8Array([0x40, i & 0xff]),
      isControl: false,
      space: 'app',
      enqueuedAt: Date.now()
    });
  }
  assert(adapter.sendQueue.length === 2048, 'Send queue initialized to 2048 packets');

  // Send a 1-RTT Short-Header Control Frame (isControl: true)
  const ccFrame = new Uint8Array([0x40, 0x1c, 0x00]); // CONNECTION_CLOSE
  await adapter.send(ccFrame, { isControl: true, space: 'app' });
  
  assert(adapter.packetEvictions === 1, 'Adapter increments packetEvictions count on queue saturation');
  assert(adapter.sendQueue.some(pkt => pkt.isControl && pkt.space === 'app') || adapter.packetsSent > 0, '1-RTT control packet was enqueued and protected');
  
  // Verify packet drop log
  const dropLog = logMessages.find(l => l.msg.includes('Local packet drop'));
  assert(dropLog && dropLog.lvl === 'warning', 'Local packet drop is logged with warning level and drop details');
  assert(dropLog.msg.includes('Evicted 1-RTT data packet'), 'Drop log specifically identifies evicted data packet');

  // Test 2: Multiple Control Packets under Queue Pressure
  for (let i = 0; i < 10; i++) {
    while (adapter.sendQueue.length < 2048) {
      adapter.sendQueue.push({ data: new Uint8Array([0x40, 1]), isControl: false, space: 'app', enqueuedAt: Date.now() });
    }
    await adapter.send(new Uint8Array([0xC0, i]), { isControl: true, space: 'handshake' });
  }
  assert(adapter.packetEvictions >= 11, `Adapter evicted non-control packets to protect control packets (total: ${adapter.packetEvictions})`);

  // Test 3: QUIC Engine Adaptive History Retention
  const quic = new QUICConnection({
    isServer: false,
    hostname: 'brook-quic.pplx.io',
    alpn: ['h3']
  });
  assert(quic.context.max_packets_per_burst === 32, 'max_packets_per_burst is 32 to smooth Direct Sockets burst IPC');
  assert(quic.context.local_max_data === 33554432, 'Flow control local_max_data is 32MB');
  assert(quic.context.local_initial_max_stream_data === 16777216, 'Flow control local_initial_max_stream_data is 16MB');

  // Test 4: QuicConnectionManager Cumulative Eviction Telemetry
  const mgr = new QuicConnectionManager({ serverHost: '127.0.0.1', serverPort: 4433 });
  const mockSess = { udpAdapter: adapter, isAlive: () => true, close: () => {} };
  mgr.registerSession(mockSess);
  let snap = mgr.getSnapshot();
  assert(snap.packetEvictions >= 11, `Snapshot reports active session packet evictions (${snap.packetEvictions})`);
  mgr.unregisterSession(mockSess);
  snap = mgr.getSnapshot();
  assert(snap.packetEvictions >= 11, `Snapshot preserves cumulative packet evictions after session unregisters (${snap.packetEvictions})`);

  // Test 5: BrookTunnel 8MB Buffer & Pressure Warning
  let tunnelLogs = [];
  let streamCb = null;
  const mockTunnelSession = {
    allocateStreamId: () => 0,
    registerStream: (id, cb) => { streamCb = cb; },
    unregisterStream: () => {},
    ensureConnected: async () => {},
    sendStreamData: async () => {}
  };
  let stubReader;
  const tReader = {
    read: async () => new Promise(r => { stubReader = r; }),
    cancel: async () => { if (stubReader) stubReader({ done: true }); },
    releaseLock: () => {}
  };
  const tWriter = { write: async () => {}, close: async () => {}, releaseLock: () => {} };

  const tunnelPromise = BrookTunnel.run({
    clientReader: tReader,
    clientWriter: tWriter,
    quicManager: mockTunnelSession,
    dstBytes: new Uint8Array([0x01, 1, 1, 1, 1, 0, 80]),
    password: '271828brook',
    targetStr: '1.1.1.1:80',
    sessionId: 'test-loss-logger',
    dialTimeoutMs: 5000,
    onLog: (lvl, msg) => { tunnelLogs.push({ lvl, msg }); }
  });

  await new Promise(r => setTimeout(r, 10));
  // Provide server nonce to complete handshake
  streamCb.onData(new Uint8Array(12).fill(0xee), false);
  await new Promise(r => setTimeout(r, 10));

  // Send 5MB chunk (above 4MB high watermark, below 8MB hard cap)
  const fiveMbChunk = new Uint8Array(5 * 1024 * 1024);
  streamCb.onData(fiveMbChunk, false);

  assert(tunnelLogs.some(l => l.msg.includes('High downstream buffer pressure')), 'High downstream buffer pressure is logged when queue crosses 4MB');

  // Clean up tunnel
  streamCb.onData(new Uint8Array(0), true);
  if (stubReader) stubReader({ done: true });
  await tunnelPromise;
  await adapter.close();

  console.log(`\n========================================`);
  console.log(`  PACKET LOSS TESTS: ${passed} PASSED, ${failed} FAILED`);
  console.log(`========================================\n`);
}

if (process.argv[1].endsWith('test-loss-recovery.js')) {
  runLossRecoveryTests().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
