// Core room / lobby / game orchestration. Knows nothing about specific games:
// it only talks to engines through the generic engine interface (see shared/engine.js).
import crypto from 'node:crypto';
import { defaultOptions, normalizeOptions } from '../../shared/options.js';
import { SYSTEM } from '../../shared/engine.js';
import { publicMeta } from '../registry.js';
import {
  generateCode,
  isValidCode,
  newId,
  normalizeCode,
  validateNickname,
  validateToken,
} from './validation.js';

export const ERR = {
  INVALID: 'INVALID',
  NOT_FOUND: 'NOT_FOUND',
  NEED_NICKNAME: 'NEED_NICKNAME',
  NICK_TAKEN: 'NICK_TAKEN',
  ROOM_FULL: 'ROOM_FULL',
  IN_PROGRESS: 'IN_PROGRESS',
  KICKED: 'KICKED',
  FORBIDDEN: 'FORBIDDEN',
  BAD_STATE: 'BAD_STATE',
  ILLEGAL: 'ILLEGAL',
};

export const TURN_TIMER_CHOICES = [0, 15, 30, 45, 60, 90, 120];
const MAX_LOG = 200;
const MAX_CHAT = 100;

const fail = (code, error) => ({ ok: false, code, error });

/** Pick a reasonable move from action descriptors when an engine has no getAutoAction. */
export function fallbackAutoAction(actions) {
  const action = actions.find((a) => !a.optional) ?? null;
  if (!action) return null;
  const out = { type: action.type };
  if (action.cards) {
    const pool = action.cards.allowed ?? [];
    if (pool.length < (action.cards.min ?? 0)) return null;
    out.cards = pool.slice(0, Math.max(action.cards.min ?? 0, 0));
  }
  for (const p of action.params ?? []) {
    if (p.type === 'number') {
      let v = p.default ?? p.min ?? 0;
      while ((p.disallowed ?? []).includes(v) && v < (p.max ?? v)) v++;
      out[p.name] = v;
    } else {
      out[p.name] = p.default ?? p.options?.[0]?.value ?? p.options?.[0];
    }
  }
  return out;
}

export class RoomManager {
  constructor({ games, store, config, emitter = null, now = () => Date.now() }) {
    this.games = games;
    this.store = store;
    this.config = config;
    this.emitter = emitter ?? { toPlayer() {}, toRoom() {}, evict() {} };
    this.now = now;
    this.rooms = new Map();
    this.loading = new Map();
    this.timers = new Map();
    this.conns = new Map();
    this.chatRate = new Map();
  }

  setEmitter(emitter) {
    this.emitter = emitter;
  }

  // ---------------------------------------------------------------- lookups

  listGames() {
    return [...this.games.values()]
      .map((g) => publicMeta(g.engine.meta))
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  }

  gameInfo(id) {
    const g = this.games.get(id);
    return g ? { ...publicMeta(g.engine.meta), rules: g.rules } : null;
  }

  engineFor(room) {
    return this.games.get(room.gameId)?.engine;
  }

  async getRoom(rawCode) {
    const code = normalizeCode(rawCode);
    if (!isValidCode(code)) return null;
    if (this.rooms.has(code)) return this.rooms.get(code);
    if (this.loading.has(code)) return this.loading.get(code);
    const p = (async () => {
      try {
        const room = await this.store.get(code);
        if (!room || !this.games.has(room.gameId)) return null;
        // Restored from Redis after a restart: nobody is connected yet.
        for (const pl of room.players) pl.connected = false;
        this.rooms.set(code, room);
        if (room.status === 'playing') this.updateTurn(room, null);
        return room;
      } catch (e) {
        console.warn('[rooms] load failed', e.message);
        return null;
      } finally {
        this.loading.delete(code);
      }
    })();
    this.loading.set(code, p);
    return p;
  }

  async roomSummary(rawCode) {
    const room = await this.getRoom(rawCode);
    if (!room) return null;
    const meta = this.engineFor(room).meta;
    return {
      code: room.code,
      gameId: room.gameId,
      gameName: meta.name,
      status: room.status,
      players: room.players.filter((p) => !p.left).length,
      maxPlayers: room.maxPlayers,
    };
  }

  player(room, id) {
    return room?.players.find((p) => p.id === id) ?? null;
  }

  // ---------------------------------------------------------------- create / join / leave

