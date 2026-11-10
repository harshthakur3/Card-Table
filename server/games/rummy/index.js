// Rummy (basic / "Straight" Rummy): draw, meld sets and runs, lay off, discard. First out wins the hand.
import { cardLabel, cardsLabel, createDeck, deal, rankValue, shuffle, sortHand, takeCards } from '../../shared/cards.js';
import { SYSTEM, clone, fail, nameOf, namesMap, nextSeat, ok, rankPlayers } from '../../shared/engine.js';

export const meta = {
  id: 'rummy',
  name: 'Rummy',
  order: 8,
  minPlayers: 2,
  maxPlayers: 6,
  tagline: 'Sets and runs. Go out first.',
  description: 'Draw a card, lay down sets (3–4 of a kind) and runs (3+ in a row, same suit), add to any meld on the table, then discard. First to empty their hand wins the hand.',
  options: [
    {
      key: 'target',
      label: 'Play to',
      type: 'select',
      default: 0,
      choices: [
        { value: 0, label: 'One hand' },
        { value: 100, label: '100 points' },
        { value: 250, label: '250 points' },
      ],
    },
    { key: 'aceHigh', label: 'Ace can also be high (Q-K-A)', type: 'boolean', default: false },
  ],
};

const current = (g) => g.players[g.turnIdx];
const top = (g) => g.discard[g.discard.length - 1] ?? null;

/** Card value for scoring: A=1, 2-10 face value, J/Q/K=10. */
export const cardPoints = (c) => (c.rank === 'A' ? 1 : ['J', 'Q', 'K'].includes(c.rank) ? 10 : Number(c.rank));
const handPoints = (cards) => cards.reduce((s, c) => s + cardPoints(c), 0);

export function isSet(cards) {
  return (
    cards.length >= 3 &&
    cards.length <= 4 &&
    cards.every((c) => c.rank === cards[0].rank) &&
    new Set(cards.map((c) => c.suit)).size === cards.length
  );
}

function runOrder(cards, aceHigh) {
  if (cards.length < 3 || !cards.every((c) => c.suit === cards[0].suit)) return null;
  for (const ace of aceHigh ? [1, 14] : [1]) {
    const v = (c) => (c.rank === 'A' ? ace : rankValue(c.rank));
    const sorted = cards.slice().sort((a, b) => v(a) - v(b));
    if (sorted.every((c, i) => i === 0 || v(c) === v(sorted[i - 1]) + 1)) return sorted;
  }
  return null;
}

export function isRun(cards, aceHigh = false) {
  return runOrder(cards, aceHigh) !== null;
}

function meldOf(cards, aceHigh) {
  if (isSet(cards)) return { type: 'set', cards: sortHand(cards) };
  const run = runOrder(cards, aceHigh);
  return run ? { type: 'run', cards: run } : null;
}

const meldLabel = (g, m) => `${nameOf(g, m.owner)}: ${cardsLabel(m.cards)}`;

function dealSize(n) {
  if (n === 2) return 10;
  if (n <= 4) return 7;
  return 6;
}

function startRound(g, events) {
  const n = g.players.length;
  const deck = shuffle(createDeck(), `${g.seed}:r${g.roundIdx}`);
  const { hands, rest } = deal(deck, n, dealSize(n));
  g.hands = {};
  g.players.forEach((id, i) => {
    g.hands[id] = hands[(i - g.dealerIdx - 1 + 2 * n) % n];
  });
  g.discard = [rest[0]];
  g.stock = rest.slice(1);
  g.melds = [];
  g.turnIdx = (g.dealerIdx + 1) % n;
  g.phase = 'draw';
  g.takenDiscard = null;
  g.roundReshuffles = 0;
  g.dealId += 1;
  g.autoAdvance = null;
  events.push({ type: 'deal', toast: true, text: `Hand ${g.roundIdx + 1}: ${dealSize(n)} cards each — ${nameOf(g, current(g))} starts` });
}

export function createGame(players, options = {}) {
  const n = players.length;
  if (n < meta.minPlayers || n > meta.maxPlayers) throw new Error('Rummy needs 2-6 players');
  const g = {
    game: 'rummy',
    players: players.map((p) => p.id),
    names: namesMap(players),
    options: { target: [0, 100, 250].includes(options.target) ? options.target : 0, aceHigh: Boolean(options.aceHigh) },
    seed: options.seed ?? 'rummy',
    roundIdx: 0,
    dealerIdx: 0,
    meldSeq: 0,
    scores: Object.fromEntries(players.map((p) => [p.id, 0])),
    history: [],
    lastWinner: null,
    dealId: 0,
  };
  startRound(g, []);
  return g;
}

