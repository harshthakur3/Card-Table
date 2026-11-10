import test from 'node:test';
import assert from 'node:assert/strict';
import * as war from './index.js';
import { act, actWithEvents, advance, assertEngineShape, cards, expectError, makePlayers, simulate } from '../_test/harness.js';

/** Face-down deck cards must never appear in anyone's view (cards shown in the last battle were flipped face up). */
function assertPilesHidden(g) {
  const shown = new Set((g.lastBattle?.plays ?? []).map((p) => p.card.id));
  for (const id of Object.values(g.flips ?? {})) shown.add(id.id);
  for (const viewer of g.players) {
    const json = JSON.stringify(war.getPlayerView(g, viewer)) + JSON.stringify(war.getLegalActions(g, viewer));
    for (const owner of g.players) {
      for (const c of g.piles[owner]) {
        if (shown.has(c.id)) continue;
        assert.ok(!json.includes(`"id":"${c.id}"`), `${viewer} can see face-down card ${c.id} in ${owner}'s deck`);
      }
    }
  }
}

test('engine shape', () => assertEngineShape(war));

test('deal: the whole deck split evenly (3 players drop the 2♣)', () => {
  const g2 = war.createGame(makePlayers(2), { seed: 'd' });
  assert.deepEqual(Object.values(g2.piles).map((p) => p.length), [26, 26]);
  const g3 = war.createGame(makePlayers(3), { seed: 'd' });
  assert.deepEqual(Object.values(g3.piles).map((p) => p.length), [17, 17, 17]);
  assert.ok(!Object.values(g3.piles).flat().some((c) => c.id === '2C'));
  const g4 = war.createGame(makePlayers(4), { seed: 'd' });
  assert.deepEqual(Object.values(g4.piles).map((p) => p.length), [13, 13, 13, 13]);
});

test('a battle: highest card takes both', () => {
  let g = war.createGame(makePlayers(2), { seed: 'b' });
  g.piles = { p1: cards('KS 2D'), p2: cards('5H 3C') };
  g = act(war, g, 'p1', { type: 'flip' });
  expectError(war, g, 'p1', { type: 'flip' }, /already flipped/);
  const res = actWithEvents(war, g, 'p2', { type: 'flip' });
  g = res.state;
  assert.equal(g.piles.p1.length, 3);
  assert.deepEqual(g.piles.p2.map((c) => c.id), ['3C']);
  assert.equal(g.lastBattle.winnerId, 'p1');
  assert.equal(g.battles, 1);
});

test('a tie means war: face-down cards, then flip again', () => {
  let g = war.createGame(makePlayers(2), { seed: 'w', warCards: 3 });
  g.piles = { p1: cards('KS 2D 3D 4D 5D 9C'), p2: cards('KH 2C 3C 4C 6C 10C') };
  g = act(war, g, 'p1', { type: 'flip' });
  const res = actWithEvents(war, g, 'p2', { type: 'flip' });
  g = res.state;
  assert.ok(res.events.some((e) => e.type === 'war'));
  assert.equal(g.atWar, true);
  assert.equal(g.pot.length, 8, 'two kings + three face-down cards each');
  g = act(war, g, 'p1', { type: 'flip' });
  g = act(war, g, 'p2', { type: 'flip' });
  assert.equal(g.atWar, false);
  assert.equal(g.piles.p2.length, 11);
  assert.deepEqual(g.piles.p1.map((c) => c.id), ['9C']);
});

test('only tied players flip in a war', () => {
  let g = war.createGame(makePlayers(3), { seed: 'w3', warCards: 1 });
  g.piles = { p1: cards('KS 2D 9D 4H'), p2: cards('KH 2C 8C 4S'), p3: cards('5D 6D 7D 8H') };
  for (const p of ['p1', 'p2', 'p3']) g = act(war, g, p, { type: 'flip' });
  assert.deepEqual(g.contenders, ['p1', 'p2']);
  expectError(war, g, 'p3', { type: 'flip' }, /not in this war/);
  assert.equal(war.getLegalActions(g, 'p3').length, 0);
  g = act(war, g, 'p1', { type: 'flip' });
  g = act(war, g, 'p2', { type: 'flip' });
  // p1's 9♦ beats p2's 8♣: KS KH 5D + 2D 2C + 9D 8C = 7 cards
  assert.equal(g.lastBattle.winnerId, 'p1');
  assert.equal(g.piles.p1.length, 1 + 7);
  assert.deepEqual(g.contenders, ['p1', 'p2', 'p3']);
});

test('auto-flip runs battles as system moves', () => {
  let g = war.createGame(makePlayers(2), { seed: 'auto', autoFlip: true });
  assert.ok(g.autoAdvance);
  g = advance(war, g);
  assert.equal(g.battles, 1);
  assert.ok(g.autoAdvance, 'keeps flipping');
});

test('battle limit: most cards wins', () => {
  const { game, results } = simulate(war, war.createGame(makePlayers(3), { seed: 'limit', maxBattles: 50 }), { leakCheck: assertPilesHidden });
  assert.ok(game.battles <= 50);
  const most = Math.max(...game.players.map((id) => game.piles[id].length));
  for (const w of results.winners) assert.equal(game.piles[w].length, most);
});

test('cards are conserved and decks stay hidden', () => {
  simulate(war, war.createGame(makePlayers(4), { seed: 'cons' }), {
    leakCheck: assertPilesHidden,
    leakEvery: 3,
    onStep: (g) => {
      const total = Object.values(g.piles).flat().length + g.pot.length + Object.keys(g.flips).length;
      assert.equal(total, 52);
    },
  });
});

test('the view shows no hand, only a deck count', () => {
  const g = war.createGame(makePlayers(2), { seed: 'v' });
  const v = war.getPlayerView(g, 'p1');
  assert.deepEqual(v.hand, []);
  assert.match(v.handNote, /26/);
});

test('bots finish full games', () => {
  for (const n of [2, 3, 4]) {
    const { results } = simulate(war, war.createGame(makePlayers(n), { seed: `war${n}`, maxBattles: 0 }), { leakCheck: assertPilesHidden, maxSteps: 30000 });
    assert.ok(results.winners.length >= 1);
  }
});