  newPlayer(token, nickname) {
    return {
      id: newId(),
      token,
      nickname,
      ready: false,
      connected: false,
      away: false,
      left: false,
      joinedAt: this.now(),
    };
  }

  async createRoom({ gameId, maxPlayers, nickname, token } = {}) {
    const game = this.games.get(gameId);
    if (!game) return fail(ERR.INVALID, 'Unknown game.');
    const t = validateToken(token);
    if (!t) return fail(ERR.INVALID, 'Invalid guest token. Refresh the page and try again.');
    const nick = validateNickname(nickname);
    if (nick.error) return fail(ERR.INVALID, nick.error);
    const { meta } = game.engine;

    let code;
    do code = generateCode();
    while (this.rooms.has(code) || (await this.store.has(code)));

    const host = this.newPlayer(t, nick.value);
    const room = {
      code,
      gameId,
      maxPlayers: clamp(Number(maxPlayers) || meta.maxPlayers, meta.minPlayers, meta.maxPlayers),
      options: defaultOptions(meta.options),
      settings: { turnTimer: 0 },
      hostId: host.id,
      status: 'lobby',
      players: [host],
      banned: [],
      game: null,
      gameSeq: 0,
      advance: null,
      results: null,
      toAct: [],
      deadline: null,
      log: [],
      chat: [],
      createdAt: this.now(),
      updatedAt: this.now(),
      version: 0,
    };
    this.rooms.set(code, room);
    this.addLog(room, `${host.nickname} created the room`);
    this.save(room);
    return { ok: true, code, playerId: host.id };
  }

  /** Join by code. Without a nickname this only succeeds if the token already has a seat (reconnect). */
  async joinRoom({ code, nickname, token } = {}) {
    const t = validateToken(token);
    if (!t) return fail(ERR.INVALID, 'Invalid guest token. Refresh the page and try again.');
    const normalized = normalizeCode(code);
    if (!isValidCode(normalized)) return fail(ERR.NOT_FOUND, 'That room code is not valid. Codes are 5 letters/numbers.');
    const room = await this.getRoom(normalized);
    if (!room) return fail(ERR.NOT_FOUND, 'Room not found. Check the code — the room may have closed.');
    if (room.banned.includes(t)) return fail(ERR.KICKED, 'You were removed from this room by the host.');

    const seat = room.players.find((p) => p.token === t);
    if (seat) {
      if (seat.left) {
        seat.left = false;
        this.addLog(room, `${seat.nickname} rejoined`);
        this.touch(room);
      }
      return { ok: true, code: room.code, playerId: seat.id, resumed: true };
    }

    if (nickname == null || String(nickname).trim() === '') {
      return fail(ERR.NEED_NICKNAME, 'Choose a nickname to join.');
    }
    const nick = validateNickname(nickname);
    if (nick.error) return fail(ERR.INVALID, nick.error);
    if (room.status === 'playing') {
      return fail(ERR.IN_PROGRESS, 'A game is in progress in this room. You can join when it finishes.');
    }
    if (room.players.some((p) => p.nickname.toLowerCase() === nick.value.toLowerCase())) {
      return fail(ERR.NICK_TAKEN, `"${nick.value}" is already taken in this room. Pick another nickname.`);
    }
    if (room.players.length >= room.maxPlayers) return fail(ERR.ROOM_FULL, 'This room is full.');

    const player = this.newPlayer(t, nick.value);
    room.players.push(player);
    this.addLog(room, `${player.nickname} joined`);
    this.touch(room);
    return { ok: true, code: room.code, playerId: player.id };
  }

  /** A socket for this seat connected. */
  async attach(code, playerId) {
    const room = await this.getRoom(code);
    const p = this.player(room, playerId);
    if (!p) return;
    const key = `${room.code}:${playerId}`;
    this.conns.set(key, (this.conns.get(key) ?? 0) + 1);
    this.clearTimer(`grace:${key}`);
    const wasAway = p.away;
    p.connected = true;
    p.away = false;
    if (wasAway) this.addLog(room, `${p.nickname} is back`);
    this.touch(room);
  }

