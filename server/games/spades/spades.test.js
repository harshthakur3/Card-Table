import test from 'node:test';
import assert from 'node:assert/strict';
import * as spades from './index.js';
import { act, actWithEvents, advance, assertEngineShape, assertNoLeaks, cards, expectError, makePlayers, simulate } from '../_test/harness.js';

test('engine shape', () => assertEngineShape(spades));

test('needs exactly 4 players, 13 cards each', () => {
  assert.throws(() => spades.createGame(makePlayers(3)));
  const g = spades.createGame(makePlayers(4), { seed: 's' });
  for (const id of g.players) assert.equal(g.hands[id].length, 13);
  assert.equal(g.phase, 'bid');
  assert.equal(g.players[g.turnIdx], 'p2', 'player left of the dealer bids first');
});

test('bidding in turn, Nil allowed, out-of-range rejected', () => {
  let g = spades.createGame(makePlayers(4), { seed: 'bid' });
  expectError(spades, g, 'p1', { type: 'bid', bid: 3 }, /turn to bid/);
  expectError(spades, g, 'p2', { type: 'bid', bid: 14 }, /Nil or 1 to 13/);
  expectError(spades, g, 'p2', { type: 'play', cards: [g.hands.p2[0].id] }, /Bidding is not finished/);
  g = act(spades, g, 'p2', { type: 'bid', bid: 0 });
  g = act(spades, g, 'p3', { type: 'bid', bid: 4 });
  g = act(spades, g, 'p4', { type: 'bid', bid: 3 });
  g = act(spades, g, 'p1', { type: 'bid', bid: 2 });
  assert.equal(g.phase, 'play');
  assert.equal(g.players[g.turnIdx], 'p2');
  const noNil = spades.createGame(makePlayers(4), { seed: 'bid', nil: false });
  expectError(spades, noNil, 'p2', { type: 'bid', bid: 0 }, /1 to 13/);
});

test('spades are trumps and can only be led once broken', () => {
  let g = spades.createGame(makePlayers(4), { seed: 'trump' });
  g.phase = 'play';
  g.bids = { p1: 1, p2: 1, p3: 1, p4: 1 };
  g.hands = { p1: cards('AS 3H'), p2: cards('KH 4H'), p3: cards('2S 5D'), p4: cards('QH 6C') };
  g.turnIdx = 0;
  expectError(spades, g, 'p1', { type: 'play', cards: ['AS'] }, /Spades haven't been broken/);
  g = act(spades, g, 'p1', { type: 'play', cards: ['3H'] });
  expectError(spades, g, 'p3', { type: 'play', cards: ['2S'] }, /P2's turn/);
  g = act(spades, g, 'p2', { type: 'play', cards: ['KH'] });
  const res = actWithEvents(spades, g, 'p3', { type: 'play', cards: ['2S'] });
  assert.ok(res.events.some((e) => e.type === 'broken'));
  g = act(spades, res.state, 'p4', { type: 'play', cards: ['QH'] });
  assert.equal(g.lastTrickWinner, 'p3', 'the 2♠ trumps the K♥');
  g = advance(spades, g);
  assert.equal(g.players[g.turnIdx], 'p3');
  expectError(spades, g, 'p4', { type: 'play', cards: ['6C'] }, /P3's turn/);
});

test('scoring: contracts, bags and Nil', () => {
  let g = spades.createGame(makePlayers(4), { seed: 'score' });
  g.phase = 'play';
  g.spadesBroken = true;
  g.bids = { p1: 4, p2: 0, p3: 3, p4: 3 };
  g.tricks = { p1: 4, p2: 3, p3: 3, p4: 2 };
  g.hands = { p1: cards('AS'), p2: cards('2H'), p3: cards('3H'), p4: cards('4H') };
  g.turnIdx = 0;
  for (const [p, c] of [['p1', 'AS'], ['p2', '2H'], ['p3', '3H'], ['p4', '4H']]) g = act(spades, g, p, { type: 'play', cards: [c] });
  const res = actWithEvents(spades, g, '__system__', g.autoAdvance.action);
  g = res.state;
  // Team A (p1+p3): bid 7, took 8 → 70 + 1 bag.
  // Team B (p2+p4): p2 failed Nil (−100), p4 bid 3 took 2 (−30); p2's 3 tricks count as bags (+3).
  assert.deepEqual(g.teamScores, [71, -127]);
  assert.deepEqual(g.teamBags, [1, 3]);
  assert.ok(res.events.some((e) => e.type === 'nil' && /failed/.test(e.text)));
});

test('ten bags cost 100 points', () => {
  let g = spades.createGame(makePlayers(4), { seed: 'bags' });
  g.phase = 'play';
  g.spadesBroken = true;
  g.teamBags = [8, 0];
  g.bids = { p1: 1, p2: 4, p3: 1, p4: 5 };
  g.tricks = { p1: 3, p2: 4, p3: 0, p4: 5 };
  g.hands = { p1: cards('AS'), p2: cards('2H'), p3: cards('3H'), p4: cards('4H') };
  g.turnIdx = 0;
  for (const [p, c] of [['p1', 'AS'], ['p2', '2H'], ['p3', '3H'], ['p4', '4H']]) g = act(spades, g, p, { type: 'play', cards: [c] });
  g = advance(spades, g);
  // Team A: bid 2, took 4 → 20 + 2 bags = 22, bags 8+2 = 10 → −100 → −78.
  // Team B: bid 9, took exactly 9 → 90.
  assert.deepEqual(g.teamScores, [-78, 90]);
  assert.deepEqual(g.teamBags, [0, 0]);
});

test('results rank both partners together', () => {
  const g = spades.createGame(makePlayers(4), { seed: 'r' });
  g.teamScores = [320, 150];
  g.phase = 'over';
  const r = spades.getResults(g);
  assert.deepEqual(r.winners.sort(), ['p1', 'p3']);
});

test('no hidden information leaks', () => {
  assertNoLeaks(spades, spades.createGame(makePlayers(4), { seed: 'leak' }));
});

test('bots finish full games', () => {
  for (const seed of ['a', 'b']) {
    const { results } = simulate(spades, spades.createGame(makePlayers(4), { seed, target: 200 }));
    assert.equal(results.winners.length, 2);
  }
});
