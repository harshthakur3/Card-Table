import test from 'node:test';
import assert from 'node:assert/strict';
import * as tp from './index.js';
import { act, actWithEvents, advance, assertEngineShape, assertNoLeaks, cards, expectError, makePlayers, simulate } from '../_test/harness.js';

/** Hidden cards only matter while a hand is being bet; after a show the shown hands are public. */
const leakCheck = (g) => {
  if (g.phase !== 'bet') return;
  assertNoLeaks(tp, g);
  for (const id of g.players) {
    if (g.seen[id] || !g.inHand.includes(id)) continue;
    const json = JSON.stringify(tp.getPlayerView(g, id));
    for (const c of g.hands[id]) assert.ok(!json.includes(`"id":"${c.id}"`), `blind player ${id} can see their own ${c.id}`);
  }
};

test('engine shape', () => assertEngineShape(tp));

test('hand ranking: trail > pure sequence > sequence > colour > pair > high card', () => {
  const order = ['7S 7H 7D', '4H 5H 6H', '4H 5S 6H', '2C 9C KC', 'QS QD 3C', 'AS JD 9C'];
  for (let i = 0; i < order.length - 1; i++) {
    assert.ok(tp.compareHands(cards(order[i]), cards(order[i + 1])) > 0, `${order[i]} beats ${order[i + 1]}`);
  }
  assert.ok(tp.compareHands(cards('AS AH AD'), cards('KS KH KD')) > 0, 'trail of aces is the top hand');
  assert.ok(tp.compareHands(cards('AS KS QS'), cards('AH 2H 3H')) > 0, 'A-K-Q is the top run');
  assert.ok(tp.compareHands(cards('AH 2H 3H'), cards('KD QD JD')) > 0, 'A-2-3 is second');
  assert.ok(tp.compareHands(cards('QS QD AC'), cards('QH QC KC')) > 0, 'pair: kicker decides');
  assert.equal(tp.compareHands(cards('AS KH 9D'), cards('AH KD 9C')), 0);
  assert.deepEqual(tp.evaluate(cards('2S 3H 4D'))[0], 4);
});

test('setup: everyone antes the boot and starts blind', () => {
  const g = tp.createGame(makePlayers(3), { seed: 't', boot: 10, startChips: 1000 });
  assert.equal(g.pot, 30);
  assert.equal(g.stake, 10);
  assert.deepEqual(g.chips, { p1: 990, p2: 990, p3: 990 });
  assert.equal(g.players[g.turnIdx], 'p2', 'player after the dealer bets first');
  const v = tp.getPlayerView(g, 'p2');
  assert.equal(v.hand.length, 3);
  assert.ok(v.hand.every((c) => c.faceDown));
  leakCheck(g);
});

