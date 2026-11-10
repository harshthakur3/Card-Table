// Go Fish — ask other players for ranks and collect books of four.
import { RANKS, cardLabel, createDeck, deal, rankName, shuffle, sortHand } from '../../shared/cards.js';
import { clone, fail, nameOf, namesMap, nextSeat, ok, rankPlayers } from '../../shared/engine.js';

export const meta = {
  id: 'go-fish',
  name: 'Go Fish',
  order: 4,
  minPlayers: 2,
  maxPlayers: 6,
  tagline: 'Got any sevens?',
  description: 'Ask another player for a rank you hold. If they have it, they hand it over; if not — go fish! Collect the most books of four.',
  options: [
    {
      key: 'dealSize',
      label: 'Cards dealt',
      type: 'select',
      default: 'auto',
      choices: [
        { value: 'auto', label: 'Standard (7 for 2–3 players, 5 for 4+)' },
        { value: 5, label: '5 cards' },
        { value: 7, label: '7 cards' },
      ],
    },
    {
      key: 'luckyCatch',
      label: 'Go again when you fish the rank you asked for',
      type: 'boolean',
      default: true,
    },
  ],
};

const TOTAL_BOOKS = 13;
const current = (g) => g.players[g.turnIdx];

/** Pull complete books of four out of a hand. */
function collectBooks(g, playerId, events) {
  const counts = {};
  for (const c of g.hands[playerId]) counts[c.rank] = (counts[c.rank] ?? 0) + 1;
  for (const [rank, n] of Object.entries(counts)) {
    if (n < 4) continue;
    const book = g.hands[playerId].filter((c) => c.rank === rank);
    g.hands[playerId] = g.hands[playerId].filter((c) => c.rank !== rank);
    g.books[playerId].push({ rank, cards: book });
    events.push({ type: 'book', toast: true, tone: 'good', text: `${nameOf(g, playerId)} completed a book of ${rankName(rank, 2)}!`, playerId });
  }
}

const totalBooks = (g) => g.players.reduce((s, id) => s + g.books[id].length, 0);

function drawFor(g, playerId, events, reason) {
  const card = g.stock.shift();
  g.hands[playerId].push(card);
  events.push({ type: 'draw', text: `${nameOf(g, playerId)} ${reason}`, playerId, anim: { kind: 'toSeat', playerId, count: 1 } });
  events.push({ type: 'drew', to: playerId, text: `You drew ${cardLabel(card)}` });
  return card;
}

/** Make sure the current player can act: refill an empty hand from the stock or skip them. */
function settleTurn(g, events) {
  for (let guard = 0; guard < g.players.length * 2; guard++) {
    if (totalBooks(g) >= TOTAL_BOOKS) {
      g.phase = 'over';
      return;
    }
    const id = current(g);
    if (g.hands[id].length > 0) return;
    if (g.stock.length > 0) {
      drawFor(g, id, events, 'had no cards and drew one');
      collectBooks(g, id, events);
      if (g.hands[id].length > 0) return;
    }
    g.turnIdx = nextSeat(g.players.length, g.turnIdx);
  }
  if (totalBooks(g) >= TOTAL_BOOKS || g.players.every((id) => g.hands[id].length === 0)) g.phase = 'over';
}

export function createGame(players, options = {}) {
  const n = players.length;
  if (n < meta.minPlayers || n > meta.maxPlayers) throw new Error('Go Fish needs 2-6 players');
  const dealSize = options.dealSize === 5 || options.dealSize === 7 ? options.dealSize : n <= 3 ? 7 : 5;
  const seed = options.seed ?? 'go-fish';
  const deck = shuffle(createDeck(), `${seed}:deal`);
  const { hands, rest } = deal(deck, n, dealSize);
  const g = {
    game: 'go-fish',
    players: players.map((p) => p.id),
    names: namesMap(players),
    options: { dealSize, luckyCatch: options.luckyCatch !== false },
    seed,
    hands: Object.fromEntries(players.map((p, i) => [p.id, hands[i]])),
    stock: rest,
    books: Object.fromEntries(players.map((p) => [p.id, []])),
    turnIdx: 0,
    lastAsk: null,
    asks: 0,
    phase: 'play',
    dealId: 1,
    autoAdvance: null,
  };
  for (const id of g.players) collectBooks(g, id, []);
  settleTurn(g, []);
  return g;
}

export const isGameOver = (g) => g.phase === 'over';

export function getPublicState(g) {
  return {
    phase: g.phase,
    turn: g.phase === 'play' ? current(g) : null,
    stockCount: g.stock.length,
    players: g.players.map((id) => ({ id, cardCount: g.hands[id].length, books: g.books[id].map((b) => b.rank) })),
    lastAsk: g.lastAsk,
  };
}

export function getLegalActions(g, playerId) {
  if (g.phase !== 'play' || current(g) !== playerId) return [];
  const targets = g.players.filter((id) => id !== playerId && g.hands[id].length > 0);
  if (!targets.length || !g.hands[playerId].length) return [];
  return [
    {
      type: 'ask',
      label: 'Ask for this rank',
      style: 'primary',
      cards: { min: 1, max: 1, allowed: g.hands[playerId].map((c) => c.id) },
      params: [{ name: 'target', label: 'Ask', type: 'player', options: targets, default: targets[0] }],
    },
  ];
}

