import test from 'node:test';
import assert from 'node:assert/strict';
import * as bluff from './index.js';
import { act, actWithEvents, assertEngineShape, assertNoLeaks, cards, expectError, makePlayers, simulate } from '../_test/harness.js';

/** A small fixed game: p1 starts with an open claim. */
function setup(hands, options = {}) {
  const g = bluff.createGame(makePlayers(Object.keys(hands).length), { seed: 'fixed', ...options });
  g.hands = Object.fromEntries(Object.entries(hands).map(([id, str]) => [id, cards(str)]));
  g.turnIdx = 0;
  return g;
}

test('engine shape', () => assertEngineShape(bluff));

test('deals the whole deck', () => {
  const g = bluff.createGame(makePlayers(3), { seed: 's' });
  assert.deepEqual(Object.values(g.hands).map((h) => h.length).sort(), [17, 17, 18]);
  const g2 = bluff.createGame(makePlayers(8), { seed: 's', decks: 2 });
  assert.equal(Object.values(g2.hands).reduce((n, h) => n + h.length, 0), 104);
  assert.throws(() => bluff.createGame(makePlayers(2), {}));
});

test('out-of-turn and invalid plays are rejected', () => {
  const g = setup({ p1: 'AS AH 3C', p2: 'KS KH 4C', p3: '5S 5H 6C' });
  expectError(bluff, g, 'p2', { type: 'play', cards: ['KS'], rank: 'K' }, /P1's turn/);
  expectError(bluff, g, 'p1', { type: 'play', cards: ['KS'], rank: 'K' }, /don't have/);
  expectError(bluff, g, 'p1', { type: 'play', cards: [], rank: 'A' }, /at least one/);
  expectError(bluff, g, 'p1', { type: 'play', cards: ['AS'] }, /Choose which rank/);
  expectError(bluff, g, 'p1', { type: 'pass' }, /starting the round/);
  expectError(bluff, g, 'p2', { type: 'callBluff' }, /nothing to call/);
  expectError(bluff, g, 'p1', { type: 'dance' }, /Unknown action/);
});

test('cannot play more than 4 cards with one deck', () => {
  const g = setup({ p1: 'AS AH AD AC 2S', p2: 'KS', p3: '5S' });
  expectError(bluff, g, 'p1', { type: 'play', cards: ['AS', 'AH', 'AD', 'AC', '2S'], rank: 'A' }, /at most 4/);
});

test('playing moves cards to the pile and sets the claim for the round', () => {
  let g = setup({ p1: 'AS AH 3C', p2: 'KS KH 4C', p3: '5S 5H 6C' });
  g = act(bluff, g, 'p1', { type: 'play', cards: ['AS', '3C'], rank: 'A' });
  assert.equal(g.pile.length, 2);
  assert.equal(g.hands.p1.length, 1);
  assert.equal(g.claimRank, 'A');
  assert.equal(g.turnIdx, 1);
  // Followers must claim the same rank (their rank param is ignored).
  const play = bluff.getLegalActions(g, 'p2').find((a) => a.type === 'play');
  assert.equal(play.params, undefined);
  assert.match(play.label, /Aces/);
  g = act(bluff, g, 'p2', { type: 'play', cards: ['KS'], rank: 'K' });
  assert.equal(g.lastPlay.rank, 'A');
});

test('calling a bluff on a liar makes the liar pick up the pile', () => {
  let g = setup({ p1: 'AS AH 3C', p2: 'KS KH 4C', p3: '5S 5H 6C' });
  g = act(bluff, g, 'p1', { type: 'play', cards: ['AS'], rank: 'A' });
  g = act(bluff, g, 'p2', { type: 'play', cards: ['KS'] }); // claims an Ace: a lie
  const res = actWithEvents(bluff, g, 'p3', { type: 'callBluff' });
  g = res.state;
  assert.equal(g.hands.p2.length, 4, 'p2 had 2, picks up 2');
  assert.equal(g.pile.length, 0);
  assert.equal(g.reveal.truthful, false);
  assert.equal(g.players[g.turnIdx], 'p3', 'the caller leads next');
  assert.equal(g.claimRank, null);
  assert.ok(res.events.some((e) => e.toast && /P3 called bluff on P2/.test(e.text)));
});

test('calling a bluff on a truthful play makes the caller pick up', () => {
  let g = setup({ p1: 'AS AH 3C', p2: 'KS KH 4C', p3: '5S 5H 6C' });
  g = act(bluff, g, 'p1', { type: 'play', cards: ['AS', 'AH'], rank: 'A' });
  expectError(bluff, g, 'p1', { type: 'callBluff' }, /yourself/);
  g = act(bluff, g, 'p3', { type: 'callBluff' }); // p3 can call even when it is not their turn
  assert.equal(g.hands.p3.length, 5);
  assert.equal(g.reveal.truthful, true);
  assert.equal(g.players[g.turnIdx], 'p1', 'the truthful player leads next');
});

test('when everyone passes the pile is set aside and the last player leads', () => {
  let g = setup({ p1: 'AS AH 3C', p2: 'KS KH 4C', p3: '5S 5H 6C' });
  g = act(bluff, g, 'p1', { type: 'play', cards: ['AS'], rank: 'A' });
  g = act(bluff, g, 'p2', { type: 'pass' });
  assert.equal(g.players[g.turnIdx], 'p3');
  g = act(bluff, g, 'p3', { type: 'pass' });
  assert.equal(g.pile.length, 0);
  assert.equal(g.setAside, 1);
  assert.equal(g.claimRank, null);
  assert.equal(g.players[g.turnIdx], 'p1');
});

test('pile stays when discardOnPass is off', () => {
  let g = setup({ p1: 'AS AH 3C', p2: 'KS KH 4C', p3: '5S 5H 6C' }, { discardOnPass: false });
  g = act(bluff, g, 'p1', { type: 'play', cards: ['AS'], rank: 'A' });
  g = act(bluff, g, 'p2', { type: 'pass' });
  g = act(bluff, g, 'p3', { type: 'pass' });
  assert.equal(g.pile.length, 1);
  assert.equal(g.setAside, 0);
});

test('a last play that goes unchallenged wins when the next player acts', () => {
  let g = setup({ p1: 'AS', p2: 'KS KH', p3: '5S 5H' });
  g = act(bluff, g, 'p1', { type: 'play', cards: ['AS'], rank: 'A' });
  assert.equal(bluff.isGameOver(g), false, 'others may still call bluff');
  g = act(bluff, g, 'p2', { type: 'pass' });
  assert.equal(bluff.isGameOver(g), true);
  const r = bluff.getResults(g);
  assert.deepEqual(r.winners, ['p1']);
  assert.equal(r.rankings[0].playerId, 'p1');
});

test('a truthful last play that is challenged wins immediately; a lie does not', () => {
  let g = setup({ p1: 'AS', p2: 'KS KH', p3: '5S 5H' });
  g = act(bluff, g, 'p1', { type: 'play', cards: ['AS'], rank: 'A' });
  g = act(bluff, g, 'p3', { type: 'callBluff' });
  assert.equal(bluff.isGameOver(g), true);
  assert.equal(g.winner, 'p1');

  let h = setup({ p1: '2S', p2: 'KS KH', p3: '5S 5H' });
  h = act(bluff, h, 'p1', { type: 'play', cards: ['2S'], rank: 'A' });
  h = act(bluff, h, 'p2', { type: 'callBluff' });
  assert.equal(bluff.isGameOver(h), false);
  assert.equal(h.hands.p1.length, 1);
  assert.equal(h.players[h.turnIdx], 'p2');
});

test('sequence mode: ranks go A, 2, 3 and passing is not allowed', () => {
  let g = setup({ p1: 'AS 9C', p2: '2S 9D', p3: '5S 9H' }, { claimMode: 'sequence' });
  assert.equal(bluff.getPublicState(g).requiredRank, 'A');
  g = act(bluff, g, 'p1', { type: 'play', cards: ['AS'] });
  assert.equal(bluff.getPublicState(g).requiredRank, '2');
  expectError(bluff, g, 'p2', { type: 'pass' }, /not allowed/);
  g = act(bluff, g, 'p2', { type: 'play', cards: ['2S'] });
  assert.equal(g.lastPlay.rank, '2');
  assert.equal(bluff.getPublicState(g).requiredRank, '3');
});

test('views never reveal other hands or the face-down pile', () => {
  let g = setup({ p1: 'AS AH 3C', p2: 'KS KH 4C', p3: '5S 5H 6C' });
  g = act(bluff, g, 'p1', { type: 'play', cards: ['AS', '3C'], rank: 'A' });
  assertNoLeaks(bluff, g);
  const view = JSON.stringify(bluff.getPlayerView(g, 'p2'));
  assert.ok(!view.includes('"id":"AS"') && !view.includes('"id":"3C"'), 'pile cards hidden');
  const own = bluff.getPlayerView(g, 'p1');
  assert.deepEqual(own.hand.map((c) => c.id), ['AH']);
  assert.equal(own.players.find((p) => p.id === 'p2').cardCount, 3);
});

test('bots can finish whole games in both modes', () => {
  for (const claimMode of ['free', 'sequence']) {
    for (const n of [3, 5, 8]) {
      const g = bluff.createGame(makePlayers(n), { seed: `sim-${claimMode}-${n}`, claimMode, decks: n > 5 ? 2 : 1 });
      const { results } = simulate(bluff, g);
      assert.equal(results.winners.length, 1);
    }
  }
});
