import './shims/buffer.js';
import { QUICConnection } from '../node_modules/quico/src/quic_connection.js';
import { Emitter } from '../node_modules/quico/src/utils.js';
import { createQuicClientSocket } from '../node_modules/quico/src/quic_socket.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { gcm } from '@noble/ciphers/aes.js';

export { QUICConnection, Emitter, createQuicClientSocket, hkdf, sha256, gcm };