export function applyAction(game, playerId, action) {
  if (game.phase !== 'play') return fail('The game is over.');
  if (!game.players.includes(playerId)) return fail('You are not playing in this game.');
  if (action?.type !== 'ask') return fail('Unknown action.');
  if (current(game) !== playerId) return fail(`It's ${nameOf(game, current(game))}'s turn.`);
  const g = clone(game);
  const events = [];
  const hand = g.hands[playerId];
  let rank = action.rank;
  if (Array.isArray(action.cards) && action.cards.length) {
    const c = hand.find((x) => x.id === action.cards[0]);
    if (!c) return fail("You don't have that card.");
    rank = c.rank;
  }
  if (!RANKS.includes(rank)) return fail('Pick a card to choose which rank to ask for.');
  if (!hand.some((c) => c.rank === rank)) return fail('You can only ask for a rank you already hold.');
  const target = action.target;
  if (!g.players.includes(target) || target === playerId) return fail('Choose another player to ask.');
  if (!g.hands[target].length) return fail(`${nameOf(g, target)} has no cards.`);

  const me = nameOf(g, playerId);
  const them = nameOf(g, target);
  g.lastAsk = { playerId, target, rank };
  g.asks += 1;
  const got = g.hands[target].filter((c) => c.rank === rank);
  if (got.length) {
    g.hands[target] = g.hands[target].filter((c) => c.rank !== rank);
    g.hands[playerId].push(...got);
    events.push({
      type: 'give',
      toast: true,
      text: `${me} asked ${them} for ${rankName(rank, 2)} — got ${got.length}!`,
      anim: { kind: 'seatToSeat', from: target, to: playerId, count: got.length, cards: got },
      cards: got,
    });
    collectBooks(g, playerId, events);
    // Same player goes again (if they still have cards; settleTurn refills an empty hand).
  } else {
    events.push({ type: 'goFish', toast: true, text: `${me} asked ${them} for ${rankName(rank, 2)} — Go fish!` });
    let lucky = false;
    if (g.stock.length) {
      const card = drawFor(g, playerId, events, 'drew from the pond');
      lucky = card.rank === rank && g.options.luckyCatch;
      if (lucky) events.push({ type: 'lucky', toast: true, text: `${me} fished the ${rankName(rank)} they wanted and goes again!` });
      collectBooks(g, playerId, events);
    }
    if (!lucky) g.turnIdx = nextSeat(g.players.length, g.turnIdx);
  }
  settleTurn(g, events);
  return ok(g, events);
}

export function getPlayerView(g, viewer) {
  const turn = current(g);
  let prompt;
  if (g.phase === 'over') prompt = 'All books are made — game over!';
  else if (turn === viewer) prompt = 'Your turn: tap a card for the rank you want, pick a player and ask.';
  else prompt = `${nameOf(g, turn)} is asking…`;
  const groups = [];
  for (const id of g.players) {
    for (const b of g.books[id]) groups.push({ id: `${id}-${b.rank}`, label: `${nameOf(g, id)}: ${rankName(b.rank, 2)}`, cards: b.cards });
  }
  return {
    ...getPublicState(g),
    prompt,
    hand: sortHand(g.hands[viewer] ?? [], { by: 'rank' }),
    players: g.players.map((id) => ({
      id,
      cardCount: g.hands[id].length,
      stats: [{ label: 'Books', value: g.books[id].length }],
    })),
    table: [
      { id: 'stock', type: 'pile', label: 'Pond', count: g.stock.length },
      { id: 'books', type: 'melds', label: `Books (${totalBooks(g)}/13)`, groups },
    ],
    info: [
      { label: 'Pond', value: g.stock.length },
      { label: 'Books', value: `${totalBooks(g)}/13` },
      ...(g.lastAsk ? [{ label: 'Last ask', value: `${nameOf(g, g.lastAsk.playerId)} → ${rankName(g.lastAsk.rank, 2)}` }] : []),
    ],
    dealId: g.dealId,
  };
}

export function getResults(g) {
  const { rankings, winners } = rankPlayers(g.players, (id) => g.books[id].length, {
    label: (id) => `${g.books[id].length} book${g.books[id].length === 1 ? '' : 's'}`,
  });
  return { rankings, winners, summary: `${winners.map((id) => nameOf(g, id)).join(' & ')} win${winners.length > 1 ? '' : 's'} with ${g.books[winners[0]].length} books!` };
}

/**
 * Bot: prefers ranks it holds most of and players with the most cards, but cycles through
 * every (rank, player) pair over successive asks so a game with an empty pond always progresses.
 */
export function getAutoAction(g, playerId) {
  const legal = getLegalActions(g, playerId);
  if (!legal.length) return null;
  const counts = {};
  for (const c of g.hands[playerId]) counts[c.rank] = (counts[c.rank] ?? 0) + 1;
  const ranks = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b));
  const targets = legal[0].params[0].options.slice().sort((a, b) => g.hands[b].length - g.hands[a].length);
  const target = targets[g.asks % targets.length];
  const rank = ranks[Math.floor(g.asks / targets.length) % ranks.length];
  const card = g.hands[playerId].find((c) => c.rank === rank);
  return { type: 'ask', cards: [card.id], target };
}
