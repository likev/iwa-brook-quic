import './shims/buffer.js';
import { QUICConnection } from '../node_modules/quico/src/quic_connection.js';
import { Emitter } from '../node_modules/quico/src/utils.js';
import { createQuicClientSocket } from '../node_modules/quico/src/quic_socket.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { gcm, unsafe as aesUnsafe } from '@noble/ciphers/aes.js';
import { ghash } from '@noble/ciphers/_polyval.js';

export { QUICConnection, Emitter, createQuicClientSocket, hkdf, sha256, gcm, aesUnsafe, ghash };
