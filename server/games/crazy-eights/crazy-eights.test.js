import test from 'node:test';
import assert from 'node:assert/strict';
import * as c8 from './index.js';
import { act, actWithEvents, assertEngineShape, assertNoLeaks, cards, expectError, makePlayers, simulate } from '../_test/harness.js';

test('engine shape', () => assertEngineShape(c8));

test('deal: 7 cards for 2 players, 5 otherwise; the starter is never an 8', () => {
  assert.equal(c8.createGame(makePlayers(2), { seed: 'd' }).hands.p1.length, 7);
  assert.equal(c8.createGame(makePlayers(4), { seed: 'd' }).hands.p1.length, 5);
  for (let i = 0; i < 40; i++) {
    const g = c8.createGame(makePlayers(3), { seed: `starter${i}` });
    assert.notEqual(g.discard[0].rank, '8');
    assert.equal(g.activeSuit, g.discard[0].suit);
    assert.equal(Object.values(g.hands).flat().length + g.stock.length + g.discard.length, 52);
  }
});

function setup() {
  const g = c8.createGame(makePlayers(3), { seed: 'c8' });
  g.hands = { p1: cards('5H 8S KC'), p2: cards('2D 3D'), p3: cards('4C 9C') };
  g.discard = cards('7H');
  g.activeSuit = 'H';
  g.stock = cards('JD QD 2S 3S');
  g.turnIdx = 0;
  return g;
}

test('match the suit or rank, or play an 8 and call a suit', () => {
  let g = setup();
  expectError(c8, g, 'p1', { type: 'play', cards: ['KC'] }, /doesn't match/);
  expectError(c8, g, 'p1', { type: 'playEight', cards: ['8S'] }, /Choose the suit/);
  expectError(c8, g, 'p1', { type: 'play', cards: ['AS'] }, /don't have/);
  expectError(c8, g, 'p2', { type: 'play', cards: ['2D'] }, /P1's turn/);
  expectError(c8, g, 'p1', { type: 'pass' }, /Draw a card first|card you can play/);
  g = act(c8, g, 'p1', { type: 'play', cards: ['5H'] });
  assert.equal(g.players[g.turnIdx], 'p2');
  // p2 can't play: draw (limit 1), then pass.
  expectError(c8, g, 'p2', { type: 'pass' }, /Draw a card first/);
  const res = actWithEvents(c8, g, 'p2', { type: 'draw' });
  g = res.state;
  assert.equal(res.events.find((e) => e.type === 'drew').to, 'p2');
  expectError(c8, g, 'p2', { type: 'draw' }, /drawn as many/);
  g = act(c8, g, 'p2', { type: 'pass' });
  g = act(c8, g, 'p3', { type: 'draw' });
  g = act(c8, g, 'p3', { type: 'pass' });
  g = act(c8, g, 'p1', { type: 'playEight', cards: ['8S'], suit: 'D' });
  assert.equal(g.activeSuit, 'D');
  g = act(c8, g, 'p2', { type: 'play', cards: ['2D'] });
  assert.equal(g.activeSuit, 'D');
});

test('going out scores the cards left in other hands (8s are 50)', () => {
  let g = setup();
  g.hands = { p1: cards('9H'), p2: cards('8C KD'), p3: cards('AS 3C') };
  g.discard = cards('9S');
  g.activeSuit = 'S';
  const res = actWithEvents(c8, g, 'p1', { type: 'play', cards: ['9H'] });
  g = res.state;
  assert.equal(g.scores.p1, 50 + 10 + 1 + 3);
  assert.equal(g.phase, 'over');
  assert.deepEqual(c8.getResults(g).winners, ['p1']);
});

test('draw until you can play (option)', () => {
  let g = setup();
  g.options.drawLimit = 99;
  g.turnIdx = 1; // p2 holds 2D 3D; 7♥ on top
  g.stock = cards('JC 4S 7D 2S');
  g = act(c8, g, 'p2', { type: 'draw' });
  g = act(c8, g, 'p2', { type: 'draw' });
  g = act(c8, g, 'p2', { type: 'draw' }); // the 7♦ matches the 7♥
  expectError(c8, g, 'p2', { type: 'draw' }, /drawn as many/);
  g = act(c8, g, 'p2', { type: 'play', cards: ['7D'] });
  assert.equal(g.activeSuit, 'D');
});

test('a fully blocked hand goes to the lowest hand', () => {
  let g = setup();
  g.hands = { p1: cards('KC'), p2: cards('2D 3D'), p3: cards('4C 9C') };
  g.stock = [];
  for (const p of ['p1', 'p2', 'p3']) g = act(c8, g, p, { type: 'pass' });
  assert.equal(g.phase, 'over');
  assert.equal(g.lastWinner, 'p2', '2+3 = 5 is the lowest hand');
  assert.equal(g.scores.p2, 10 + 13);
});

test('no hidden information leaks', () => {
  assertNoLeaks(c8, c8.createGame(makePlayers(5), { seed: 'leak' }));
});

test('bots finish full games', () => {
  for (const n of [2, 4, 7]) {
    const { results } = simulate(c8, c8.createGame(makePlayers(n), { seed: `c8${n}`, target: 100 }));
    assert.ok(results.winners.length >= 1);
  }
});