  /** A socket for this seat disconnected. Starts the grace period when it was the last one. */
  detach(code, playerId) {
    const key = `${code}:${playerId}`;
    const n = (this.conns.get(key) ?? 1) - 1;
    if (n > 0) {
      this.conns.set(key, n);
      return;
    }
    this.conns.delete(key);
    const room = this.rooms.get(code);
    const p = this.player(room, playerId);
    if (!p || p.left) return;
    p.connected = false;
    const ms = room.status === 'playing' ? this.config.graceMs : this.config.lobbyGraceMs;
    this.setTimer(`grace:${key}`, ms, () => this.graceExpired(code, playerId));
    this.touch(room);
  }

  graceExpired(code, playerId) {
    const room = this.rooms.get(code);
    const p = this.player(room, playerId);
    if (!p || p.connected || p.left) return;
    if (room.status === 'playing') {
      p.away = true;
      this.addLog(room, `${p.nickname} disconnected — auto-playing their turns until they return`);
      if (room.hostId === playerId) this.transferHost(room);
      this.touch(room);
    } else {
      this.removePlayer(room, playerId, `${p.nickname} left (disconnected)`);
    }
  }

  async leave(code, playerId) {
    const room = await this.getRoom(code);
    const p = this.player(room, playerId);
    if (!p) return { ok: true };
    this.emitter.evict(room.code, playerId, 'left');
    this.conns.delete(`${room.code}:${playerId}`);
    this.clearTimer(`grace:${room.code}:${playerId}`);
    if (room.status === 'playing') {
      p.left = true;
      p.connected = false;
      this.addLog(room, `${p.nickname} left the game`);
      this.emitEvents(room, [{ type: 'left', text: `${p.nickname} left the game`, toast: true, playerId }], { log: false });
      if (room.hostId === playerId) this.transferHost(room);
      if (!this.ensureEnoughPlayers(room)) this.touch(room);
    } else {
      this.removePlayer(room, playerId, `${p.nickname} left`);
    }
    return { ok: true };
  }

  removePlayer(room, playerId, logText) {
    const p = this.player(room, playerId);
    if (!p) return;
    room.players = room.players.filter((x) => x.id !== playerId);
    this.conns.delete(`${room.code}:${playerId}`);
    this.clearTimer(`grace:${room.code}:${playerId}`);
    if (!room.players.length) {
      this.deleteRoom(room.code);
      return;
    }
    if (logText) this.addLog(room, logText);
    if (room.hostId === playerId) this.transferHost(room);
    this.touch(room);
  }

  transferHost(room) {
    const candidates = room.players.filter((p) => !p.left && p.id !== room.hostId);
    const next = candidates.find((p) => p.connected) ?? candidates[0];
    if (!next) return;
    room.hostId = next.id;
    this.addLog(room, `${next.nickname} is now the host`);
    this.emitEvents(room, [{ type: 'host', text: `${next.nickname} is now the host`, toast: true }], { log: false });
  }

  /** Ends the game if fewer than 2 players are still seated. Returns true if it ended. */
  ensureEnoughPlayers(room) {
    if (room.status !== 'playing') return false;
    const seated = room.players.filter((p) => !p.left);
    if (seated.length >= 2) return false;
    this.returnToLobby(room, 'Not enough players left — the game was ended.');
    return true;
  }

  // ---------------------------------------------------------------- lobby

  hostCheck(room, playerId) {
    if (!room) return fail(ERR.NOT_FOUND, 'Room not found.');
    if (room.hostId !== playerId) return fail(ERR.FORBIDDEN, 'Only the host can do that.');
    return null;
  }

  async setReady(code, playerId, ready) {
    const room = await this.getRoom(code);
    const p = this.player(room, playerId);
    if (!p) return fail(ERR.NOT_FOUND, 'You are not in this room.');
    if (room.status === 'playing') return fail(ERR.BAD_STATE, 'The game has already started.');
    p.ready = Boolean(ready);
    this.touch(room);
    return { ok: true };
  }

  async kick(code, hostId, targetId) {
    const room = await this.getRoom(code);
    const bad = this.hostCheck(room, hostId);
    if (bad) return bad;
    const target = this.player(room, targetId);
    if (!target) return fail(ERR.NOT_FOUND, 'Player not found.');
    if (target.id === hostId) return fail(ERR.INVALID, "You can't kick yourself.");
    const host = this.player(room, hostId);
    room.banned.push(target.token);
    this.emitter.evict(room.code, target.id, 'kicked');
    const text = `${host.nickname} removed ${target.nickname}`;
    if (room.status === 'playing') {
      target.left = true;
      target.connected = false;
      this.conns.delete(`${room.code}:${target.id}`);
      this.clearTimer(`grace:${room.code}:${target.id}`);
      this.addLog(room, `${text} — a bot plays their cards`);
      if (!this.ensureEnoughPlayers(room)) this.touch(room);
    } else {
      this.removePlayer(room, target.id, text);
    }
    return { ok: true };
  }

