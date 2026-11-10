// Test helpers shared by every game's tests. Folders starting with "_" are not loaded as games.
import assert from 'node:assert/strict';
import { SYSTEM } from '../../shared/engine.js';

export function makePlayers(n) {
  return Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}` }));
}

export function card(id) {
  const m = /^(10|[2-9JQKA])([SHDC])$/.exec(id);
  if (!m) throw new Error(`bad card ${id}`);
  return { id, rank: m[1], suit: m[2] };
}

export function cards(str) {
  return str.trim().split(/\s+/).filter(Boolean).map(card);
}

/** Apply an action and fail the test on error. */
export function act(engine, game, playerId, action) {
  const res = engine.applyAction(game, playerId, action);
  if (res.error) throw new Error(`${playerId} ${JSON.stringify(action)} -> ${res.error}`);
  assert.ok(res.state, 'applyAction must return state');
  return res.state;
}

export function actWithEvents(engine, game, playerId, action) {
  const res = engine.applyAction(game, playerId, action);
  if (res.error) throw new Error(`${playerId} ${JSON.stringify(action)} -> ${res.error}`);
  return res;
}

export function expectError(engine, game, playerId, action, pattern) {
  const before = JSON.stringify(game);
  const res = engine.applyAction(game, playerId, action);
  assert.ok(res.error, `expected an error for ${playerId} ${JSON.stringify(action)}`);
  if (pattern) assert.match(res.error, pattern);
  assert.equal(JSON.stringify(game), before, 'a rejected action must not modify the game');
  return res.error;
}

export function advance(engine, game) {
  assert.ok(game.autoAdvance, 'expected a pending auto-advance');
  return act(engine, game, SYSTEM, game.autoAdvance.action);
}

/** Run system advances until something needs a player. */
export function settle(engine, game) {
  let g = game;
  while (g.autoAdvance && !engine.isGameOver(g)) g = advance(engine, g);
  return g;
}

/** No player's view may contain another player's hidden cards, or the stock. */
export function assertNoLeaks(engine, game, { hiddenKeys = ['stock'] } = {}) {
  const hands = game.hands ?? {};
  for (const viewer of game.players) {
    const json = JSON.stringify(engine.getPlayerView(game, viewer));
    const legal = JSON.stringify(engine.getLegalActions(game, viewer));
    for (const [owner, list] of Object.entries(hands)) {
      if (owner === viewer) continue;
      for (const c of list) {
        assert.ok(!json.includes(`"id":"${c.id}"`), `${viewer}'s view leaks ${owner}'s card ${c.id}`);
        assert.ok(!legal.includes(`"${c.id}"`), `${viewer}'s actions leak ${owner}'s card ${c.id}`);
      }
    }
    for (const key of hiddenKeys) {
      for (const c of game[key] ?? []) {
        assert.ok(!json.includes(`"id":"${c.id}"`), `${viewer}'s view leaks hidden ${key} card ${c.id}`);
      }
    }
  }
}

/** Play a whole game with getAutoAction bots, checking invariants along the way. */
export function simulate(engine, game, { maxSteps = 20000, leakEvery = 5, leakCheck, onStep } = {}) {
  let g = game;
  let steps = 0;
  while (!engine.isGameOver(g)) {
    steps += 1;
    if (steps > maxSteps) throw new Error(`game did not finish within ${maxSteps} steps`);
    if (leakEvery && steps % leakEvery === 0) (leakCheck ?? ((x) => assertNoLeaks(engine, x)))(g);
    if (g.autoAdvance) {
      g = advance(engine, g);
      continue;
    }
    const pid = g.players.find((p) => engine.getLegalActions(g, p).some((a) => !a.optional));
    if (!pid) throw new Error(`nobody can act but the game is not over (phase ${g.phase})`);
    const action = engine.getAutoAction(g, pid);
    assert.ok(action, `getAutoAction returned nothing for ${pid} in phase ${g.phase}`);
    g = act(engine, g, pid, action);
    onStep?.(g, pid, action);
  }
  const results = engine.getResults(g);
  assert.ok(Array.isArray(results.rankings) && results.rankings.length > 0, 'results need rankings');
  assert.ok(results.winners.length > 0, 'results need at least one winner');
  return { game: g, steps, results };
}

/** Engine contract checks every game must pass. */
export function assertEngineShape(engine) {
  const m = engine.meta;
  assert.ok(m.id && m.name && m.description, 'meta id/name/description');
  assert.ok(m.minPlayers >= 1 && m.maxPlayers >= m.minPlayers, 'player range');
  for (const fn of ['createGame', 'getPublicState', 'getPlayerView', 'getLegalActions', 'applyAction', 'isGameOver', 'getResults', 'getAutoAction']) {
    assert.equal(typeof engine[fn], 'function', `${fn} must be a function`);
  }
}

/** Total number of cards across the given containers. */
export function countCards(...containers) {
  let n = 0;
  for (const c of containers) {
    if (Array.isArray(c)) n += c.length;
    else if (c && typeof c === 'object') for (const v of Object.values(c)) n += Array.isArray(v) ? v.length : 0;
  }
  return n;
}