test('blind pays the stake, seen pays double, a raise doubles the stake', () => {
  let g = tp.createGame(makePlayers(3), { seed: 'bets', boot: 10, startChips: 1000 });
  g = act(tp, g, 'p2', { type: 'bet', amount: 'call' });
  assert.equal(g.chips.p2, 980);
  // Seeing is allowed any time, even out of turn, and only you learn your cards.
  const res = actWithEvents(tp, g, 'p1', { type: 'see' });
  g = res.state;
  assert.equal(res.events.find((e) => e.type === 'seen').to, 'p1');
  expectError(tp, g, 'p1', { type: 'see' }, /already seen/);
  expectError(tp, g, 'p1', { type: 'bet', amount: 'call' }, /P3's turn/);
  g = act(tp, g, 'p3', { type: 'bet', amount: 'raise' }); // blind raise: 20, stake → 20
  assert.equal(g.stake, 20);
  assert.equal(g.chips.p3, 970);
  g = act(tp, g, 'p1', { type: 'bet', amount: 'call' }); // seen: 2 × 20
  assert.equal(g.chips.p1, 950);
  assert.equal(g.pot, 30 + 10 + 20 + 40);
  expectError(tp, g, 'p2', { type: 'bet', amount: 'lots' }, /how much/);
  expectError(tp, g, 'p2', { type: 'show' }, /two players/);
});

test('when everyone else packs, the last player takes the pot without showing', () => {
  let g = tp.createGame(makePlayers(3), { seed: 'pack' });
  g = act(tp, g, 'p2', { type: 'pack' });
  expectError(tp, g, 'p2', { type: 'bet', amount: 'call' }, /already packed/);
  const res = actWithEvents(tp, g, 'p3', { type: 'pack' });
  g = res.state;
  assert.equal(g.phase, 'handEnd');
  assert.deepEqual(g.lastResult.winners, ['p1']);
  assert.deepEqual(g.lastResult.revealed, {});
  assert.equal(g.chips.p1, 990 + 30);
  g = advance(tp, g);
  assert.equal(g.phase, 'bet');
  assert.equal(g.handIdx, 1);
  assert.equal(g.players[g.turnIdx], 'p3', 'the deal moves round');
});

test('show: better hand wins; on a tie the player who asked loses', () => {
  const base = () => {
    let g = tp.createGame(makePlayers(3), { seed: 'show' });
    g = act(tp, g, 'p2', { type: 'bet', amount: 'call' });
    g = act(tp, g, 'p3', { type: 'bet', amount: 'call' });
    g = act(tp, g, 'p1', { type: 'pack' });
    return g;
  };
  let g = base();
  assert.ok(tp.getLegalActions(g, 'p2').some((a) => a.type === 'show'));
  g.hands.p2 = cards('AS AH AD');
  g.hands.p3 = cards('KS QS JS');
  let res = actWithEvents(tp, g, 'p2', { type: 'show' });
  assert.deepEqual(res.state.lastResult.winners, ['p2']);
  assert.deepEqual(Object.keys(res.state.lastResult.revealed).sort(), ['p2', 'p3']);
  assert.ok(tp.getPlayerView(res.state, 'p1').players.find((p) => p.id === 'p3').faceUp, 'shown hands are shown to everyone');

  g = base();
  g.hands.p2 = cards('AS KH 9D');
  g.hands.p3 = cards('AH KD 9C');
  res = actWithEvents(tp, g, 'p2', { type: 'show' });
  assert.deepEqual(res.state.lastResult.winners, ['p3']);
});

test('reaching the pot limit forces a show', () => {
  let g = tp.createGame(makePlayers(3), { seed: 'limit', potLimit: 64 });
  g.options.potLimit = 50;
  g.hands = { p1: cards('2S 7D 9C'), p2: cards('KS KH 3C'), p3: cards('4H 5H 6H') };
  g = act(tp, g, 'p2', { type: 'bet', amount: 'call' }); // pot 40
  const res = actWithEvents(tp, g, 'p3', { type: 'bet', amount: 'call' }); // pot 50
  g = res.state;
  assert.ok(res.events.some((e) => e.type === 'limit'));
  assert.deepEqual(g.lastResult.winners, ['p3']);
});

test('chips are conserved, broke players sit out, the game ends after the set number of hands', () => {
  const start = 500;
  const { game, results } = simulate(tp, tp.createGame(makePlayers(5), { seed: 'cons', startChips: start, hands: 20, boot: 50 }), {
    leakCheck,
    leakEvery: 1,
    onStep: (g) => {
      const total = Object.values(g.chips).reduce((a, b) => a + b, 0) + g.pot;
      assert.equal(total, start * 5);
      for (const id of g.players) assert.ok(g.chips[id] >= 0);
    },
  });
  assert.ok(game.handIdx <= 20);
  const top = Math.max(...Object.values(game.chips));
  for (const w of results.winners) assert.equal(game.chips[w], top);
});

test('bots finish full games', () => {
  for (const n of [3, 4, 6]) {
    for (const seed of ['a', 'b', 'c']) {
      const { results } = simulate(tp, tp.createGame(makePlayers(n), { seed: `tp${n}${seed}` }), { leakCheck });
      assert.ok(results.winners.length >= 1);
    }
  }
});