  async updateSettings(code, hostId, patch = {}) {
    const room = await this.getRoom(code);
    const bad = this.hostCheck(room, hostId);
    if (bad) return bad;
    if (room.status === 'playing') return fail(ERR.BAD_STATE, "Settings can't change during a game.");

    if (patch.gameId != null && patch.gameId !== room.gameId) {
      const g = this.games.get(patch.gameId);
      if (!g) return fail(ERR.INVALID, 'Unknown game.');
      const { meta } = g.engine;
      if (room.players.length > meta.maxPlayers) {
        return fail(ERR.INVALID, `${meta.name} allows at most ${meta.maxPlayers} players.`);
      }
      room.gameId = patch.gameId;
      room.options = defaultOptions(meta.options);
      room.maxPlayers = clamp(Math.max(room.maxPlayers, room.players.length), meta.minPlayers, meta.maxPlayers);
      room.game = null;
      room.results = null;
      room.status = 'lobby';
      this.addLog(room, `Game changed to ${meta.name}`);
    }
    const meta = this.engineFor(room).meta;
    if (patch.maxPlayers != null) {
      const lo = Math.max(meta.minPlayers, room.players.length);
      room.maxPlayers = clamp(Math.round(Number(patch.maxPlayers)) || lo, lo, meta.maxPlayers);
    }
    if (patch.options && typeof patch.options === 'object') {
      room.options = normalizeOptions(meta.options, patch.options, room.options);
    }
    if (patch.turnTimer != null) {
      const t = Number(patch.turnTimer);
      room.settings.turnTimer = TURN_TIMER_CHOICES.includes(t) ? t : 0;
    }
    this.touch(room);
    return { ok: true };
  }

  async start(code, hostId) {
    const room = await this.getRoom(code);
    const bad = this.hostCheck(room, hostId);
    if (bad) return bad;
    if (room.status === 'playing') return fail(ERR.BAD_STATE, 'The game is already running.');
    const meta = this.engineFor(room).meta;
    const players = room.players.filter((p) => !p.left);
    if (players.length < meta.minPlayers) {
      return fail(ERR.BAD_STATE, `${meta.name} needs at least ${meta.minPlayers} players.`);
    }
    if (players.length > meta.maxPlayers) {
      return fail(ERR.BAD_STATE, `${meta.name} allows at most ${meta.maxPlayers} players.`);
    }
    const notReady = players.filter((p) => p.id !== room.hostId && !p.ready);
    if (notReady.length) {
      return fail(ERR.BAD_STATE, `Waiting for ${notReady.map((p) => p.nickname).join(', ')} to be ready.`);
    }
    return this.startGame(room);
  }

  startGame(room) {
    const engine = this.engineFor(room);
    room.players = room.players.filter((p) => !p.left);
    const seed = crypto.randomBytes(8).toString('hex');
    let game;
    try {
      game = engine.createGame(
        room.players.map((p) => ({ id: p.id, name: p.nickname })),
        { ...normalizeOptions(engine.meta.options, room.options), seed },
      );
    } catch (e) {
      console.error('[rooms] createGame failed', e);
      return fail(ERR.BAD_STATE, e.message || 'Could not start the game.');
    }
    room.game = game;
    room.gameSeq = 0;
    room.advance = null;
    room.status = 'playing';
    room.results = null;
    room.toAct = [];
    room.deadline = null;
    for (const p of room.players) p.ready = false;
    this.addLog(room, `— New game of ${engine.meta.name} —`);
    this.emitEvents(room, [{ type: 'start', text: `${engine.meta.name} started — good luck!`, toast: true }], { log: false });
    this.touch(room);
    return { ok: true };
  }

