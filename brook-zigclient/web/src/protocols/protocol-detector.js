/**
 * Protocol auto-detection for unified port proxy listening.
 */

export const ProtocolType = {
  SOCKS5: 'socks5',
  HTTP: 'http',
  UNKNOWN: 'unknown'
};

const HTTP_INITIAL_CHARS = new Set([
  0x43, // 'C' (CONNECT)
  0x47, // 'G' (GET)
  0x50, // 'P' (POST, PUT, PATCH)
  0x48, // 'H' (HEAD)
  0x44, // 'D' (DELETE)
  0x4F, // 'O' (OPTIONS)
  0x54  // 'T' (TRACE)
]);

export class ProtocolDetector {
  /**
   * Detect protocol type from the initial chunk.
   *
   * @param {Uint8Array} initialChunk - First chunk read from incoming TCP connection
   * @returns {string} ProtocolType ('socks5', 'http', or 'unknown')
   */
  static detect(initialChunk) {
    if (!initialChunk || initialChunk.length === 0) {
      return ProtocolType.UNKNOWN;
    }

    const firstByte = initialChunk[0];

    // SOCKS5 starts with version byte 0x05
    if (firstByte === 0x05) {
      return ProtocolType.SOCKS5;
    }

    // HTTP methods start with uppercase ASCII letters
    if (HTTP_INITIAL_CHARS.has(firstByte)) {
      return ProtocolType.HTTP;
    }

    return ProtocolType.UNKNOWN;
  }
}
