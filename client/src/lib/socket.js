import { io } from 'socket.io-client';
import { SERVER_URL } from './serverUrl.js';

const options = {
  autoConnect: true,
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionDelay: 500,
  reconnectionDelayMax: 4000,
};

// One shared connection: to VITE_SERVER_URL if set, otherwise to this site's own address
// (in dev, Vite proxies /socket.io to the server).
export const socket = SERVER_URL ? io(SERVER_URL, options) : io(options);

/** Emit with an acknowledgement, resolving to the server's { ok, error, ... } reply. */
export function request(event, payload = {}, timeoutMs = 8000) {
  return new Promise((resolve) => {
    if (!socket.connected) socket.connect();
    socket.timeout(timeoutMs).emit(event, payload, (err, res) => {
      if (err) resolve({ ok: false, code: 'TIMEOUT', error: 'The server did not respond. Check your connection.' });
      else resolve(res ?? { ok: false, error: 'No response' });
    });
  });
}