  async playAgain(code, hostId) {
    const room = await this.getRoom(code);
    const bad = this.hostCheck(room, hostId);
    if (bad) return bad;
    if (room.status !== 'finished') return fail(ERR.BAD_STATE, 'The game has not finished yet.');
    const meta = this.engineFor(room).meta;
    room.players = room.players.filter((p) => !p.left);
    if (room.players.length < meta.minPlayers || room.players.length > meta.maxPlayers) {
      this.returnToLobby(room, `Back in the lobby — ${meta.name} needs ${meta.minPlayers}–${meta.maxPlayers} players.`);
      return { ok: true };
    }
    return this.startGame(room);
  }

  async backToLobby(code, hostId) {
    const room = await this.getRoom(code);
    const bad = this.hostCheck(room, hostId);
    if (bad) return bad;
    if (room.status === 'lobby') return { ok: true };
    const host = this.player(room, hostId);
    this.returnToLobby(room, room.status === 'playing' ? `${host.nickname} ended the game` : 'Back to the lobby');
    return { ok: true };
  }

  returnToLobby(room, message) {
    this.clearRoomTimers(room.code);
    room.status = 'lobby';
    room.game = null;
    room.results = null;
    room.toAct = [];
    room.deadline = null;
    room.advance = null;
    room.players = room.players.filter((p) => !p.left);
    for (const p of room.players) {
      p.ready = false;
      p.away = false;
    }
    if (room.hostId && !this.player(room, room.hostId)) {
      room.hostId = room.players[0]?.id;
    }
    if (message) {
      this.addLog(room, message);
      this.emitEvents(room, [{ type: 'lobby', text: message, toast: true }], { log: false });
    }
    if (!room.players.length) {
      this.deleteRoom(room.code);
      return;
    }
    this.touch(room);
  }

  // ---------------------------------------------------------------- gameplay

  async action(code, playerId, action) {
    const room = await this.getRoom(code);
    const p = this.player(room, playerId);
    if (!p) return fail(ERR.NOT_FOUND, 'You are not in this room.');
    if (room.status !== 'playing' || !room.game) return fail(ERR.BAD_STATE, 'No game is running.');
    if (!action || typeof action !== 'object' || typeof action.type !== 'string') {
      return fail(ERR.INVALID, 'Malformed action.');
    }
    if (JSON.stringify(action).length > 4000) return fail(ERR.INVALID, 'Action too large.');
    const res = this.applyGameAction(room, playerId, action);
    return res.error ? fail(ERR.ILLEGAL, res.error) : { ok: true };
  }

  applyGameAction(room, playerId, action, { auto = null } = {}) {
    const engine = this.engineFor(room);
    let res;
    try {
      res = engine.applyAction(room.game, playerId, action);
    } catch (e) {
      console.error(`[game:${room.gameId}] applyAction threw`, e);
      return { error: 'Something went wrong processing that move.' };
    }
    if (!res || res.error || !res.state) return { error: res?.error || 'Illegal move.' };
    room.game = res.state;
    room.gameSeq += 1;
    if (auto === 'timeout') {
      const p = this.player(room, playerId);
      this.emitEvents(room, [{ type: 'timeout', text: `⏱ ${p?.nickname ?? 'A player'} ran out of time`, toast: true }]);
    }
    this.emitEvents(room, res.events ?? []);
    this.touch(room, { actor: playerId });
    return { ok: true };
  }

  autoAct(code, playerId, reason) {
    const room = this.rooms.get(code);
    if (!room || room.status !== 'playing' || !room.game) return;
    const engine = this.engineFor(room);
    const legal = engine.getLegalActions(room.game, playerId);
    if (!legal.length) return;
    let action = null;
    try {
      action = engine.getAutoAction ? engine.getAutoAction(room.game, playerId) : null;
    } catch (e) {
      console.error(`[game:${room.gameId}] getAutoAction threw`, e);
    }
    action ??= fallbackAutoAction(legal);
    if (!action) return;
    const res = this.applyGameAction(room, playerId, action, { auto: reason });
    if (res.error) {
      const fb = fallbackAutoAction(legal);
      const second = fb ? this.applyGameAction(room, playerId, fb, { auto: reason }) : res;
      if (second.error) console.warn(`[game:${room.gameId}] auto action failed for ${playerId}: ${second.error}`);
    }
  }

