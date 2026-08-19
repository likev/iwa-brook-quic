/**
 * Brook Tunnel Orchestrator: pipes data between local TCP client and remote Brook QUIC stream.
 * Supports full-duplex streaming with independent half-close coordination,
 * post-connect dial verification timer, speculative socket pruning, bounded receive/transmit buffers,
 * deterministic structured outcome reporting, and reader-lock-safe retry semantics.
 */

import { generateNonce, deriveKey } from './brook-crypto.js';
import { sealFrame, openLength, openPayload, buildBrookHeader } from './brook-framing.js';

export class BrookTunnel {
  /**
   * Run bidirectional Brook encrypted tunnel over a QUIC stream.
   *
   * @param {Object} options
   * @param {ReadableStreamDefaultReader} options.clientReader - Local TCP socket reader
   * @param {WritableStreamDefaultWriter} options.clientWriter - Local TCP socket writer
   * @param {QuicConnectionManager|QuicSession} options.quicManager - QUIC manager or session
   * @param {Uint8Array} options.dstBytes - Destination slice [ATYP, ADDR..., PORT]
   * @param {Uint8Array} options.leftover - Any initial data already read (e.g. rewritten HTTP body)
   * @param {string} options.password - Brook server password
   * @param {boolean} options.withoutBrook - WithoutBrook mode
   * @param {number} options.clockOffsetSec - Network clock drift offset in seconds
   * @param {string} options.targetStr - Target host string (for logging/metrics)
   * @param {number|string} options.sessionId - Session ID for logging
   * @param {Function} options.sendSuccess - One-shot callback to confirm connection to client
   * @param {Function} options.sendFailure - Callback to signal proxy failure
   * @param {number} options.dialTimeoutMs - Timeout for server dial / nonce receipt
   * @param {boolean} [options.closeClientStreams=true] - Whether to close client streams on exit
   * @param {Function} options.onHandshakeDone - Callback when server handshake completes
   * @param {Function} options.onClientDataRead - Callback when client sends payload data
   * @param {Function} options.onBytes - Callback for throughput accounting (sent, received)
   * @param {Function} options.onClose - Callback when session terminates
   * @param {Function} options.onLog - Logging callback
   * @returns {Promise<{ success: boolean, kind: string, bytesSent: number, bytesReceived: number, serverHandshakeDone: boolean, error?: Error }>}
   */
  static async run({
    clientReader,
    clientWriter,
    quicManager,
    dstBytes,
    leftover = new Uint8Array(0),
    password,
    withoutBrook = false,
    clockOffsetSec = 0,
    targetStr,
    sessionId = '',
    sendSuccess = null,
    sendFailure = null,
    dialTimeoutMs = 3500,
    closeClientStreams = true,
    onHandshakeDone = null,
    onClientDataRead = null,
    onBytes,
    onClose,
    onLog
  }) {
    const logTag = sessionId ? `[#${sessionId}]` : `[Stream]`;
    const streamId = quicManager.allocateStreamId();
    const tunnelStartTime = Date.now();

    let isTerminated = false;
    let clientReadClosed = false;
    let serverRxClosed = false;
    let hasExchangedData = false;
    let successSent = false;

    let totalBytesSent = 0;
    let totalBytesRecv = 0;

    let resolveCompletion = null;
    const completionPromise = new Promise(r => { resolveCompletion = r; });

    let resolveHandshake = null;
    let rejectHandshake = null;
    const handshakePromise = new Promise((resolve, reject) => {
      resolveHandshake = resolve;
      rejectHandshake = reject;
    });

    let cleanupPromise = null;
    let terminationReason = 'normal';
    let terminationError = null;

    // 1. Prepare Cryptographic Context
    const cn = generateNonce();
    const cnCopy = new Uint8Array(cn);
    const ck = deriveKey(password, cnCopy, 'brook', withoutBrook);

    let sn = null;
    let sk = null;
    let rxBuffer = new Uint8Array(0);
    let rxOffset = 0;
    let serverHandshakeDone = false;
    let expectedPayloadLen = -1;

    // Bounded Serialized FIFO queue for downstream processing (2MB hard buffer cap)
    const MAX_RX_BUFFER_BYTES = 2 * 1024 * 1024;
    let rxQueuedBytes = 0;
    const rxQueue = [];
    let isProcessingRx = false;

    // 2. Timers:
    let handshakeTimer = null;
    let idleTimer = null;

    const resetIdleTimer = (durationMs = null) => {
      if (idleTimer) clearTimeout(idleTimer);
      if (!isTerminated) {
        // Speculative pre-connect with 0 received bytes only gets 15s to quickly release unused resources
        const timeout = durationMs !== null ? durationMs : (totalBytesRecv > 0 ? 180000 : 15000);
        idleTimer = setTimeout(() => {
          if (!isTerminated) {
            if (totalBytesRecv === 0 && onLog) {
              onLog('info', `${logTag} ℹ️ Speculative pre-connect for ${targetStr} idle for ${(timeout / 1000).toFixed(0)}s (reaped by hygiene).`);
            }
            cleanup('idle_timeout');
          }
        }, timeout);
      }
    };

    const cleanup = (reason = 'normal', err = null) => {
      if (cleanupPromise) return cleanupPromise;
      isTerminated = true;
      terminationReason = reason;
      if (err && !terminationError) terminationError = err;

      if (!serverHandshakeDone && rejectHandshake) {
        rejectHandshake(err || new Error(`Brook tunnel terminated (${reason})`));
      }

      cleanupPromise = (async () => {
        if (handshakeTimer) {
          clearTimeout(handshakeTimer);
          handshakeTimer = null;
        }
        if (idleTimer) {
          clearTimeout(idleTimer);
          idleTimer = null;
        }

        if (quicManager.releaseStream) {
          quicManager.releaseStream(streamId);
        } else if (quicManager.unregisterStream) {
          quicManager.unregisterStream(streamId);
        }

        // If dial never succeeded and client was not notified, signal error
        if (!serverHandshakeDone && !successSent && sendFailure && closeClientStreams) {
          try {
            await sendFailure(0x05);
            sendFailure = null;
          } catch (e) {}
        }

        // Bounded client stream cleanup: only cancel/close client reader/writer if closeClientStreams is true
        // or if serverHandshakeDone is true (stream was active). Lock release is owned by dispatcher.
        if (closeClientStreams || serverHandshakeDone) {
          try {
            await Promise.race([
              clientReader.cancel().catch(() => {}),
              new Promise(r => setTimeout(r, 500))
            ]);
          } catch (e) {}

          try {
            await Promise.race([
              clientWriter.close().catch(() => {}),
              new Promise(r => setTimeout(r, 500))
            ]);
          } catch (e) {}
        }

        const durationSec = ((Date.now() - tunnelStartTime) / 1000).toFixed(2);
        if (onLog && hasExchangedData) {
          onLog('info', `${logTag} 🛑 Tunnel finished for ${targetStr} (Up: ${totalBytesSent}B, Down: ${totalBytesRecv}B, ${durationSec}s, reason: ${reason})`);
        }

        if (onClose) {
          try { onClose(); } catch (e) {}
        }
        if (resolveCompletion) resolveCompletion();
      })();

      return cleanupPromise;
    };

    const checkFullClose = () => {
      if (clientReadClosed && serverRxClosed) {
        cleanup('both_closed');
      }
    };

    const processRxQueue = async () => {
      if (isProcessingRx || isTerminated) return;
      isProcessingRx = true;

      try {
        while (rxQueue.length > 0 && !isTerminated) {
          const item = rxQueue.shift();
          const { data, fin } = item;
          if (data) {
            rxQueuedBytes -= data.length;
          }

          if (data && data.length > 0) {
            if (rxOffset > 0) {
              rxBuffer = rxBuffer.subarray(rxOffset);
              rxOffset = 0;
            }
            if (rxBuffer.length === 0) {
              rxBuffer = data;
            } else {
              const merged = new Uint8Array(rxBuffer.length + data.length);
              merged.set(rxBuffer, 0);
              merged.set(data, rxBuffer.length);
              rxBuffer = merged;
            }
            rxOffset = 0;

            // Step A: Read Server Nonce (12 bytes)
            if (!serverHandshakeDone) {
              if (rxBuffer.length - rxOffset < 12) continue;
              sn = rxBuffer.slice(rxOffset, rxOffset + 12);
              rxOffset += 12;
              sk = deriveKey(password, sn, 'brook', withoutBrook);
              serverHandshakeDone = true;

              if (handshakeTimer) {
                clearTimeout(handshakeTimer);
                handshakeTimer = null;
              }

              // Confirm SOCKS5 / HTTP success to browser now that dial has begun
              if (sendSuccess && !successSent) {
                successSent = true;
                try {
                  await sendSuccess();
                  sendSuccess = null;
                } catch (e) {}
              }

              if (onHandshakeDone) {
                try {
                  onHandshakeDone();
                  onHandshakeDone = null;
                } catch (e) {}
              }

              if (resolveHandshake) {
                resolveHandshake();
              }

              const rttMs = Date.now() - tunnelStartTime;
              if (onLog) {
                onLog('success', `${logTag} 🚀 [Brook] Server dial initiated for ${targetStr} (${rttMs}ms, sn verified)`);
              }
            }

            // Step B: Decode length & payload frames sequentially
            while (serverHandshakeDone && !isTerminated) {
              const available = rxBuffer.length - rxOffset;
              // 1. Decode Length Prefix (18 bytes)
              if (expectedPayloadLen === -1) {
                if (available < 18) break;
                const chunk18 = rxBuffer.subarray(rxOffset, rxOffset + 18);
                rxOffset += 18;
                try {
                  expectedPayloadLen = openLength(sk, sn, chunk18);
                } catch (err) {
                  if (onLog) onLog('error', `${logTag} Frame length decrypt failed on stream ${streamId}: ${err.message}`);
                  cleanup('decrypt_error', err);
                  return;
                }
              }

              // 2. Decode Payload (expectedPayloadLen + 16 bytes tag)
              if (expectedPayloadLen >= 0) {
                const requiredBytes = expectedPayloadLen + 16;
                if (rxBuffer.length - rxOffset < requiredBytes) break;

                const payloadAndTag = rxBuffer.subarray(rxOffset, rxOffset + requiredBytes);
                rxOffset += requiredBytes;

                let plainPayload;
                try {
                  plainPayload = openPayload(sk, sn, payloadAndTag);
                } catch (err) {
                  if (onLog) onLog('error', `${logTag} Payload decrypt failed on stream ${streamId}: ${err.message}`);
                  cleanup('decrypt_error', err);
                  return;
                }

                expectedPayloadLen = -1; // Reset for next frame

                // Pipe plain decrypted bytes to local client
                if (plainPayload.length > 0) {
                  if (!hasExchangedData && onLog) {
                    onLog('info', `${logTag} 🎯 [Brook] First target byte received for ${targetStr} (${plainPayload.length}B)`);
                  }
                  hasExchangedData = true;
                  totalBytesRecv += plainPayload.length;
                  try {
                    await clientWriter.write(plainPayload);
                    resetIdleTimer(180000);
                    if (onBytes) onBytes(0, plainPayload.length);
                  } catch (err) {
                    cleanup('client_write_error', err);
                    return;
                  }
                }
              }
            }
          }

          if (fin) {
            if (!serverHandshakeDone && onLog) {
              onLog('warning', `${logTag} ⚠️ Brook server closed stream before sending server nonce for ${targetStr}. Possible client clock drift (diff > 60s) or invalid password.`);
            }
            serverRxClosed = true;
            try {
              await Promise.race([
                clientWriter.close().catch(() => {}),
                new Promise(r => setTimeout(r, 1000))
              ]);
            } catch (e) {}

            // If target closed with 0 bytes, fail fast immediately (target dial refused, dropped, or redundant pre-connect)
            if (totalBytesRecv === 0) {
              if (onLog) {
                onLog('warning', `${logTag} ⚠️ [Brook] Target ${targetStr} closed connection with 0 bytes (dial refused, dropped, or redundant pre-connect)`);
              }
              cleanup('target_dial_refused', new Error('Target connection refused (0 bytes)'));
              return;
            }

            checkFullClose();
            if (serverRxClosed && !clientReadClosed) {
              // Bounded half-close: Allow client up to 5s to finish reading remaining response without holding session open
              resetIdleTimer(5000);
            }
            return;
          }
        }
      } catch (err) {
        cleanup('rx_error', err);
      } finally {
        isProcessingRx = false;
      }
    };

    try {
      // 3. Register QUIC stream receiver
      quicManager.registerStream(streamId, {
        onData: (data, fin) => {
          if (isTerminated) return;
          const dataLen = data ? data.length : 0;
          if (rxQueuedBytes + dataLen > MAX_RX_BUFFER_BYTES) {
            if (onLog) onLog('error', `${logTag} Downstream receive buffer overflow (${rxQueuedBytes + dataLen} > ${MAX_RX_BUFFER_BYTES}). Terminating tunnel.`);
            cleanup('rx_overflow', new Error('Downstream receive buffer overflow'));
            return;
          }
          rxQueuedBytes += dataLen;
          rxQueue.push({ data, fin });
          processRxQueue();
        },
        onClose: () => {
          serverRxClosed = true;
          cleanup('transport_closed');
        },
        onError: (err) => {
          if (onLog) onLog('error', `${logTag} QUIC stream ${streamId} error: ${err.message}`);
          cleanup('stream_error', err);
        }
      });

      // 4. Initiate Brook Client Handshake
      resetIdleTimer(15000);
      await quicManager.ensureConnected();

      // Step A: Send client nonce (12B)
      await quicManager.sendStreamData(streamId, cn, false);
      totalBytesSent += cn.length;
      if (onBytes) onBytes(cn.length, 0);

      // Step B: Send sealed header: [uint32 timestamp (even)] + dstBytes
      const headerBody = buildBrookHeader(dstBytes, true, clockOffsetSec);
      const sealedHeader = sealFrame(ck, cnCopy, headerBody);
      await quicManager.sendStreamData(streamId, sealedHeader, false);
      totalBytesSent += sealedHeader.length;
      if (onBytes) onBytes(sealedHeader.length, 0);

      // Step C: If there is leftover data (e.g. rewritten HTTP request), seal and send immediately
      if (leftover && leftover.length > 0) {
        hasExchangedData = true;
        const CHUNK_SIZE = 16384;
        for (let offset = 0; offset < leftover.length; offset += CHUNK_SIZE) {
          const slice = leftover.subarray(offset, Math.min(offset + CHUNK_SIZE, leftover.length));
          const sealedLeftover = sealFrame(ck, cnCopy, slice);
          await quicManager.sendStreamData(streamId, sealedLeftover, false);
          totalBytesSent += sealedLeftover.length;
          if (onBytes) onBytes(sealedLeftover.length, 0);
        }
      }

      // Step D: Start Dial Verification Timer only AFTER QUIC session is connected and frames are on wire
      handshakeTimer = setTimeout(() => {
        if (!serverHandshakeDone && !isTerminated) {
          if (onLog) {
            onLog('warning', `${logTag} ⚠️ [Brook] Server dial response pending for ${targetStr} (${(dialTimeoutMs / 1000).toFixed(1)}s). Session stalled or dropped.`);
          }
          cleanup('handshake_timeout', new Error(`Server dial timed out after ${dialTimeoutMs}ms`));
        }
      }, dialTimeoutMs);

      // Step E: Wait for Server Dial to complete before reading client payload bytes
      // This protects clientReader from being read or locked if initial dial fails
      try {
        await handshakePromise;
      } catch (handshakeErr) {
        // Dial failed, timed out, or refused
      }

      // 5. Start upstream read loop (Client -> QUIC) only when dial succeeded
      if (serverHandshakeDone && !isTerminated) {
        while (!isTerminated) {
          let readResult;
          try {
            readResult = await clientReader.read();
          } catch (err) {
            cleanup(serverHandshakeDone ? 'client_read_error' : 'client_abort', err);
            break;
          }

          const { value, done } = readResult;
          if (done) {
            clientReadClosed = true;
            if (!serverHandshakeDone) {
              cleanup('client_abort');
              break;
            }
            try {
              await quicManager.sendStreamData(streamId, new Uint8Array(0), true);
            } catch (e) {}
            checkFullClose();
            break;
          }

          if (value && value.length > 0) {
            if (onClientDataRead) {
              onClientDataRead();
            }
            hasExchangedData = true;
            resetIdleTimer(serverRxClosed ? 5000 : (totalBytesRecv > 0 ? 180000 : 15000));
            const CHUNK_SIZE = 16384;
            let writeFailed = false;
            for (let offset = 0; offset < value.length; offset += CHUNK_SIZE) {
              const slice = value.subarray(offset, Math.min(offset + CHUNK_SIZE, value.length));
              const sealedChunk = sealFrame(ck, cnCopy, slice);
              try {
                await quicManager.sendStreamData(streamId, sealedChunk, false);
                totalBytesSent += sealedChunk.length;
                if (onBytes) onBytes(sealedChunk.length, 0);
              } catch (err) {
                writeFailed = true;
                break;
              }
            }
            if (writeFailed) {
              cleanup('upstream_write_failed', new Error('Failed to send stream data to QUIC session'));
              break;
            }
          }
        }

        // If client finished sending but server is still replying, await completion
        if (!isTerminated && !serverRxClosed) {
          await completionPromise;
        }
      }
    } catch (err) {
      if (onLog) onLog('error', `${logTag} Tunnel error for ${targetStr}: ${err.message}`);
      cleanup('tunnel_error', err);
    } finally {
      await (cleanupPromise || cleanup('loop_exit'));
    }

    const isSuccess = terminationReason === 'both_closed' ||
                      terminationReason === 'normal' ||
                      (terminationReason === 'transport_closed' && totalBytesRecv > 0) ||
                      (terminationReason === 'client_abort' && totalBytesRecv > 0) ||
                      (terminationReason === 'client_read_error' && totalBytesRecv > 0) ||
                      (terminationReason === 'idle_timeout' && totalBytesRecv > 0);

    return {
      success: isSuccess,
      kind: terminationReason,
      bytesSent: totalBytesSent,
      bytesReceived: totalBytesRecv,
      serverHandshakeDone,
      error: terminationError
    };
  }
}
