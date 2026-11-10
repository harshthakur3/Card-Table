// Where the game server lives.
// Empty (the default) means "same address as this website": the Vite dev proxy locally,
// or a server that also serves the built site. Set VITE_SERVER_URL at build time when the
// website and the game server are deployed separately, e.g. VITE_SERVER_URL=https://cards-api.example.com
export const SERVER_URL = (import.meta.env.VITE_SERVER_URL || '').trim().replace(/\/+$/, '');

export const apiUrl = (path) => `${SERVER_URL}${path}`;