  systemAdvance(code) {
    const room = this.rooms.get(code);
    if (!room || room.status !== 'playing' || !room.game?.autoAdvance) return;
    const res = this.applyGameAction(room, SYSTEM, room.game.autoAdvance.action);
    if (res.error) console.warn(`[game:${room.gameId}] auto-advance failed: ${res.error}`);
  }

  turnExpired(code) {
    const room = this.rooms.get(code);
    if (!room || room.status !== 'playing') return;
    // A timeout finishes the slow player's whole turn (some turns take several moves, e.g. draw + discard).
    for (const pid of [...room.toAct]) {
      for (let i = 0; i < 12 && room.status === 'playing' && room.toAct.includes(pid); i++) {
        const before = room.gameSeq;
        this.autoAct(code, pid, i === 0 ? 'timeout' : 'continue');
        if (room.gameSeq === before) break;
      }
    }
  }

  requiredActions(engine, game, playerId) {
    return engine.getLegalActions(game, playerId).filter((a) => !a.optional);
  }

  /** Recompute whose turn it is and (re)arm timers, bots and auto-advance. */
  updateTurn(room, actor) {
    const engine = this.engineFor(room);
    const code = room.code;
    this.clearRoomTimers(code);
    if (engine.isGameOver(room.game)) {
      this.finishGame(room);
      return;
    }
    const now = this.now();
    const prev = room.toAct ?? [];
    const toAct = room.players
      .filter((p) => this.requiredActions(engine, room.game, p.id).length > 0)
      .map((p) => p.id);
    room.toAct = toAct;

    const adv = room.game.autoAdvance;
    if (adv) {
      if (!room.advance || room.advance.seq !== room.gameSeq) {
        room.advance = { seq: room.gameSeq, at: now + (adv.delayMs ?? 1500) };
      }
      this.setTimer(`advance:${code}`, Math.max(0, room.advance.at - now), () => this.systemAdvance(code));
    } else {
      room.advance = null;
    }

    const someoneHere = room.players.some((p) => p.connected && !p.left);
    if (someoneHere) {
      for (const pid of toAct) {
        const p = this.player(room, pid);
        if (p && (p.left || p.away)) {
          this.setTimer(`bot:${code}:${pid}`, this.config.botDelayMs, () => this.autoAct(code, pid, 'bot'));
        }
      }
    }

    const seconds = room.settings.turnTimer;
    if (seconds > 0 && toAct.length) {
      const keep =
        room.deadline &&
        room.deadline > now &&
        toAct.every((id) => prev.includes(id)) &&
        !(actor && toAct.includes(actor));
      if (!keep) room.deadline = now + seconds * 1000;
      this.setTimer(`turn:${code}`, Math.max(0, room.deadline - now), () => this.turnExpired(code));
    } else {
      room.deadline = null;
    }
  }

  finishGame(room) {
    const engine = this.engineFor(room);
    room.status = 'finished';
    room.toAct = [];
    room.deadline = null;
    room.advance = null;
    try {
      room.results = engine.getResults(room.game);
    } catch (e) {
      console.error('[rooms] getResults failed', e);
      room.results = { rankings: [], winners: [], summary: 'Game over' };
    }
    const names = (room.results.winners ?? []).map((id) => this.player(room, id)?.nickname ?? '?');
    const text = room.results.summary || (names.length ? `Game over — ${names.join(' & ')} won!` : 'Game over');
    this.addLog(room, text);
    this.emitEvents(room, [{ type: 'gameOver', text, toast: true, winners: room.results.winners }], { log: false });
  }

  // ---------------------------------------------------------------- chat

  async chat(code, playerId, rawText) {
    const room = await this.getRoom(code);
    const p = this.player(room, playerId);
    if (!p) return fail(ERR.NOT_FOUND, 'You are not in this room.');
    const text = String(rawText ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 300);
    if (!text) return fail(ERR.INVALID, 'Message is empty.');
    const key = `${room.code}:${playerId}`;
    const now = this.now();
    const recent = (this.chatRate.get(key) ?? []).filter((t) => now - t < 5000);
    if (recent.length >= 5) return fail(ERR.INVALID, 'Slow down a little.');
    recent.push(now);
    this.chatRate.set(key, recent);
    const msg = { id: newId(), playerId, nickname: p.nickname, text, t: now };
    room.chat.push(msg);
    if (room.chat.length > MAX_CHAT) room.chat.splice(0, room.chat.length - MAX_CHAT);
    this.emitter.toRoom(room.code, 'chat:message', msg);
    this.save(room);
    return { ok: true };
  }

