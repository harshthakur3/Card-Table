import test from 'node:test';
import assert from 'node:assert/strict';
import * as rummy from './index.js';
import { act, actWithEvents, assertEngineShape, assertNoLeaks, cards, expectError, makePlayers, simulate } from '../_test/harness.js';

test('engine shape', () => assertEngineShape(rummy));

test('sets and runs', () => {
  assert.ok(rummy.isSet(cards('7S 7H 7D')));
  assert.ok(rummy.isSet(cards('7S 7H 7D 7C')));
  assert.ok(!rummy.isSet(cards('7S 7H')));
  assert.ok(!rummy.isSet(cards('7S 7H 8D')));
  assert.ok(rummy.isRun(cards('5H 3H 4H')));
  assert.ok(rummy.isRun(cards('AH 2H 3H')), 'ace low');
  assert.ok(!rummy.isRun(cards('QH KH AH')), 'ace is low by default');
  assert.ok(rummy.isRun(cards('QH KH AH'), true), 'ace high option');
  assert.ok(!rummy.isRun(cards('KH AH 2H'), true), 'no wrapping round');
  assert.ok(!rummy.isRun(cards('5H 6H 7D')), 'same suit only');
  assert.equal(rummy.cardPoints(cards('KS')[0]), 10);
  assert.equal(rummy.cardPoints(cards('AS')[0]), 1);
  assert.equal(rummy.cardPoints(cards('7S')[0]), 7);
});

test('deal sizes: 10 for 2 players, 7 for 3-4, 6 for 5-6', () => {
  const size = (n) => rummy.createGame(makePlayers(n), { seed: 'd' }).hands.p1.length;
  assert.equal(size(2), 10);
  assert.equal(size(4), 7);
  assert.equal(size(6), 6);
  const g = rummy.createGame(makePlayers(2), { seed: 'd' });
  assert.equal(g.discard.length, 1);
  assert.equal(g.stock.length, 52 - 20 - 1);
});

function setup() {
  const g = rummy.createGame(makePlayers(2), { seed: 'r' });
  g.hands = { p1: cards('5H 6H 7H 9C 9D KS'), p2: cards('2C 3D 4S 8S 10D JC') };
  g.discard = cards('9S');
  g.stock = cards('AC 2D 3H 4C 5S');
  g.turnIdx = 0;
  g.phase = 'draw';
  return g;
}

test('a full turn: draw, meld, discard — and going out scores the others’ deadwood', () => {
  let g = setup();
  expectError(rummy, g, 'p1', { type: 'meld', cards: ['5H', '6H', '7H'] }, /Draw a card first/);
  expectError(rummy, g, 'p2', { type: 'drawStock' }, /P1's turn/);
  g = act(rummy, g, 'p1', { type: 'drawDiscard' });
  expectError(rummy, g, 'p1', { type: 'drawStock' }, /already drew/);
  expectError(rummy, g, 'p1', { type: 'discard', cards: ['9S'] }, /just took/);
  expectError(rummy, g, 'p1', { type: 'meld', cards: ['9C', '9D'] }, /at least 3/);
  expectError(rummy, g, 'p1', { type: 'meld', cards: ['9C', '9D', 'KS'] }, /not a valid/);
  g = act(rummy, g, 'p1', { type: 'meld', cards: ['5H', '6H', '7H'] });
  g = act(rummy, g, 'p1', { type: 'meld', cards: ['9C', '9D', '9S'] });
  assert.deepEqual(g.melds.map((m) => m.type), ['run', 'set']);
  const res = actWithEvents(rummy, g, 'p1', { type: 'discard', cards: ['KS'] });
  g = res.state;
  assert.ok(res.events.some((e) => e.type === 'out'));
  // p2 deadwood: 2 + 3 + 4 + 8 + 10 + 10 = 37
  assert.equal(g.scores.p1, 37);
  assert.equal(g.phase, 'over', 'one hand by default');
  assert.deepEqual(rummy.getResults(g).winners, ['p1']);
});

test('laying off onto any meld on the table', () => {
  let g = setup();
  g.turnIdx = 1;
  g.hands.p2 = cards('8H 4H 2C 10S');
  g.melds = [{ id: 'm1', type: 'run', cards: cards('5H 6H 7H'), owner: 'p1' }];
  g = act(rummy, g, 'p2', { type: 'drawStock' });
  expectError(rummy, g, 'p2', { type: 'layoff', cards: ['2C'], meld: 'm1' }, /doesn't fit/);
  expectError(rummy, g, 'p2', { type: 'layoff', cards: ['8H'], meld: 'nope' }, /which meld/);
  g = act(rummy, g, 'p2', { type: 'layoff', cards: ['8H'], meld: 'm1' });
  g = act(rummy, g, 'p2', { type: 'layoff', cards: ['4H'], meld: 'm1' });
  assert.deepEqual(g.melds[0].cards.map((c) => c.id), ['4H', '5H', '6H', '7H', '8H']);
  g = act(rummy, g, 'p2', { type: 'discard', cards: ['2C'] });
  assert.equal(g.players[g.turnIdx], 'p1');
  assert.equal(g.phase, 'draw');
});

test('the stock is rebuilt from the discards, a limited number of times', () => {
  let g = setup();
  g.stock = [];
  g.discard = cards('2S 3S 4S 5S');
  g = act(rummy, g, 'p1', { type: 'drawStock' });
  assert.equal(g.roundReshuffles, 1);
  assert.deepEqual(g.discard.map((c) => c.id), ['5S']);
  assert.equal(g.stock.length, 2);
  // When reshuffles are used up the hand ends with nobody going out.
  let h = setup();
  h.stock = [];
  h.roundReshuffles = 3;
  h = act(rummy, h, 'p1', { type: 'drawStock' });
  assert.equal(h.phase, 'over');
  assert.equal(h.history[0].winner, null);
});

test('multi-hand games play to the target', () => {
  const { game, results } = simulate(rummy, rummy.createGame(makePlayers(3), { seed: 'target', target: 100 }));
  assert.ok(game.history.length >= 1);
  const top = Math.max(...Object.values(game.scores));
  for (const w of results.winners) assert.equal(game.scores[w], top);
});

test('no hidden information leaks', () => {
  assertNoLeaks(rummy, rummy.createGame(makePlayers(4), { seed: 'leak' }));
});

test('bots finish full games', () => {
  for (const n of [2, 3, 4, 6]) {
    const { results } = simulate(rummy, rummy.createGame(makePlayers(n), { seed: `rm${n}` }));
    assert.ok(results.winners.length >= 1);
  }
});