export const isGameOver = (g) => g.phase === 'over';

function endRound(g, winner, events) {
  const deadwood = Object.fromEntries(g.players.map((id) => [id, handPoints(g.hands[id])]));
  const points = Object.fromEntries(g.players.map((id) => [id, 0]));
  if (winner) {
    points[winner] = g.players.filter((id) => id !== winner).reduce((s, id) => s + deadwood[id], 0);
    g.scores[winner] += points[winner];
    events.push({ type: 'out', toast: true, tone: 'good', text: `${nameOf(g, winner)} went out! (+${points[winner]} points)` });
  } else {
    events.push({ type: 'blocked', toast: true, text: 'The stock ran out — nobody went out this hand.' });
  }
  g.lastWinner = winner;
  g.history.push({ round: g.roundIdx + 1, winner, points, deadwood });
  const done = g.options.target === 0 || (winner && g.scores[winner] >= g.options.target);
  if (done) {
    g.phase = 'over';
    g.autoAdvance = null;
  } else {
    g.phase = 'roundEnd';
    g.autoAdvance = { delayMs: 5000, action: { type: 'nextRound' } };
  }
}

export function getPublicState(g) {
  return {
    phase: g.phase,
    turn: g.phase === 'draw' || g.phase === 'meld' ? current(g) : null,
    stockCount: g.stock.length,
    discardTop: top(g),
    discardCount: g.discard.length,
    melds: g.melds,
    scores: g.scores,
    players: g.players.map((id) => ({ id, cardCount: g.hands[id].length })),
  };
}

export function getLegalActions(g, playerId) {
  if (!g.players.includes(playerId) || current(g) !== playerId) return [];
  const hand = g.hands[playerId];
  if (g.phase === 'draw') {
    const out = [{ type: 'drawStock', label: 'Draw from stock', style: 'primary' }];
    if (top(g)) out.push({ type: 'drawDiscard', label: `Take ${cardLabel(top(g))}`, style: 'secondary' });
    return out;
  }
  if (g.phase !== 'meld') return [];
  const all = hand.map((c) => c.id);
  const out = [{ type: 'meld', label: 'Meld', style: 'primary', optional: true, cards: { min: 3, max: hand.length, allowed: all } }];
  if (g.melds.length) {
    out.push({
      type: 'layoff',
      label: 'Lay off',
      style: 'secondary',
      optional: true,
      cards: { min: 1, max: Math.min(4, hand.length), allowed: all },
      params: [
        {
          name: 'meld',
          label: 'Onto',
          type: 'choice',
          options: g.melds.map((m) => ({ value: m.id, label: meldLabel(g, m) })),
          default: g.melds[0].id,
        },
      ],
    });
  }
  const discardable = hand.length === 1 ? all : all.filter((id) => id !== g.takenDiscard);
  out.push({ type: 'discard', label: 'Discard', style: 'danger', cards: { min: 1, max: 1, allowed: discardable } });
  return out;
}