  chatHistory(room) {
    return room ? room.chat.slice(-50) : [];
  }

  // ---------------------------------------------------------------- state out

  publicRoom(room) {
    const engine = this.engineFor(room);
    return {
      code: room.code,
      gameId: room.gameId,
      gameName: engine.meta.name,
      minPlayers: engine.meta.minPlayers,
      maxPlayersAllowed: engine.meta.maxPlayers,
      maxPlayers: room.maxPlayers,
      options: room.options,
      settings: room.settings,
      hostId: room.hostId,
      status: room.status,
      version: room.version,
      players: room.players.map((p) => ({
        id: p.id,
        nickname: p.nickname,
        ready: p.ready,
        connected: p.connected,
        away: p.away,
        left: p.left,
        isHost: p.id === room.hostId,
      })),
    };
  }

  stateFor(room, playerId) {
    const engine = this.engineFor(room);
    let game = null;
    if (room.game) {
      game = {
        view: engine.getPlayerView(room.game, playerId),
        actions: room.status === 'playing' ? engine.getLegalActions(room.game, playerId) : [],
        toAct: room.toAct,
        deadline: room.deadline,
      };
    }
    return {
      me: playerId,
      room: this.publicRoom(room),
      game,
      results: room.results,
      log: room.log.slice(-80),
      serverNow: this.now(),
    };
  }

  broadcast(room) {
    for (const p of room.players) {
      if (p.left) continue;
      this.emitter.toPlayer(room.code, p.id, 'room:state', this.stateFor(room, p.id));
    }
  }

  emitEvents(room, events, { log = true } = {}) {
    for (const ev of events) {
      if (!ev) continue;
      const payload = { ...ev, t: this.now() };
      if (ev.to) {
        this.emitter.toPlayer(room.code, ev.to, 'game:event', payload);
        continue;
      }
      if (log && ev.text) this.addLog(room, ev.text);
      this.emitter.toRoom(room.code, 'game:event', payload);
    }
  }

  addLog(room, text) {
    room.log.push({ t: this.now(), text });
    if (room.log.length > MAX_LOG) room.log.splice(0, room.log.length - MAX_LOG);
  }

  /** Something changed: bump version, re-arm timers, broadcast and persist. */
  touch(room, { actor = null } = {}) {
    if (!this.rooms.has(room.code)) return;
    room.version += 1;
    room.updatedAt = this.now();
    if (room.status === 'playing' && room.game) this.updateTurn(room, actor);
    this.broadcast(room);
    this.save(room);
  }

  save(room) {
    Promise.resolve(this.store.set(room.code, room)).catch((e) => console.warn('[store] save failed', e.message));
  }

  deleteRoom(code) {
    for (const key of [...this.timers.keys()]) if (key.includes(`:${code}`)) this.clearTimer(key);
    for (const key of [...this.conns.keys()]) if (key.startsWith(`${code}:`)) this.conns.delete(key);
    this.rooms.delete(code);
    Promise.resolve(this.store.delete(code)).catch(() => {});
  }

  /** Delete rooms nobody has been connected to for a while. */
  sweep() {
    const now = this.now();
    for (const room of [...this.rooms.values()]) {
      const anyone = room.players.some((p) => p.connected);
      if (!anyone && now - room.updatedAt > this.config.roomIdleMs) this.deleteRoom(room.code);
    }
  }

  // ---------------------------------------------------------------- timers

  setTimer(key, ms, fn) {
    this.clearTimer(key);
    const t = setTimeout(() => {
      this.timers.delete(key);
      try {
        fn();
      } catch (e) {
        console.error(`[timer ${key}]`, e);
      }
    }, ms);
    t.unref?.();
    this.timers.set(key, t);
  }

  clearTimer(key) {
    const t = this.timers.get(key);
    if (t) clearTimeout(t);
    this.timers.delete(key);
  }

  clearRoomTimers(code) {
    for (const key of [...this.timers.keys()]) {
      if (key === `turn:${code}` || key === `advance:${code}` || key.startsWith(`bot:${code}:`)) this.clearTimer(key);
    }
  }

  shutdown() {
    for (const key of [...this.timers.keys()]) this.clearTimer(key);
  }
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}
