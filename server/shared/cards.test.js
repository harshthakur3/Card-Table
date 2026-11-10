import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RANKS,
  SUITS,
  cardLabel,
  createDeck,
  createRng,
  deal,
  rankValue,
  shuffle,
  sortHand,
  takeCards,
} from './cards.js';

test('standard deck has 52 unique cards', () => {
  const deck = createDeck();
  assert.equal(deck.length, 52);
  assert.equal(new Set(deck.map((c) => c.id)).size, 52);
  for (const s of SUITS) assert.equal(deck.filter((c) => c.suit === s).length, 13);
  for (const r of RANKS) assert.equal(deck.filter((c) => c.rank === r).length, 4);
});

test('jokers and multiple decks', () => {
  const withJokers = createDeck({ jokers: true });
  assert.equal(withJokers.length, 54);
  assert.deepEqual(
    withJokers.filter((c) => c.rank === 'JOKER').map((c) => c.color).sort(),
    ['black', 'red'],
  );
  const two = createDeck({ decks: 2, jokers: true });
  assert.equal(two.length, 108);
  assert.equal(new Set(two.map((c) => c.id)).size, 108, 'ids stay unique across decks');
  assert.ok(two.some((c) => c.id === 'AS.1'));
});

test('exclude removes specific cards', () => {
  const deck = createDeck({ exclude: ['2D', '2S'] });
  assert.equal(deck.length, 50);
  assert.ok(!deck.some((c) => c.id === '2D' || c.id === '2S'));
});

test('seeded shuffle is deterministic, complete and does not mutate', () => {
  const deck = createDeck();
  const copy = deck.slice();
  const a = shuffle(deck, 'seed-1');
  const b = shuffle(deck, 'seed-1');
  const c = shuffle(deck, 'seed-2');
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.deepEqual(deck, copy);
  assert.deepEqual(a.map((x) => x.id).sort(), deck.map((x) => x.id).sort());
});

test('shuffle is roughly uniform (first position)', () => {
  const rng = createRng('uniformity');
  const counts = new Map();
  const items = ['a', 'b', 'c', 'd'];
  for (let i = 0; i < 4000; i++) {
    const first = shuffle(items, rng)[0];
    counts.set(first, (counts.get(first) ?? 0) + 1);
  }
  for (const k of items) assert.ok(counts.get(k) > 850 && counts.get(k) < 1150, `${k}: ${counts.get(k)}`);
});

test('deal N cards round-robin and returns the rest', () => {
  const deck = createDeck();
  const { hands, rest } = deal(deck, 4, 5);
  assert.equal(hands.length, 4);
  hands.forEach((h) => assert.equal(h.length, 5));
  assert.equal(rest.length, 32);
  assert.equal(hands[0][0].id, deck[0].id);
  assert.equal(hands[1][0].id, deck[1].id);
  assert.equal(hands[0][1].id, deck[4].id);
});

test('deal whole deck unevenly', () => {
  const { hands, rest } = deal(createDeck(), 5);
  assert.deepEqual(hands.map((h) => h.length), [11, 11, 10, 10, 10]);
  assert.equal(rest.length, 0);
  assert.throws(() => deal(createDeck(), 4, 14));
});

test('rankValue with ace high/low', () => {
  assert.equal(rankValue('A'), 14);
  assert.equal(rankValue('A', { aceLow: true }), 1);
  assert.equal(rankValue('10'), 10);
  assert.ok(rankValue('K') > rankValue('Q'));
});

test('sortHand groups by suit then rank, trump last', () => {
  const hand = [
    { id: 'AH', rank: 'A', suit: 'H' },
    { id: '2S', rank: '2', suit: 'S' },
    { id: '10H', rank: '10', suit: 'H' },
    { id: 'KS', rank: 'K', suit: 'S' },
  ];
  assert.deepEqual(sortHand(hand).map((c) => c.id), ['2S', 'KS', '10H', 'AH']);
  assert.deepEqual(sortHand(hand, { trump: 'S' }).map((c) => c.id), ['10H', 'AH', '2S', 'KS']);
  assert.deepEqual(sortHand(hand, { by: 'rank' }).map((c) => c.id), ['2S', '10H', 'KS', 'AH']);
});

test('takeCards validates ids', () => {
  const hand = createDeck().slice(0, 5);
  const ok = takeCards(hand, [hand[1].id, hand[3].id]);
  assert.equal(ok.hand.length, 3);
  assert.equal(ok.taken.length, 2);
  assert.equal(takeCards(hand, ['nope']), null);
  assert.equal(takeCards(hand, [hand[0].id, hand[0].id]), null);
});

test('cardLabel', () => {
  assert.equal(cardLabel({ rank: '10', suit: 'H' }), '10♥');
  assert.equal(cardLabel({ rank: 'JOKER', suit: null }), 'Joker');
});