export function applyAction(game, playerId, action) {
  const g = clone(game);
  const events = [];
  const type = action?.type;

  if (playerId === SYSTEM) {
    if (type === 'nextRound' && g.phase === 'roundEnd') {
      g.roundIdx += 1;
      g.dealerIdx = (g.dealerIdx + 1) % g.players.length;
      startRound(g, events);
      return ok(g, events);
    }
    return fail('Nothing to advance.');
  }
  if (!g.players.includes(playerId)) return fail('You are not playing in this game.');
  if (g.phase === 'over') return fail('The game is over.');
  if (current(g) !== playerId) return fail(`It's ${nameOf(g, current(g))}'s turn.`);
  const me = nameOf(g, playerId);

  if (type === 'drawStock' || type === 'drawDiscard') {
    if (g.phase !== 'draw') return fail('You already drew this turn.');
    if (type === 'drawDiscard') {
      const card = g.discard.pop();
      if (!card) return fail('The discard pile is empty.');
      g.hands[playerId].push(card);
      g.takenDiscard = card.id;
      events.push({ type: 'take', text: `${me} took ${cardLabel(card)} from the discard pile`, anim: { kind: 'toSeat', playerId, count: 1, cards: [card] } });
    } else {
      if (!g.stock.length) {
        // The stock may be rebuilt from the discards up to 3 times per hand; after that the hand is a draw.
        if (g.discard.length > 1 && g.roundReshuffles < 3) {
          const keep = g.discard.pop();
          g.roundReshuffles += 1;
          g.stock = shuffle(g.discard, `${g.seed}:r${g.roundIdx}:reshuffle${g.roundReshuffles}`);
          g.discard = [keep];
          events.push({ type: 'reshuffle', toast: true, text: 'The stock ran out — the discard pile was shuffled into a new stock.' });
        } else {
          endRound(g, null, events);
          return ok(g, events);
        }
      }
      const card = g.stock.shift();
      g.hands[playerId].push(card);
      g.takenDiscard = null;
      events.push({ type: 'draw', text: `${me} drew from the stock`, anim: { kind: 'toSeat', playerId, count: 1 } });
      events.push({ type: 'drew', to: playerId, text: `You drew ${cardLabel(card)}` });
    }
    g.phase = 'meld';
    return ok(g, events);
  }

  if (g.phase !== 'meld') return fail('Draw a card first (from the stock or the discard pile).');
  const ids = Array.isArray(action.cards) ? action.cards : [];
  const taken = takeCards(g.hands[playerId], ids);
  if (!taken || !ids.length) return fail("Select cards from your hand.");

  if (type === 'meld') {
    if (ids.length < 3) return fail('A meld needs at least 3 cards.');
    const m = meldOf(taken.taken, g.options.aceHigh);
    if (!m) return fail('Those cards are not a valid set (same rank) or run (same suit, in sequence).');
    g.hands[playerId] = taken.hand;
    g.meldSeq += 1;
    g.melds.push({ id: `m${g.meldSeq}`, type: m.type, cards: m.cards, owner: playerId });
    events.push({ type: 'meld', text: `${me} melded a ${m.type}: ${cardsLabel(m.cards)}`, anim: { kind: 'toCenter', playerId, count: m.cards.length, cards: m.cards } });
  } else if (type === 'layoff') {
    const meld = g.melds.find((x) => x.id === action.meld);
    if (!meld) return fail('Choose which meld to add to.');
    const combined = meldOf([...meld.cards, ...taken.taken], g.options.aceHigh);
    if (!combined || combined.type !== meld.type) return fail(`${cardsLabel(taken.taken)} doesn't fit on ${cardsLabel(meld.cards)}.`);
    g.hands[playerId] = taken.hand;
    meld.cards = combined.cards;
    events.push({ type: 'layoff', text: `${me} laid off ${cardsLabel(taken.taken)}`, anim: { kind: 'toCenter', playerId, count: ids.length, cards: taken.taken } });
  } else if (type === 'discard') {
    if (ids.length !== 1) return fail('Discard exactly one card.');
    if (ids[0] === g.takenDiscard && g.hands[playerId].length > 1) return fail("You can't discard the card you just took from the discard pile.");
    g.hands[playerId] = taken.hand;
    g.discard.push(taken.taken[0]);
    events.push({ type: 'discard', text: `${me} discarded ${cardLabel(taken.taken[0])}`, anim: { kind: 'toCenter', playerId, count: 1, cards: taken.taken } });
  } else {
    return fail('Unknown action.');
  }

  if (g.hands[playerId].length === 0) {
    endRound(g, playerId, events);
  } else if (type === 'discard') {
    g.turnIdx = nextSeat(g.players.length, g.turnIdx);
    g.phase = 'draw';
    g.takenDiscard = null;
  }
  return ok(g, events);
}

export function getPlayerView(g, viewer) {
  let prompt;
  if (g.phase === 'over') prompt = 'Game over';
  else if (g.phase === 'roundEnd') prompt = `${g.lastWinner ? `${nameOf(g, g.lastWinner)} went out` : 'Hand over'} — next hand starting…`;
  else if (current(g) === viewer) {
    prompt = g.phase === 'draw'
      ? 'Your turn: draw from the stock or take the top discard.'
      : 'Meld sets/runs or lay off onto any meld, then select one card to discard.';
  } else prompt = `${nameOf(g, current(g))} is ${g.phase === 'draw' ? 'drawing' : 'playing'}…`;

  const t = top(g);
  const columns = [{ key: 'round', label: 'Hand' }, ...g.players.map((id) => ({ key: id, label: nameOf(g, id) }))];
  const rows = g.history.map((h) => ({ round: h.round, ...Object.fromEntries(g.players.map((id) => [id, h.winner === id ? `+${h.points[id]}` : `(${h.deadwood[id]})`])) }));
  rows.push({ _total: true, round: 'Total', ...g.scores });

  return {
    ...getPublicState(g),
    prompt,
    hand: sortHand(g.hands[viewer] ?? [], { aceLow: !g.options.aceHigh }),
    players: g.players.map((id) => ({
      id,
      cardCount: g.hands[id].length,
      stats: g.options.target ? [{ label: 'Pts', value: g.scores[id] }] : [],
    })),
    table: [
      { id: 'stock', type: 'pile', label: 'Stock', count: g.stock.length },
      { id: 'discard', type: 'pile', label: 'Discard', count: Math.max(0, g.discard.length - 1), top: t ? [t] : [] },
      { id: 'melds', type: 'melds', label: 'Melds', groups: g.melds.map((m) => ({ id: m.id, label: nameOf(g, m.owner), cards: m.cards })) },
    ],
    info: [
      { label: 'Hand', value: g.roundIdx + 1 },
      { label: 'Stock', value: g.stock.length },
      ...(g.options.target ? [{ label: 'Play to', value: g.options.target }] : []),
    ],
    scoreboard: g.options.target ? { columns, rows } : undefined,
    dealId: g.dealId,
  };
}

