# Brook QUIC Client IWA — Deep Bug Analysis

I have identified two critical bugs in the current client codebase that fundamentally undermine the recent concurrency and stability fixes, plus one major QUIC engine defect.

### 1. DNS Parallel Query Anycast Bottleneck (`dns-resolver.js`)
**Bug:** The IP rotation logic implemented in `v1.14.0` (2-use limit) is completely bypassed during the browser's initial connection burst. 
**Why it fails:** When Firefox makes 10 parallel requests to `github.com`, the first request is a cache miss and calls `_resolveViaBrook`, storing its *Promise* in `this.pending`. The next 9 parallel requests hit `if (this.pending.has(cleanHost))` and await that exact same promise. When the DNS response arrives, `_resolveViaBrook` returns a **single IP string**. All 10 requests receive this exact same IP.
**Result:** Even with the new logic, the 10 parallel dials still hit the **exact same Anycast IP simultaneously**, triggering the edge rate limiter.
**Fix:** `_resolveViaBrook` should return the full array of `ips`. `resolveIpv4` should then await the array, and each waiting request should independently pick a random IP from that array (`ips[Math.floor(Math.random() * ips.length)]`). The cache should also store the full array instead of a single string.

### 2. Broken UDP Backpressure (`udp-socket-adapter.js`)
**Bug:** The UDP queue backpressure mechanism does absolutely nothing. Packets are dropped silently when the queue hits 1024.
**Why it fails:** 
```javascript
    const drainPromise = this._drainSendQueue();
    // Apply backpressure when queue is high
    if (this.sendQueue.length > HIGH_WATERMARK) {
      await drainPromise;
    }
```
Inside `_drainSendQueue()`, if `this.isDraining` is already true, it immediately returns `undefined`. Because it returns `undefined`, `drainPromise` evaluates to `undefined`. When the queue crosses `HIGH_WATERMARK`, `await drainPromise` resolves instantly instead of waiting for the queue to drain. 
**Result:** The caller pushes packets without delay until `MAX_QUEUE_SIZE` (1024) is reached, at which point the adapter evicts packets (potentially critical ones), causing timeouts and retransmissions.
**Fix:** Store the active drain promise in `this.drainPromise`. If `this.isDraining` is true, wait on `this.drainPromise` instead of creating a new one that returns `undefined`.

### 3. Duplicate ACK Flood Accumulation (`quic-engine.bundle.js`)
**Bug:** The engine generates double the number of ACKs it should for application data, inflating uplink packet rate.
**Why it fails:** In the `feedPacket` loop, every `ackEliciting` frame triggers an immediate ACK packet containing `context.pending_ack[space]`. However, for the `"app"` space, it deliberately **does not clear** `context.pending_ack["app"]` after sending. The ranges continue to accumulate, and are then sent *again* as a piggybacked ACK during the next outgoing data burst in `execute_quic_burst` (which finally clears the array).
**Result:** Network congestion and UDP queue overflows are heavily exacerbated by duplicate ACKs.

Shall I proceed with fixing these three issues in the codebase?
