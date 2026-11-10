// Guest identity: a random token in localStorage lets a refresh / reconnect reclaim the same seat.
// No accounts, no personal data — just a token and the last nickname used.
const TOKEN_KEY = 'cardtable.token';
const NICK_KEY = 'cardtable.nickname';

function safeGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode: fine, we just won't remember */
  }
}

let memoryToken = null;

function randomToken() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function getToken() {
  let t = safeGet(TOKEN_KEY) ?? memoryToken;
  if (!t || !/^[A-Za-z0-9_-]{16,64}$/.test(t)) {
    t = randomToken();
    memoryToken = t;
    safeSet(TOKEN_KEY, t);
  }
  return t;
}

export function getSavedNickname() {
  return safeGet(NICK_KEY) ?? '';
}

export function saveNickname(nick) {
  safeSet(NICK_KEY, nick);
}

export function validateNickname(raw) {
  const v = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (v.length < 2 || v.length > 16) return 'Nickname must be 2–16 characters.';
  if (!/^[\p{L}\p{N}\p{M} _.'-]+$/u.test(v)) return "Use letters, numbers, spaces and _ . - ' only.";
  return null;
}
