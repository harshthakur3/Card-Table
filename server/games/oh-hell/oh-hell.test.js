import test from 'node:test';
import assert from 'node:assert/strict';
import * as ohHell from './index.js';
import { buildSchedule } from '../../shared/predictionGame.js';
import { act, actWithEvents, advance, assertEngineShape, assertNoLeaks, cards, expectError, makePlayers, simulate } from '../_test/harness.js';

/** 3 players, round with 2 cards: p1 = dealer, p2 leads/bids first. */
function setup({ hands, trump = 'S', options = {} }) {
  const g = ohHell.createGame(makePlayers(3), { seed: 'fixed', maxCards: 3, ...options });
  g.schedule = [2, 3, 2, 1];
  g.roundIdx = 0;
  g.hands = Object.fromEntries(Object.entries(hands).map(([id, s]) => [id, cards(s)]));
  g.trump = trump;
  g.trumpCard = { id: `9${trump}`, rank: '9', suit: trump };
  return g;
}

test('engine shape', () => assertEngineShape(ohHell));

test('round sequence goes up then down and is clamped to the deck', () => {
  assert.deepEqual(buildSchedule('up-down', 3), [1, 2, 3, 2, 1]);
  assert.deepEqual(buildSchedule('down-up', 3), [3, 2, 1, 2, 3]);
  const g = ohHell.createGame(makePlayers(7), { seed: 'x', maxCards: 13 });
  assert.equal(g.options.maxCards, 7, '7 players × 7 cards + 1 trump card = 50');
  assert.equal(g.schedule.length, 13);
});

test('first round deals 1 card each and turns up a trump card', () => {
  const g = ohHell.createGame(makePlayers(4), { seed: 'deal' });
  for (const id of g.players) assert.equal(g.hands[id].length, 1);
  assert.ok(g.trumpCard);
  assert.equal(g.trump, g.trumpCard.suit);
  assert.equal(g.stock.length, 52 - 4 - 1);
  assert.equal(g.players[g.turnIdx], 'p2', 'player left of the dealer bids first');
  assertNoLeaks(ohHell, g);
});

