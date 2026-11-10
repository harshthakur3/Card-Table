// Integration tests: a real server + real socket.io clients.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { io as connectClient } from 'socket.io-client';
import { createApp } from '../src/app.js';

const here = path.dirname(fileURLToPath(import.meta.url));

const config = {
  port: 0,
  redisUrl: '',
  graceMs: 300,
  lobbyGraceMs: 300,
  roomIdleMs: 60_000,
  botDelayMs: 30,
  corsOrigin: '*',
  gamesDir: path.resolve(here, '../games'),
  clientDist: path.resolve(here, '../../client/dist-none'),
};

let app;
let url;
const clients = [];

test.before(async () => {
  app = await createApp(config);
  await new Promise((r) => app.server.listen(0, r));
  url = `http://localhost:${app.server.address().port}`;
});

test.after(async () => {
  for (const c of clients) c.disconnect();
  await app.close();
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A test player: socket + token + the latest room:state it received. */
async function player(token = crypto.randomUUID()) {
  const socket = connectClient(url, { transports: ['websocket'], forceNew: true, reconnection: false });
  clients.push(socket);
  const p = { socket, token, state: null, events: [], chat: [], evicted: null };
  socket.on('room:state', (s) => (p.state = s));
  socket.on('game:event', (e) => p.events.push(e));
  socket.on('chat:message', (m) => p.chat.push(m));
  socket.on('room:evicted', (e) => (p.evicted = e));
  await new Promise((r) => socket.on('connect', r));
  return p;
}

function req(p, event, payload = {}) {
  return new Promise((resolve) => p.socket.emit(event, { token: p.token, ...payload }, resolve));
}

async function until(fn, ms = 2000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const v = fn();
    if (v) return v;
    await sleep(10);
  }
  throw new Error('condition not met in time');
}

async function lobbyWith(n, gameId = 'bluff') {
  const host = await player();
  const created = await req(host, 'room:create', { gameId, nickname: 'Host', maxPlayers: 8 });
  assert.equal(created.ok, true, created.error);
  const others = [];
  for (let i = 1; i < n; i++) {
    const p = await player();
    const res = await req(p, 'room:join', { code: created.code, nickname: `Guest${i}` });
    assert.equal(res.ok, true, res.error);
    others.push(p);
  }
  await until(() => host.state?.room.players.length === n);
  return { code: created.code, host, others, all: [host, ...others] };
}

test('REST: games list and rules', async () => {
  const games = await (await fetch(`${url}/api/games`)).json();
  assert.ok(games.length >= 3);
  assert.equal(games[0].id, 'bluff');
  const info = await (await fetch(`${url}/api/games/bluff`)).json();
  assert.match(info.rules, /Bluff/);
  const missing = await fetch(`${url}/api/rooms/ZZZZZ`);
  assert.equal(missing.status, 404);
});

test('create room gives a 5-character code; invalid codes are rejected', async () => {
  const host = await player();
  const res = await req(host, 'room:create', { gameId: 'bluff', nickname: 'Harsh', maxPlayers: 4 });
  assert.equal(res.ok, true);
  assert.match(res.code, /^[A-Z2-9]{5}$/);
  await until(() => host.state);
  assert.equal(host.state.room.hostId, host.state.me);

  const p = await player();
  const bad = await req(p, 'room:join', { code: 'ZZZZZ', nickname: 'Bob' });
  assert.equal(bad.code, 'NOT_FOUND');
  const garbage = await req(p, 'room:join', { code: '!!', nickname: 'Bob' });
  assert.equal(garbage.code, 'NOT_FOUND');
});

test('nicknames: required, validated and unique per room (case-insensitive)', async () => {
  const { code } = await lobbyWith(1);
  const p = await player();
  assert.equal((await req(p, 'room:join', { code })).code, 'NEED_NICKNAME');
  assert.equal((await req(p, 'room:join', { code, nickname: 'x' })).code, 'INVALID');
  assert.equal((await req(p, 'room:join', { code, nickname: 'a'.repeat(17) })).code, 'INVALID');
  const taken = await req(p, 'room:join', { code, nickname: 'host' });
  assert.equal(taken.code, 'NICK_TAKEN');
  assert.match(taken.error, /already taken/);
  assert.equal((await req(p, 'room:join', { code, nickname: 'Hosty' })).ok, true);
});

test('room full', async () => {
  const host = await player();
  const { code } = await req(host, 'room:create', { gameId: 'bluff', nickname: 'Host', maxPlayers: 3 });
  for (const name of ['Ann', 'Ben']) assert.equal((await req(await player(), 'room:join', { code, nickname: name })).ok, true);
  const res = await req(await player(), 'room:join', { code, nickname: 'Cat' });
  assert.equal(res.code, 'ROOM_FULL');
});

test('lobby: ready toggles gate the start; only the host can start', async () => {
  const { host, others } = await lobbyWith(3);
  const early = await req(host, 'game:start');
  assert.equal(early.ok, false);
  assert.match(early.error, /Waiting for Guest1, Guest2/);
  assert.equal((await req(others[0], 'game:start')).code, 'FORBIDDEN');
  for (const o of others) assert.equal((await req(o, 'lobby:ready', { ready: true })).ok, true);
  assert.equal((await req(host, 'game:start')).ok, true);
  await until(() => host.state.room.status === 'playing' && others.every((o) => o.state.game));
});

test('server is authoritative: each player only ever sees their own hand', async () => {
  const { host, others, all } = await lobbyWith(3);
  for (const o of others) await req(o, 'lobby:ready', { ready: true });
  await req(host, 'game:start');
  await until(() => all.every((p) => p.state.game?.view.hand.length > 0));
  const hands = all.map((p) => p.state.game.view.hand.map((c) => c.id));
  assert.equal(hands.flat().length, 52);
  assert.equal(new Set(hands.flat()).size, 52, 'no card dealt twice');
  for (let i = 0; i < all.length; i++) {
    const raw = JSON.stringify(all[i].state);
    for (let j = 0; j < all.length; j++) {
      if (i === j) continue;
      for (const id of hands[j]) assert.ok(!raw.includes(`"id":"${id}"`), `player ${i} saw card ${id}`);
    }
    // Opponents are described by counts only.
    const opp = all[i].state.game.view.players.find((p) => p.id !== all[i].state.me);
    assert.equal(typeof opp.cardCount, 'number');
    assert.equal(opp.hand, undefined);
  }
});

test('illegal and out-of-turn moves get clear errors', async () => {
  const { host, others, all } = await lobbyWith(3);
  for (const o of others) await req(o, 'lobby:ready', { ready: true });
  await req(host, 'game:start');
  await until(() => all.every((p) => p.state.game));
  const turnId = host.state.game.toAct[0];
  const waiting = all.find((p) => p.state.me !== turnId);
  const card = waiting.state.game.view.hand[0];
  const res = await req(waiting, 'game:action', { action: { type: 'play', cards: [card.id], rank: 'A' } });
  assert.equal(res.ok, false);
  assert.match(res.error, /turn/);
  const current = all.find((p) => p.state.me === turnId);
  const bogus = await req(current, 'game:action', { action: { type: 'play', cards: ['NOPE'], rank: 'A' } });
  assert.match(bogus.error, /don't have/);
  const malformed = await req(current, 'game:action', { action: 'x' });
  assert.equal(malformed.ok, false);
});

test('reconnect with the same token restores the same seat (lobby and mid-game)', async () => {
  const { code, host, others, all } = await lobbyWith(3);
  const guest = others[0];
  const seat = guest.state.me;
  guest.socket.disconnect();
  await until(() => host.state.room.players.find((p) => p.id === seat)?.connected === false);
  const back = await player(guest.token);
  const res = await req(back, 'room:join', { code });
  assert.equal(res.ok, true);
  assert.equal(res.resumed, true);
  assert.equal(res.playerId, seat);
  await until(() => back.state?.me === seat);

  await req(back, 'lobby:ready', { ready: true });
  await req(others[1], 'lobby:ready', { ready: true });
  await req(host, 'game:start');
  await until(() => back.state.game);
  const handBefore = back.state.game.view.hand.map((c) => c.id);
  back.socket.disconnect();
  const again = await player(guest.token);
  assert.equal((await req(again, 'room:join', { code })).playerId, seat);
  await until(() => again.state?.game);
  assert.deepEqual(again.state.game.view.hand.map((c) => c.id), handBefore);
  assert.ok(all.length === 3);
});

test('a dropped player keeps their seat for the grace period, then a bot plays for them', async () => {
  const { host, others, all } = await lobbyWith(3);
  for (const o of others) await req(o, 'lobby:ready', { ready: true });
  await req(host, 'game:start');
  await until(() => all.every((p) => p.state.game));
  const dropped = others[1];
  const id = dropped.state.me;
  dropped.socket.disconnect();
  await until(() => host.state.room.players.find((p) => p.id === id)?.away === true, 3000);
  // Play until it is the dropped player's turn; the bot should act for them.
  for (let i = 0; i < 6 && host.state.room.status === 'playing'; i++) {
    const turn = host.state.game.toAct[0];
    if (turn === id) {
      const before = host.state.game.view.players.find((p) => p.id === id).cardCount;
      await until(() => host.state.game.view.players.find((p) => p.id === id).cardCount !== before || host.state.game.toAct[0] !== id, 3000);
      return;
    }
    const actor = all.find((p) => p.state.me === turn);
    // Each client gets its own update; wait until this one has seen that it is its turn.
    await until(() => actor.state.game.actions.some((a) => a.type === 'play'));
    const legal = actor.state.game.actions;
    const play = legal.find((a) => a.type === 'play');
    const hand = actor.state.game.view.hand;
    await req(actor, 'game:action', { action: { type: 'play', cards: [hand[0].id], rank: play.params ? hand[0].rank : undefined } });
    await until(() => host.state.game.toAct[0] !== turn || host.state.room.status !== 'playing');
  }
});

test('kick: host removes a player who cannot rejoin; non-hosts cannot kick', async () => {
  const { code, host, others } = await lobbyWith(3);
  const target = others[0];
  const targetId = target.state.me;
  assert.equal((await req(others[1], 'lobby:kick', { playerId: host.state.me })).code, 'FORBIDDEN');
  assert.equal((await req(host, 'lobby:kick', { playerId: targetId })).ok, true);
  await until(() => target.evicted?.reason === 'kicked');
  await until(() => !host.state.room.players.some((p) => p.id === targetId));
  assert.equal((await req(target, 'room:join', { code, nickname: 'Again' })).code, 'KICKED');
});

test('host leaving transfers host; leaving mid-game hands the seat to a bot or ends the game', async () => {
  const { host, others } = await lobbyWith(3);
  const [a, b] = others;
  await req(host, 'room:leave');
  await until(() => a.state.room.hostId === a.state.me);
  assert.equal(a.state.room.players.length, 2);

  // 3-player game, one leaves -> bot; another leaves -> not enough players -> lobby.
  const c = await player();
  await req(c, 'room:join', { code: a.state.room.code, nickname: 'Cee' });
  for (const p of [b, c]) await req(p, 'lobby:ready', { ready: true });
  assert.equal((await req(a, 'game:start')).ok, true);
  await until(() => a.state.room.status === 'playing');
  await req(c, 'room:leave');
  await until(() => a.state.room.players.find((p) => p.nickname === 'Cee')?.left === true);
  assert.equal(a.state.room.status, 'playing');
  await req(b, 'room:leave');
  await until(() => a.state.room.status === 'lobby');
  assert.equal(a.state.room.players.length, 1);
});

test('chat is broadcast to the room', async () => {
  const { host, others } = await lobbyWith(2);
  assert.equal((await req(others[0], 'chat:send', { text: '  hello   table ' })).ok, true);
  await until(() => host.chat.some((m) => m.text === 'hello table' && m.nickname === 'Guest1'));
  assert.equal((await req(others[0], 'chat:send', { text: '   ' })).ok, false);
});

test('settings: host changes options and game; values are validated', async () => {
  const { host, others } = await lobbyWith(3);
  assert.equal((await req(others[0], 'lobby:settings', { turnTimer: 30 })).code, 'FORBIDDEN');
  await req(host, 'lobby:settings', { turnTimer: 30, options: { decks: 2, claimMode: 'nonsense' } });
  await until(() => host.state.room.settings.turnTimer === 30);
  assert.equal(host.state.room.options.decks, 2);
  assert.equal(host.state.room.options.claimMode, 'free', 'invalid option values fall back to defaults');
  await req(host, 'lobby:settings', { turnTimer: 7 });
  await until(() => host.state.room.settings.turnTimer === 0);
  await req(host, 'lobby:settings', { maxPlayers: 1 });
  await until(() => host.state.room.maxPlayers === 3, 1000);
});

test('turn timer expiry makes a move for the slow player', async () => {
  const { code, host, others, all } = await lobbyWith(3);
  await req(host, 'lobby:settings', { turnTimer: 15 });
  for (const o of others) await req(o, 'lobby:ready', { ready: true });
  await req(host, 'game:start');
  await until(() => all.every((p) => p.state.game?.deadline));
  const turn = host.state.game.toAct[0];
  app.rooms.turnExpired(code); // fast-forward the clock
  await until(() => host.state.game.toAct[0] !== turn);
  assert.ok(host.events.some((e) => e.type === 'timeout'));
});

test('play again keeps the same room and players', async () => {
  const { code, host, others, all } = await lobbyWith(3);
  for (const o of others) await req(o, 'lobby:ready', { ready: true });
  await req(host, 'game:start');
  await until(() => all.every((p) => p.state.game));
  // Force a finish: let bots play everyone.
  const room = app.rooms.rooms.get(code);
  for (const p of room.players) p.away = true;
  app.rooms.touch(room);
  await until(() => host.state.room.status === 'finished', 15000);
  assert.ok(host.state.results.rankings.length === 3);
  for (const p of room.players) p.away = false;
  assert.equal((await req(others[0], 'game:playAgain')).code, 'FORBIDDEN');
  assert.equal((await req(host, 'game:playAgain')).ok, true);
  await until(() => host.state.room.status === 'playing' && host.state.room.code === code);
  assert.equal(host.state.room.players.length, 3);
});
