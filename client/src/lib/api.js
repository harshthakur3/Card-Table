import { apiUrl } from './serverUrl.js';

let gamesPromise = null;
const infoCache = new Map();

export function fetchGames() {
  gamesPromise ??= fetch(apiUrl('/api/games'))
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .catch((e) => {
      gamesPromise = null;
      throw e;
    });
  return gamesPromise;
}

/** Game meta + rules markdown. */
export function fetchGameInfo(id) {
  if (!infoCache.has(id)) {
    infoCache.set(
      id,
      fetch(apiUrl(`/api/games/${encodeURIComponent(id)}`)).then((r) => {
        if (!r.ok) {
          infoCache.delete(id);
          throw new Error(r.status === 404 ? 'Unknown game' : `HTTP ${r.status}`);
        }
        return r.json();
      }),
    );
  }
  return infoCache.get(id);
}

export async function fetchRoomSummary(code) {
  const r = await fetch(apiUrl(`/api/rooms/${encodeURIComponent(code)}`));
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
