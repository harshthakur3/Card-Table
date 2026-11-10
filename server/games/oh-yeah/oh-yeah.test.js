import test from 'node:test';
import assert from 'node:assert/strict';
import * as ohYeah from './index.js';
import { act, actWithEvents, advance, assertEngineShape, assertNoLeaks, cards, expectError, makePlayers, simulate } from '../_test/harness.js';

test('engine shape', () => assertEngineShape(ohYeah));

test('defaults: hands go down then up and trumps rotate ♠ ♥ ♦ ♣ none', () => {
  const g = ohYeah.createGame(makePlayers(4), { seed: 'y' });
  assert.deepEqual(g.schedule, [7, 6, 5, 4, 3, 2, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(g.trump, 'S');
  assert.equal(g.trumpCard, null);
  const seen = [];
  let s = simulate(ohYeah, g, {
    onStep: (state) => {
      if (state.history.length === seen.length + 1 || seen.length === 0) seen.push(state.trump);
    },
  });
  assert.equal(s.game.history.length, 13);
  assert.deepEqual(s.game.history.slice(0, 6).map((h) => h.trump), ['S', 'H', 'D', 'C', null, 'S']);
});

test('predictions are secret until everyone has predicted', () => {
  let g = ohYeah.createGame(makePlayers(3), { seed: 'secret', maxCards: 3 });
  // Anyone may predict, in any order.
  assert.equal(ohYeah.getLegalActions(g, 'p3')[0].type, 'bid');
  g = act(ohYeah, g, 'p3', { type: 'bid', bid: 2 });
  expectError(ohYeah, g, 'p3', { type: 'bid', bid: 1 }, /already/);
  const v1 = ohYeah.getPlayerView(g, 'p1');
  assert.equal(v1.bids.p3, 'hidden');
  assert.equal(v1.players.find((p) => p.id === 'p3').stats[0].value, '✓');
  assert.ok(!JSON.stringify(v1).includes('"p3":2'));
  assert.equal(ohYeah.getPlayerView(g, 'p3').bids.p3, 2, 'you see your own prediction');
  g = act(ohYeah, g, 'p1', { type: 'bid', bid: 0 });
  const res = actWithEvents(ohYeah, g, 'p2', { type: 'bid', bid: 1 });
  g = res.state;
  assert.equal(g.phase, 'play');
  assert.ok(res.events.some((e) => e.type === 'reveal' && /P3 2/.test(e.text)));
  assert.equal(ohYeah.getPlayerView(g, 'p1').bids.p3, 2);
});

test('scoring: exact = 10 + 2 per trick; miss = penalty per trick off', () => {
  let g = ohYeah.createGame(makePlayers(3), { seed: 'score', maxCards: 2, missPenalty: 2 });
  g.schedule = [2, 1];
  g.trump = 'S';
  g.hands = { p1: cards('AH 2C'), p2: cards('KH 3C'), p3: cards('QH 4C') };
  g = act(ohYeah, g, 'p1', { type: 'bid', bid: 1 });
  g = act(ohYeah, g, 'p2', { type: 'bid', bid: 1 });
  g = act(ohYeah, g, 'p3', { type: 'bid', bid: 0 });
  assert.equal(g.players[g.turnIdx], 'p2', 'player left of the dealer leads');
  for (const [p, c] of [['p2', 'KH'], ['p3', 'QH'], ['p1', 'AH']]) g = act(ohYeah, g, p, { type: 'play', cards: [c] });
  g = advance(ohYeah, g);
  for (const [p, c] of [['p1', '2C'], ['p2', '3C'], ['p3', '4C']]) g = act(ohYeah, g, p, { type: 'play', cards: [c] });
  const res = actWithEvents(ohYeah, g, '__system__', g.autoAdvance.action);
  // p1 bid 1 won 1 => 12; p2 bid 1 won 0 => -2; p3 bid 0 won 1 => -2
  assert.deepEqual(res.state.scores, { p1: 12, p2: -2, p3: -2 });
  assert.ok(res.events.some((e) => /Oh Yeah!/.test(e.text) && /P1/.test(e.text)));
});

test('options: turn-up trumps and bidding in turn', () => {
  const g = ohYeah.createGame(makePlayers(3), { seed: 'o', trumpMode: 'turnup', bidding: 'turns' });
  assert.ok(g.trumpCard);
  assert.equal(ohYeah.getLegalActions(g, 'p3').length, 0, 'only the current bidder may bid');
  const n = ohYeah.createGame(makePlayers(3), { seed: 'o', trumpMode: 'none' });
  assert.equal(n.trump, null);
});

test('no hidden information leaks', () => {
  const g = ohYeah.createGame(makePlayers(6), { seed: 'leak' });
  assertNoLeaks(ohYeah, g);
});

test('bots finish full games', () => {
  for (const n of [3, 5, 7]) {
    const { results } = simulate(ohYeah, ohYeah.createGame(makePlayers(n), { seed: `y${n}`, maxCards: 5 }));
    assert.ok(results.winners.length >= 1);
  }
});
