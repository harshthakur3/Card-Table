// Shared deck utilities. Used by every game engine on the server and by the client UI.
// Cards are plain JSON objects so game state can be cloned and stored in Redis:
//   { id: 'AS', rank: 'A', suit: 'S' }          (second deck: id 'AS.1')
//   { id: 'JKR', rank: 'JOKER', suit: null, color: 'red' }

export const SUITS = ['S', 'H', 'D', 'C'];
export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
export const JOKER = 'JOKER';

export const SUIT_SYMBOLS = { S: '♠', H: '♥', D: '♦', C: '♣' };
export const SUIT_NAMES = { S: 'Spades', H: 'Hearts', D: 'Diamonds', C: 'Clubs' };

const RANK_NAMES = {
  2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six', 7: 'Seven', 8: 'Eight', 9: 'Nine', 10: 'Ten',
  J: 'Jack', Q: 'Queen', K: 'King', A: 'Ace', JOKER: 'Joker',
};
const RANK_PLURALS = {
  2: 'Twos', 3: 'Threes', 4: 'Fours', 5: 'Fives', 6: 'Sixes', 7: 'Sevens', 8: 'Eights', 9: 'Nines', 10: 'Tens',
  J: 'Jacks', Q: 'Queens', K: 'Kings', A: 'Aces', JOKER: 'Jokers',
};

/** "King" / "Kings" depending on count. */
export function rankName(rank, count = 1) {
  return count === 1 ? RANK_NAMES[rank] : RANK_PLURALS[rank];
}

export function isRedSuit(suit) {
  return suit === 'H' || suit === 'D';
}

export function makeCard(rank, suit, deck = 0) {
  return { id: `${rank}${suit}${deck ? `.${deck}` : ''}`, rank, suit };
}

export function makeJoker(color, deck = 0) {
  return { id: `JK${color === 'red' ? 'R' : 'B'}${deck ? `.${deck}` : ''}`, rank: JOKER, suit: null, color };
}

/**
 * Build an unshuffled deck.
 * @param {object} o
 * @param {number} [o.decks=1]     number of 52-card decks combined
 * @param {boolean|number} [o.jokers=false]  true = 2 jokers per deck, or a number per deck
 * @param {string[]} [o.exclude=[]] cards to leave out, as rank+suit (e.g. ['2D'])
 */
export function createDeck({ decks = 1, jokers = false, exclude = [] } = {}) {
  const jokersPerDeck = jokers === true ? 2 : Number(jokers) || 0;
  const cards = [];
  for (let d = 0; d < decks; d++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        if (exclude.includes(`${rank}${suit}`)) continue;
        cards.push(makeCard(rank, suit, d));
      }
    }
    for (let j = 0; j < jokersPerDeck; j++) {
      const color = j % 2 === 0 ? 'black' : 'red';
      const joker = makeJoker(color, d);
      if (j >= 2) joker.id += `-${j}`;
      cards.push(joker);
    }
  }
  return cards;
}

// ---------- Seeded randomness ----------

function hashSeed(seed) {
  const str = String(seed);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h1 ^ h2) >>> 0;
}

/** Deterministic PRNG (mulberry32) from any string/number seed. Returns () => [0, 1). */
export function createRng(seed) {
  let a = hashSeed(seed);
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomSeed() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/**
 * Fisher-Yates shuffle. Returns a new array; the input is not modified.
 * @param {Array} cards
 * @param {string|number|Function} [seed] seed value, or an rng function from createRng
 */
export function shuffle(cards, seed) {
  const rng = typeof seed === 'function' ? seed : createRng(seed ?? randomSeed());
  const out = cards.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Deal cards round-robin, one at a time, like a real dealer.
 * @param {Array} deck
 * @param {number} numPlayers
 * @param {number} [cardsEach] omit (or Infinity) to deal the whole deck
 * @returns {{hands: Array[], rest: Array}}
 */
export function deal(deck, numPlayers, cardsEach = Infinity) {
  if (!Number.isInteger(numPlayers) || numPlayers < 1) throw new Error('deal: numPlayers must be >= 1');
  const all = cardsEach === Infinity || cardsEach == null;
  if (!all && cardsEach * numPlayers > deck.length) {
    throw new Error(`deal: cannot deal ${cardsEach} cards to ${numPlayers} players from ${deck.length} cards`);
  }
  const total = all ? deck.length : cardsEach * numPlayers;
  const hands = Array.from({ length: numPlayers }, () => []);
  for (let i = 0; i < total; i++) hands[i % numPlayers].push(deck[i]);
  return { hands, rest: deck.slice(total) };
}

// ---------- Ranking & sorting ----------

/** 2..10 face value, J=11, Q=12, K=13, A=14 (or 1 when aceLow), Joker=15. */
export function rankValue(rank, { aceLow = false } = {}) {
  if (rank === JOKER) return 15;
  if (rank === 'A') return aceLow ? 1 : 14;
  if (rank === 'K') return 13;
  if (rank === 'Q') return 12;
  if (rank === 'J') return 11;
  return Number(rank);
}

/**
 * Sort a hand (returns a new array).
 * @param {Array} cards
 * @param {object} [o]
 * @param {string[]} [o.suitOrder] suit grouping order, default alternates colours ♠ ♥ ♣ ♦
 * @param {boolean} [o.aceLow]
 * @param {'suit'|'rank'} [o.by] group by suit (default) or by rank
 * @param {string|null} [o.trump] trump suit is moved to the right end
 */
export function sortHand(cards, { suitOrder = ['S', 'H', 'C', 'D'], aceLow = false, by = 'suit', trump = null } = {}) {
  const order = trump ? [...suitOrder.filter((s) => s !== trump), trump] : suitOrder;
  const suitIdx = (s) => (s == null ? 99 : order.indexOf(s));
  const rv = (c) => rankValue(c.rank, { aceLow });
  return cards.slice().sort((a, b) => {
    if (by === 'rank') return rv(a) - rv(b) || suitIdx(a.suit) - suitIdx(b.suit) || a.id.localeCompare(b.id);
    return suitIdx(a.suit) - suitIdx(b.suit) || rv(a) - rv(b) || a.id.localeCompare(b.id);
  });
}

/** Human readable label: "10♥", "Joker". */
export function cardLabel(card) {
  if (!card) return '';
  if (card.rank === JOKER) return 'Joker';
  return `${card.rank}${SUIT_SYMBOLS[card.suit] ?? ''}`;
}

export function cardsLabel(cards) {
  return cards.map(cardLabel).join(' ');
}

/**
 * Remove cards by id from a hand.
 * @returns {{hand: Array, taken: Array}|null} null if any id is missing or repeated
 */
export function takeCards(hand, ids) {
  if (!Array.isArray(ids)) return null;
  if (new Set(ids).size !== ids.length) return null;
  const taken = [];
  for (const id of ids) {
    const card = hand.find((c) => c.id === id);
    if (!card) return null;
    taken.push(card);
  }
  const idSet = new Set(ids);
  return { hand: hand.filter((c) => !idSet.has(c.id)), taken };
}

/** Group cards by rank: { K: [..], 7: [..] } */
export function groupByRank(cards) {
  const out = {};
  for (const c of cards) (out[c.rank] ||= []).push(c);
  return out;
}

export function groupBySuit(cards) {
  const out = {};
  for (const c of cards) (out[c.suit] ||= []).push(c);
  return out;
}