test('bidding goes in turn and the hook rule binds the dealer', () => {
  let g = setup({ hands: { p1: 'AS 2H', p2: 'KH 3C', p3: 'QD 4C' } });
  expectError(ohHell, g, 'p3', { type: 'bid', bid: 1 }, /P2's turn to bid/);
  expectError(ohHell, g, 'p2', { type: 'bid', bid: 3 }, /0 to 2/);
  g = act(ohHell, g, 'p2', { type: 'bid', bid: 1 });
  g = act(ohHell, g, 'p3', { type: 'bid', bid: 0 });
  // Dealer p1 bids last: 1 + 0 + 1 = 2 tricks is forbidden.
  const bidAction = ohHell.getLegalActions(g, 'p1')[0];
  assert.deepEqual(bidAction.params[0].disallowed, [1]);
  expectError(ohHell, g, 'p1', { type: 'bid', bid: 1 }, /hook rule/);
  g = act(ohHell, g, 'p1', { type: 'bid', bid: 2 });
  assert.equal(g.phase, 'play');
  assert.equal(g.players[g.turnIdx], 'p2');
});

test('hook rule can be switched off', () => {
  let g = setup({ hands: { p1: 'AS 2H', p2: 'KH 3C', p3: 'QD 4C' }, options: { hook: false } });
  g = act(ohHell, g, 'p2', { type: 'bid', bid: 1 });
  g = act(ohHell, g, 'p3', { type: 'bid', bid: 0 });
  g = act(ohHell, g, 'p1', { type: 'bid', bid: 1 });
  assert.equal(g.phase, 'play');
});

function biddedGame(options) {
  let g = setup({ hands: { p1: 'AS 2H', p2: 'KH 3C', p3: 'QH 4C' }, options });
  g = act(ohHell, g, 'p2', { type: 'bid', bid: 1 });
  g = act(ohHell, g, 'p3', { type: 'bid', bid: 0 });
  g = act(ohHell, g, 'p1', { type: 'bid', bid: 0 });
  return g;
}

test('players must follow suit; trumps win; winner leads the next trick', () => {
  let g = biddedGame();
  expectError(ohHell, g, 'p1', { type: 'play', cards: ['AS'] }, /P2's turn/);
  g = act(ohHell, g, 'p2', { type: 'play', cards: ['KH'] });
  expectError(ohHell, g, 'p3', { type: 'play', cards: ['4C'] }, /follow suit/);
  g = act(ohHell, g, 'p3', { type: 'play', cards: ['QH'] });
  // p1 has 2H (must follow hearts).
  expectError(ohHell, g, 'p1', { type: 'play', cards: ['AS'] }, /follow suit/);
  g = act(ohHell, g, 'p1', { type: 'play', cards: ['2H'] });
  assert.equal(g.phase, 'trickEnd');
  assert.equal(g.tricks.p2, 1, 'K♥ beats Q♥ and 2♥');
  expectError(ohHell, g, 'p2', { type: 'collect' }, /automatically/);
  g = advance(ohHell, g);
  assert.equal(g.phase, 'play');
  assert.equal(g.players[g.turnIdx], 'p2');
  // Second trick: p2 leads 3C, p3 follows 4C, p1 has no clubs and trumps with AS.
  g = act(ohHell, g, 'p2', { type: 'play', cards: ['3C'] });
  g = act(ohHell, g, 'p3', { type: 'play', cards: ['4C'] });
  g = act(ohHell, g, 'p1', { type: 'play', cards: ['AS'] });
  assert.equal(g.tricks.p1, 1, 'trump wins');
  return g;
});

test('scoring: exact bids score 10 + bid, misses score 0 (classic)', () => {
  let g = biddedGame();
  for (const [p, c] of [['p2', 'KH'], ['p3', 'QH'], ['p1', '2H']]) g = act(ohHell, g, p, { type: 'play', cards: [c] });
  g = advance(ohHell, g);
  for (const [p, c] of [['p2', '3C'], ['p3', '4C'], ['p1', 'AS']]) g = act(ohHell, g, p, { type: 'play', cards: [c] });
  const res = actWithEvents(ohHell, g, '__system__', g.autoAdvance.action);
  g = res.state;
  assert.equal(g.phase, 'roundEnd');
  // p2 bid 1 won 1 => 11; p3 bid 0 won 0 => 10; p1 bid 0 won 1 => 0
  assert.deepEqual(g.scores, { p1: 0, p2: 11, p3: 10 });
  assert.ok(res.events.some((e) => e.type === 'hit' && /P2 made their bid of 1/.test(e.text)));
  // Next round: dealer rotates and hand size follows the schedule.
  g = advance(ohHell, g);
  assert.equal(g.roundIdx, 1);
  assert.equal(g.players[g.dealerIdx], 'p2');
  for (const id of g.players) assert.equal(g.hands[id].length, 3);
  assert.equal(g.history.length, 1);
});

test('alternative scoring modes', () => {
  for (const [scoring, expected] of [
    ['tricks', { p1: 1, p2: 11, p3: 10 }],
    ['penalty', { p1: -1, p2: 11, p3: 10 }],
  ]) {
    let g = biddedGame({ scoring });
    for (const [p, c] of [['p2', 'KH'], ['p3', 'QH'], ['p1', '2H']]) g = act(ohHell, g, p, { type: 'play', cards: [c] });
    g = advance(ohHell, g);
    for (const [p, c] of [['p2', '3C'], ['p3', '4C'], ['p1', 'AS']]) g = act(ohHell, g, p, { type: 'play', cards: [c] });
    g = advance(ohHell, g);
    assert.deepEqual(g.scores, expected, scoring);
  }
});

test('views hide other hands and the undealt cards', () => {
  const g = ohHell.createGame(makePlayers(5), { seed: 'leaks', maxCards: 5 });
  assertNoLeaks(ohHell, g);
  const v = ohHell.getPlayerView(g, 'p3');
  assert.equal(v.hand.length, 1);
  assert.ok(v.scoreboard.columns.length >= 4);
});

test('the game ends after the last round with a winner', () => {
  for (const n of [3, 4, 7]) {
    const g = ohHell.createGame(makePlayers(n), { seed: `sim${n}`, maxCards: 5 });
    const { game, results } = simulate(ohHell, g);
    assert.equal(game.history.length, game.schedule.length);
    const top = Math.max(...Object.values(game.scores));
    for (const w of results.winners) assert.equal(game.scores[w], top);
  }
});
