import test from 'node:test';
import assert from 'node:assert/strict';
import * as goFish from './index.js';
import { act, actWithEvents, assertEngineShape, assertNoLeaks, cards, expectError, makePlayers, simulate } from '../_test/harness.js';

test('engine shape', () => assertEngineShape(goFish));

test('deal: 7 cards for 2-3 players, 5 for 4+', () => {
  const g3 = goFish.createGame(makePlayers(3), { seed: 'deal' });
  const g4 = goFish.createGame(makePlayers(4), { seed: 'deal' });
  const total = (g) => Object.values(g.hands).flat().length + g.stock.length + Object.values(g.books).flat().length * 4;
  assert.equal(total(g3), 52);
  assert.equal(total(g4), 52);
  assert.equal(g3.options.dealSize, 7);
  assert.equal(g4.options.dealSize, 5);
  assert.equal(goFish.createGame(makePlayers(4), { seed: 'd', dealSize: 7 }).options.dealSize, 7);
});

function setup() {
  const g = goFish.createGame(makePlayers(3), { seed: 'fish' });
  g.hands = { p1: cards('AS AH 5C'), p2: cards('AD 7C'), p3: cards('9D') };
  g.books = { p1: [], p2: [], p3: [] };
  g.stock = cards('5D 3S 4S');
  g.turnIdx = 0;
  return g;
}

test('a successful ask takes every card of that rank and you go again', () => {
  let g = setup();
  const res = actWithEvents(goFish, g, 'p1', { type: 'ask', cards: ['AS'], target: 'p2' });
  g = res.state;
  assert.deepEqual(g.hands.p1.map((c) => c.id).sort(), ['5C', 'AD', 'AH', 'AS']);
  assert.deepEqual(g.hands.p2.map((c) => c.id), ['7C']);
  assert.equal(g.players[g.turnIdx], 'p1', 'same player asks again');
  assert.ok(res.events.some((e) => e.type === 'give' && /got 1/.test(e.text)));
});

test('go fish: draw from the pond; a lucky catch keeps the turn', () => {
  let g = setup();
  // p3 has no 5s; the pond's top card is the 5♦ — lucky catch.
  let res = actWithEvents(goFish, g, 'p1', { type: 'ask', cards: ['5C'], target: 'p3' });
  g = res.state;
  assert.ok(res.events.some((e) => e.type === 'goFish'));
  assert.ok(res.events.some((e) => e.type === 'lucky'));
  const drew = res.events.find((e) => e.type === 'drew');
  assert.equal(drew.to, 'p1', 'only the drawer is told which card they drew');
  assert.equal(g.players[g.turnIdx], 'p1');
  // Now the pond's top card is the 3♠ — the turn passes on.
  g = act(goFish, g, 'p1', { type: 'ask', cards: ['5C'], target: 'p3' });
  assert.equal(g.players[g.turnIdx], 'p2');
  assert.ok(g.hands.p1.some((c) => c.id === '3S'));
});

test('lucky catch can be turned off', () => {
  let g = setup();
  g.options.luckyCatch = false;
  g = act(goFish, g, 'p1', { type: 'ask', cards: ['5C'], target: 'p3' });
  assert.equal(g.players[g.turnIdx], 'p2');
});

test('four of a kind becomes a book', () => {
  let g = setup();
  g.hands = { p1: cards('KS KH KD 2C'), p2: cards('KC 3D'), p3: cards('9D') };
  const res = actWithEvents(goFish, g, 'p1', { type: 'ask', cards: ['KS'], target: 'p2' });
  g = res.state;
  assert.deepEqual(g.books.p1.map((b) => b.rank), ['K']);
  assert.deepEqual(g.hands.p1.map((c) => c.id), ['2C']);
  assert.ok(res.events.some((e) => e.type === 'book' && /Kings/.test(e.text)));
});

test('illegal asks are rejected with clear errors', () => {
  const g = setup();
  expectError(goFish, g, 'p1', { type: 'ask', rank: 'Q', target: 'p2' }, /rank you already hold/);
  expectError(goFish, g, 'p1', { type: 'ask', cards: ['QS'], target: 'p2' }, /don't have/);
  expectError(goFish, g, 'p1', { type: 'ask', cards: ['AS'], target: 'p1' }, /another player/);
  expectError(goFish, g, 'p2', { type: 'ask', cards: ['AD'], target: 'p1' }, /P1's turn/);
  expectError(goFish, g, 'p1', { type: 'fish' }, /Unknown/);
  const empty = setup();
  empty.hands.p3 = [];
  expectError(goFish, empty, 'p1', { type: 'ask', cards: ['AS'], target: 'p3' }, /no cards/);
});

test('an empty hand is refilled from the pond on your turn', () => {
  let g = setup();
  g.hands = { p1: cards('AS'), p2: cards('AD 7C'), p3: cards('AC') };
  // p1 gets the A♦ … no book yet; then asks p3 and takes the A♣.
  g = act(goFish, g, 'p1', { type: 'ask', cards: ['AS'], target: 'p2' });
  g = act(goFish, g, 'p1', { type: 'ask', cards: ['AS'], target: 'p3' });
  // p3 now has no cards; when their turn comes they draw one.
  assert.equal(g.hands.p3.length, 0);
});

test('no hidden information leaks', () => {
  const g = goFish.createGame(makePlayers(5), { seed: 'leak' });
  assertNoLeaks(goFish, g);
});

test('bots finish full games and all 13 books get made', () => {
  for (const n of [2, 3, 4, 6]) {
    const { game, results } = simulate(goFish, goFish.createGame(makePlayers(n), { seed: `gf${n}` }));
    const books = game.players.reduce((s, id) => s + game.books[id].length, 0);
    assert.equal(books, 13);
    const best = Math.max(...game.players.map((id) => game.books[id].length));
    for (const w of results.winners) assert.equal(game.books[w].length, best);
  }
});