export function getResults(g) {
  if (g.options.target === 0) {
    const { rankings, winners } = rankPlayers(g.players, (id) => handPoints(g.hands[id]), {
      lowWins: true,
      label: (id) => (g.hands[id].length ? `${handPoints(g.hands[id])} points left in hand` : 'Went out!'),
    });
    return { rankings, winners, summary: g.lastWinner ? `${nameOf(g, g.lastWinner)} went out and wins!` : 'Lowest hand wins!' };
  }
  const { rankings, winners } = rankPlayers(g.players, (id) => g.scores[id], { label: (id) => `${g.scores[id]} pts` });
  return { rankings, winners, summary: `${winners.map((id) => nameOf(g, id)).join(' & ')} reach${winners.length > 1 ? '' : 'es'} ${g.scores[winners[0]]} points and win!` };
}

/** Find one meld in a hand (largest set, else longest run). */
export function findMeld(hand, aceHigh = false) {
  const byRank = {};
  for (const c of hand) (byRank[c.rank] ||= []).push(c);
  const sets = Object.values(byRank)
    .map((cs) => cs.filter((c, i, arr) => arr.findIndex((x) => x.suit === c.suit) === i))
    .filter((cs) => cs.length >= 3)
    .sort((a, b) => b.length - a.length);
  if (sets.length) return sets[0].slice(0, 4);
  let best = null;
  for (const suit of ['S', 'H', 'D', 'C']) {
    for (const ace of aceHigh ? [1, 14] : [1]) {
      const v = (c) => (c.rank === 'A' ? ace : rankValue(c.rank));
      const cs = hand.filter((c) => c.suit === suit).sort((a, b) => v(a) - v(b));
      let runStart = 0;
      for (let i = 1; i <= cs.length; i++) {
        if (i === cs.length || v(cs[i]) !== v(cs[i - 1]) + 1) {
          const run = cs.slice(runStart, i);
          if (run.length >= 3 && (!best || run.length > best.length)) best = run;
          runStart = i;
        }
      }
    }
  }
  return best;
}

/** Bot: take a discard that completes a meld, meld everything possible, lay off, then discard the highest loose card. */
export function getAutoAction(g, playerId) {
  if (current(g) !== playerId) return null;
  const hand = g.hands[playerId];
  const aceHigh = g.options.aceHigh;
  if (g.phase === 'draw') {
    const t = top(g);
    if (t) {
      const m = findMeld([...hand, t], aceHigh);
      if (m && m.some((c) => c.id === t.id) && hand.length > 1) return { type: 'drawDiscard' };
    }
    return { type: 'drawStock' };
  }
  if (g.phase !== 'meld') return null;
  const m = findMeld(hand, aceHigh);
  if (m) return { type: 'meld', cards: m.map((c) => c.id) };
  for (const c of hand) {
    for (const meld of g.melds) {
      if (meldOf([...meld.cards, c], aceHigh)?.type === meld.type) return { type: 'layoff', cards: [c.id], meld: meld.id };
    }
  }
  const allowed = hand.filter((c) => c.id !== g.takenDiscard || hand.length === 1);
  const near = (c) =>
    hand.some((x) => x.id !== c.id && (x.rank === c.rank || (x.suit === c.suit && Math.abs(rankValue(x.rank, { aceLow: true }) - rankValue(c.rank, { aceLow: true })) === 1)));
  const loose = allowed.filter((c) => !near(c));
  const pool = loose.length ? loose : allowed;
  const pick = pool.slice().sort((a, b) => cardPoints(b) - cardPoints(a))[0];
  return { type: 'discard', cards: [pick.id] };
}
