/**
 * Brook Tunnel Orchestrator: pipes data between local TCP client and remote Brook QUIC stream.
 * Supports full-duplex streaming with independent half-close coordination,
 * early handshake timeout (10s), speculative socket pruning (15s), and rich protocol logging.
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
   * @param {Function} options.onBytes - Callback for throughput accounting (sent, received)
   * @param {Function} options.onClose - Callback when session terminates
   * @param {Function} options.onLog - Logging callback
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
    dialTimeoutMs = 2000,
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

    let totalBytesSent = 0;
    let totalBytesRecv = 0;

    let resolveCompletion = null;
    const completionPromise = new Promise(r => { resolveCompletion = r; });

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

    // Serialized FIFO queue for downstream processing to prevent race conditions on sn
    const rxQueue = [];
    let isProcessingRx = false;

    // 2. Timers:
    // A. Brook Server Dial Verification Timer (fail fast at 3.5s if no sn returned)
    let handshakeTimer = setTimeout(() => {
      if (!serverHandshakeDone && !isTerminated) {
        if (onLog) {
          onLog('warning', `${logTag} ⚠️ [Brook] Server dial response pending for ${targetStr} (${(dialTimeoutMs / 1000).toFixed(1)}s). Session stalled or dropped.`);
        }
        cleanup('handshake_timeout');
      }
    }, dialTimeoutMs);

    // B. Idle Timer (15s for speculative pre-connects with 0 bytes, 180s for active streams to respect browser keep-alive)
    let idleTimer = null;
    const resetIdleTimer = (durationMs = (hasExchangedData ? 180000 : 15000)) => {
      if (idleTimer) clearTimeout(idleTimer);
      if (!isTerminated) {
        idleTimer = setTimeout(() => {
          if (!isTerminated) {
            if (!hasExchangedData && onLog) {
              onLog('info', `${logTag} ℹ️ Speculative pre-connect for ${targetStr} idle for 15s (closed by pool hygiene).`);
            }
            cleanup('idle_timeout');
          }
        }, durationMs);
      }
    };

    const cleanup = async (reason = 'normal') => {
      if (isTerminated) return;
      isTerminated = true;

      if (handshakeTimer) {
        clearTimeout(handshakeTimer);
        handshakeTimer = null;
      }
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }

      quicManager.unregisterStream(streamId);

      // If dial never succeeded, inform client with error
      if (!serverHandshakeDone && sendFailure) {
        try {
          await sendFailure(0x05);
          sendFailure = null;
        } catch (e) {}
      }

      try {
        await clientReader.cancel().catch(() => {});
        clientReader.releaseLock();
      } catch (e) {}

      try {
        await clientWriter.close().catch(() => {});
        clientWriter.releaseLock();
      } catch (e) {}

      const durationSec = ((Date.now() - tunnelStartTime) / 1000).toFixed(2);
      if (onLog && hasExchangedData) {
        onLog('info', `${logTag} 🛑 Tunnel finished for ${targetStr} (Up: ${totalBytesSent}B, Down: ${totalBytesRecv}B, ${durationSec}s)`);
      }

      if (onClose) onClose();
      if (resolveCompletion) resolveCompletion();
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
          const { data, fin } = rxQueue.shift();

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
              if (sendSuccess) {
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
                  cleanup('decrypt_error');
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
                  cleanup('decrypt_error');
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
                    cleanup('client_write_error');
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
              await clientWriter.close().catch(() => {});
            } catch (e) {}

            // If target closed with 0 bytes, fail fast immediately (target dial refused / connection reset)
            if (totalBytesRecv === 0) {
              if (onLog) {
                onLog('warning', `${logTag} ⚠️ [Brook] Target ${targetStr} closed connection with 0 bytes (dial refused or dropped)`);
              }
              cleanup('target_dial_refused');
              return;
            }

            checkFullClose();
            if (serverRxClosed && !clientReadClosed) {
              setTimeout(() => cleanup('server_fin_timeout'), 1500);
            }
            return;
          }
        }
      } catch (err) {
        cleanup('rx_error');
      } finally {
        isProcessingRx = false;
      }
    };

    try {
      // 3. Register QUIC stream receiver
      quicManager.registerStream(streamId, {
        onData: (data, fin) => {
          if (isTerminated) return;
          rxQueue.push({ data, fin });
          processRxQueue();
        },
        onClose: () => {
          serverRxClosed = true;
          if (rxQueue.length === 0 && !isProcessingRx) {
            checkFullClose();
          }
        },
        onError: (err) => {
          if (onLog) onLog('error', `${logTag} QUIC stream ${streamId} error: ${err.message}`);
          cleanup('stream_error');
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

      // 5. Start upstream read loop (Client -> QUIC)
      while (!isTerminated) {
        let readResult;
        try {
          readResult = await clientReader.read();
        } catch (err) {
          cleanup(serverHandshakeDone ? 'client_read_error' : 'client_abort');
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
          resetIdleTimer(180000);
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
            cleanup('upstream_write_failed');
            break;
          }
        }
      }

      // If client finished sending but server is still replying, await completion
      if (!isTerminated && !serverRxClosed) {
        await completionPromise;
      }
    } catch (err) {
      if (onLog) onLog('error', `${logTag} Tunnel error for ${targetStr}: ${err.message}`);
    } finally {
      cleanup('loop_exit');
    }
  }
}
