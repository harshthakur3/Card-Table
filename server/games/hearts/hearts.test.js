import test from 'node:test';
import assert from 'node:assert/strict';
import * as hearts from './index.js';
import { act, actWithEvents, advance, assertEngineShape, assertNoLeaks, cards, expectError, makePlayers, simulate } from '../_test/harness.js';

test('engine shape', () => assertEngineShape(hearts));

test('deal: 3 and 5 players drop low cards so everyone gets the same', () => {
  const sizes = (n) => Object.values(hearts.createGame(makePlayers(n), { seed: 'd' }).hands).map((h) => h.length);
  assert.deepEqual(sizes(3), [17, 17, 17]);
  assert.deepEqual(sizes(4), [13, 13, 13, 13]);
  assert.deepEqual(sizes(5), [10, 10, 10, 10, 10]);
  const g5 = hearts.createGame(makePlayers(5), { seed: 'd' });
  const ids = Object.values(g5.hands).flat().map((c) => c.id);
  assert.ok(!ids.includes('2D') && !ids.includes('2S'));
});

test('passing: everyone picks 3 at once, cards go left on hand 1', () => {
  let g = hearts.createGame(makePlayers(4), { seed: 'pass' });
  assert.equal(g.phase, 'pass');
  assert.equal(g.passDir, 'left');
  // Everyone can act at the same time.
  for (const p of g.players) assert.equal(hearts.getLegalActions(g, p)[0].type, 'pass');
  expectError(hearts, g, 'p1', { type: 'pass', cards: g.hands.p1.slice(0, 2).map((c) => c.id) }, /exactly 3/);
  expectError(hearts, g, 'p1', { type: 'play', cards: [g.hands.p1[0].id] }, /Pass your cards first/);
  const picks = Object.fromEntries(g.players.map((p) => [p, g.hands[p].slice(0, 3).map((c) => c.id)]));
  g = act(hearts, g, 'p1', { type: 'pass', cards: picks.p1 });
  expectError(hearts, g, 'p1', { type: 'pass', cards: g.hands.p1.slice(0, 3).map((c) => c.id) }, /already passed/);
  assertNoLeaks(hearts, g);
  g = act(hearts, g, 'p2', { type: 'pass', cards: picks.p2 });
  g = act(hearts, g, 'p3', { type: 'pass', cards: picks.p3 });
  const res = actWithEvents(hearts, g, 'p4', { type: 'pass', cards: picks.p4 });
  g = res.state;
  assert.equal(g.phase, 'play');
  for (const id of picks.p1) assert.ok(g.hands.p2.some((c) => c.id === id), `p2 should have received ${id}`);
  for (const id of picks.p4) assert.ok(g.hands.p1.some((c) => c.id === id));
  const received = res.events.filter((e) => e.type === 'received');
  assert.equal(received.length, 4);
  assert.ok(received.every((e) => e.to), 'received-card messages are private');
  assert.ok(g.hands[g.players[g.turnIdx]].some((c) => c.id === '2C'), '2♣ holder leads');
});

test('play rules: 2♣ leads, follow suit, no points on trick 1, hearts must be broken', () => {
  let g = hearts.createGame(makePlayers(4), { seed: 'rules', passing: false });
  g.hands = { p1: cards('2C AH QS'), p2: cards('3C 4H 5D'), p3: cards('KD 6H 7S'), p4: cards('9C 8H 2S') };
  g.turnIdx = 0;
  expectError(hearts, g, 'p1', { type: 'play', cards: ['AH'] }, /2♣/);
  g = act(hearts, g, 'p1', { type: 'play', cards: ['2C'] });
  expectError(hearts, g, 'p2', { type: 'play', cards: ['4H'] }, /follow suit/);
  g = act(hearts, g, 'p2', { type: 'play', cards: ['3C'] });
  expectError(hearts, g, 'p3', { type: 'play', cards: ['6H'] }, /No points on the first trick/);
  g = act(hearts, g, 'p3', { type: 'play', cards: ['KD'] });
  g = act(hearts, g, 'p4', { type: 'play', cards: ['9C'] });
  assert.equal(g.lastTrickWinner, 'p4');
  g = advance(hearts, g);
  expectError(hearts, g, 'p4', { type: 'play', cards: ['8H'] }, /Hearts haven't been broken/);
  g = act(hearts, g, 'p4', { type: 'play', cards: ['2S'] });
  g = act(hearts, g, 'p1', { type: 'play', cards: ['QS'] });
  const res = actWithEvents(hearts, g, 'p2', { type: 'play', cards: ['4H'] });
  assert.ok(res.events.some((e) => e.type === 'broken'));
  g = act(hearts, res.state, 'p3', { type: 'play', cards: ['7S'] });
  assert.equal(g.lastTrickWinner, 'p1');
  assert.equal(g.roundPoints.p1, 14, 'Q♠ (13) + one heart');
  g = advance(hearts, g);
  for (const [p, c] of [['p1', 'AH'], ['p2', '5D'], ['p3', '6H'], ['p4', '8H']]) g = act(hearts, g, p, { type: 'play', cards: [c] });
  g = advance(hearts, g);
  assert.equal(g.scores.p1, 17);
  assert.equal(g.phase, 'roundEnd');
});

test('shooting the moon gives everyone else 26; lowest score wins', () => {
  let g = hearts.createGame(makePlayers(4), { seed: 'moon', passing: false, target: 50 });
  g.hands = { p1: cards('AH'), p2: cards('2C'), p3: cards('3C'), p4: cards('4C') };
  g.trickNo = 12;
  g.heartsBroken = true;
  g.roundPoints = { p1: 25, p2: 0, p3: 0, p4: 0 };
  g.scores = { p1: 10, p2: 30, p3: 5, p4: 0 };
  g.turnIdx = 0;
  for (const [p, c] of [['p1', 'AH'], ['p2', '2C'], ['p3', '3C'], ['p4', '4C']]) g = act(hearts, g, p, { type: 'play', cards: [c] });
  const res = actWithEvents(hearts, g, '__system__', g.autoAdvance.action);
  g = res.state;
  assert.ok(res.events.some((e) => e.type === 'moon'));
  assert.deepEqual(g.scores, { p1: 10, p2: 56, p3: 31, p4: 26 });
  assert.equal(g.phase, 'over');
  assert.deepEqual(hearts.getResults(g).winners, ['p1']);
});

test('point values', () => {
  assert.equal(hearts.points(cards('QS')[0]), 13);
  assert.equal(hearts.points(cards('7H')[0]), 1);
  assert.equal(hearts.points(cards('KS')[0]), 0);
});

test('no hidden information leaks', () => {
  assertNoLeaks(hearts, hearts.createGame(makePlayers(4), { seed: 'leak' }));
});

test('bots finish full games', () => {
  for (const n of [3, 4, 5]) {
    const { game, results } = simulate(hearts, hearts.createGame(makePlayers(n), { seed: `h${n}`, target: 50 }));
    const low = Math.min(...Object.values(game.scores));
    for (const w of results.winners) assert.equal(game.scores[w], low);
  }
});
