import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const num = (v, d) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);

/** "*" (anyone) or a comma-separated list of site origins, e.g. "https://cards.example.com,https://www.example.com". */
export function parseOrigins(value) {
  if (!value || value.trim() === '*') return '*';
  const list = value
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  return list.length ? list : '*';
}

export const config = {
  port: num(process.env.PORT, 3001),
  // Leave empty to use the in-memory store. Example: redis://localhost:6379
  redisUrl: process.env.REDIS_URL || '',
  // How long a dropped player keeps their seat before bots take over (in game) or they are removed (lobby).
  graceMs: num(process.env.RECONNECT_GRACE_MS, 60_000),
  lobbyGraceMs: num(process.env.LOBBY_GRACE_MS, 30_000),
  // Rooms with nobody connected are deleted after this long.
  roomIdleMs: num(process.env.ROOM_IDLE_MS, 30 * 60_000),
  botDelayMs: num(process.env.BOT_DELAY_MS, 1200),
  // Where the website is hosted, when it is on a different domain from this server.
  corsOrigin: parseOrigins(process.env.CORS_ORIGIN),
  gamesDir: process.env.GAMES_DIR || path.resolve(here, '../games'),
  // Optional: if the built website exists here, this server serves it too (one-service deploy).
  clientDist: process.env.CLIENT_DIST || path.resolve(here, '../../client/dist'),
};
