// Crazy Eights — match the suit or rank of the top card; eights are wild.
import { SUITS, SUIT_NAMES, SUIT_SYMBOLS, cardLabel, createDeck, deal, shuffle, sortHand } from '../../shared/cards.js';
import { SYSTEM, clone, fail, nameOf, namesMap, nextSeat, ok, rankPlayers } from '../../shared/engine.js';

export const meta = {
  id: 'crazy-eights',
  name: 'Crazy Eights',
  order: 9,
  minPlayers: 2,
  maxPlayers: 7,
  tagline: 'Match it or go wild.',
  description: 'Play a card that matches the suit or rank of the top card. Eights are wild — play one and call a new suit. First to empty their hand wins.',
  options: [
    {
      key: 'target',
      label: 'Play to',
      type: 'select',
      default: 0,
      choices: [
        { value: 0, label: 'One hand' },
        { value: 100, label: '100 points' },
        { value: 200, label: '200 points' },
      ],
    },
    {
      key: 'drawLimit',
      label: 'When you draw',
      type: 'select',
      default: 1,
      choices: [
        { value: 1, label: 'Draw 1, then play it or pass' },
        { value: 3, label: 'Draw up to 3' },
        { value: 99, label: 'Keep drawing until you can play' },
      ],
    },
  ],
};

const current = (g) => g.players[g.turnIdx];
const top = (g) => g.discard[g.discard.length - 1];
const SUIT_CHOICES = SUITS.map((s) => ({ value: s, label: `${SUIT_SYMBOLS[s]} ${SUIT_NAMES[s]}` }));

/** 8 = 50, J/Q/K = 10, A = 1, others face value. */
export const cardPoints = (c) => (c.rank === '8' ? 50 : ['J', 'Q', 'K'].includes(c.rank) ? 10 : c.rank === 'A' ? 1 : Number(c.rank));
const handPoints = (cards) => cards.reduce((s, c) => s + cardPoints(c), 0);

export function canPlay(g, card) {
  return card.rank === '8' || card.suit === g.activeSuit || card.rank === top(g).rank;
}

function canDrawMore(g) {
  return g.drawn < g.options.drawLimit && (g.stock.length > 0 || g.discard.length > 1);
}

function startRound(g, events) {
  const n = g.players.length;
  let deck = shuffle(createDeck(), `${g.seed}:r${g.roundIdx}`);
  const { hands, rest } = deal(deck, n, n === 2 ? 7 : 5);
  deck = rest;
  // An eight can't start the pile: bury it in the middle of the stock and turn the next card.
  let starter = deck.shift();
  while (starter.rank === '8') {
    deck.splice(Math.floor(deck.length / 2), 0, starter);
    starter = deck.shift();
  }
  g.hands = {};
  g.players.forEach((id, i) => {
    g.hands[id] = hands[(i - g.dealerIdx - 1 + 2 * n) % n];
  });
  g.stock = deck;
  g.discard = [starter];
  g.activeSuit = starter.suit;
  g.turnIdx = (g.dealerIdx + 1) % n;
  g.drawn = 0;
  g.passes = 0;
  g.phase = 'play';
  g.dealId += 1;
  g.autoAdvance = null;
  events.push({ type: 'deal', toast: true, text: `Hand ${g.roundIdx + 1}: starting card ${cardLabel(starter)}` });
}

export function createGame(players, options = {}) {
  const n = players.length;
  if (n < meta.minPlayers || n > meta.maxPlayers) throw new Error('Crazy Eights needs 2-7 players');
  const g = {
    game: 'crazy-eights',
    players: players.map((p) => p.id),
    names: namesMap(players),
    options: {
      target: [0, 100, 200].includes(options.target) ? options.target : 0,
      drawLimit: [1, 3, 99].includes(options.drawLimit) ? options.drawLimit : 1,
    },
    seed: options.seed ?? 'crazy-eights',
    roundIdx: 0,
    dealerIdx: 0,
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
  const values = Object.fromEntries(g.players.map((id) => [id, handPoints(g.hands[id])]));
  const pts = g.players.filter((id) => id !== winner).reduce((s, id) => s + values[id], 0);
  g.scores[winner] += pts;
  g.lastWinner = winner;
  g.history.push({ round: g.roundIdx + 1, winner, pts, values });
  if (g.passes >= g.players.length) {
    events.push({ type: 'blocked', toast: true, text: `Nobody can play — ${nameOf(g, winner)} has the lowest hand and wins it (+${pts})` });
  } else {
    events.push({ type: 'out', toast: true, tone: 'good', text: `${nameOf(g, winner)} played their last card! (+${pts})` });
  }
  if (g.options.target === 0 || g.scores[winner] >= g.options.target) {
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
    turn: g.phase === 'play' ? current(g) : null,
    top: top(g),
    activeSuit: g.activeSuit,
    stockCount: g.stock.length,
    scores: g.scores,
    players: g.players.map((id) => ({ id, cardCount: g.hands[id].length })),
  };
}

export function getLegalActions(g, playerId) {
  if (g.phase !== 'play' || current(g) !== playerId) return [];
  const hand = g.hands[playerId];
  const plain = hand.filter((c) => c.rank !== '8' && canPlay(g, c));
  const eights = hand.filter((c) => c.rank === '8');
  const out = [];
  if (plain.length) out.push({ type: 'play', label: 'Play', style: 'primary', cards: { min: 1, max: 1, allowed: plain.map((c) => c.id) } });
  if (eights.length) {
    out.push({
      type: 'playEight',
      label: 'Play 8',
      style: 'primary',
      cards: { min: 1, max: 1, allowed: eights.map((c) => c.id) },
      params: [{ name: 'suit', label: 'New suit', type: 'choice', options: SUIT_CHOICES, default: bestSuit(hand) }],
    });
  }
  if (canDrawMore(g)) out.push({ type: 'draw', label: g.drawn ? 'Draw again' : 'Draw', style: 'secondary' });
  else if (g.drawn > 0 || (!plain.length && !eights.length)) out.push({ type: 'pass', label: 'Pass', style: 'secondary' });
  return out;
}

function bestSuit(hand) {
  const counts = { S: 0, H: 0, D: 0, C: 0 };
  for (const c of hand) if (c.rank !== '8') counts[c.suit] += 1;
  return Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
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
  if (g.phase !== 'play') return fail(g.phase === 'over' ? 'The game is over.' : 'Wait for the next hand.');
  if (current(g) !== playerId) return fail(`It's ${nameOf(g, current(g))}'s turn.`);
  const me = nameOf(g, playerId);

  if (type === 'play' || type === 'playEight') {
    const id = Array.isArray(action.cards) ? action.cards[0] : action.card;
    const card = g.hands[playerId].find((c) => c.id === id);
    if (!card) return fail("You don't have that card.");
    if (!canPlay(g, card)) return fail(`${cardLabel(card)} doesn't match — play a ${SUIT_NAMES[g.activeSuit].replace(/s$/, '')}, a ${top(g).rank}, or an 8.`);
    let suit = card.suit;
    if (card.rank === '8') {
      if (!SUITS.includes(action.suit)) return fail('Choose the suit for your 8.');
      suit = action.suit;
    }
    g.hands[playerId] = g.hands[playerId].filter((c) => c.id !== id);
    g.discard.push(card);
    g.activeSuit = suit;
    g.drawn = 0;
    g.passes = 0;
    events.push({
      type: 'play',
      text: card.rank === '8' ? `${me} played ${cardLabel(card)} and called ${SUIT_NAMES[suit]}` : `${me} played ${cardLabel(card)}`,
      toast: card.rank === '8',
      playerId,
      anim: { kind: 'toCenter', playerId, count: 1, cards: [card] },
    });
    if (g.hands[playerId].length === 1) events.push({ type: 'last', toast: true, text: `${me} has one card left!` });
    if (g.hands[playerId].length === 0) {
      endRound(g, playerId, events);
      return ok(g, events);
    }
    g.turnIdx = nextSeat(g.players.length, g.turnIdx);
    return ok(g, events);
  }

  if (type === 'draw') {
    if (!canDrawMore(g)) return fail(g.drawn >= g.options.drawLimit ? 'You have drawn as many as allowed — play or pass.' : 'There are no cards left to draw.');
    if (!g.stock.length) {
      const keep = g.discard.pop();
      g.reshuffles = (g.reshuffles ?? 0) + 1;
      g.stock = shuffle(g.discard, `${g.seed}:reshuffle${g.reshuffles}`);
      g.discard = [keep];
      events.push({ type: 'reshuffle', text: 'The discard pile was shuffled into a new stock' });
    }
    const card = g.stock.shift();
    g.hands[playerId].push(card);
    g.drawn += 1;
    events.push({ type: 'draw', text: `${me} drew a card`, playerId, anim: { kind: 'toSeat', playerId, count: 1 } });
    events.push({ type: 'drew', to: playerId, text: `You drew ${cardLabel(card)}` });
    // "Until you can play": stop automatically once a playable card arrives.
    if (g.options.drawLimit === 99 && canPlay(g, card)) g.drawn = 99;
    return ok(g, events);
  }

  if (type === 'pass') {
    const hasPlay = g.hands[playerId].some((c) => canPlay(g, c));
    if (canDrawMore(g)) return fail('Draw a card first.');
    if (g.drawn === 0 && hasPlay) return fail('You have a card you can play.');
    events.push({ type: 'pass', text: `${me} passed`, playerId });
    g.drawn = 0;
    // Only count passes while nothing can be drawn — that is how a hand gets blocked.
    const noCards = g.stock.length === 0 && g.discard.length <= 1;
    g.passes = noCards ? g.passes + 1 : 0;
    if (g.passes >= g.players.length) {
      // Completely blocked: lowest hand wins the round.
      const winner = g.players.slice().sort((a, b) => handPoints(g.hands[a]) - handPoints(g.hands[b]))[0];
      endRound(g, winner, events);
      return ok(g, events);
    }
    g.turnIdx = nextSeat(g.players.length, g.turnIdx);
    return ok(g, events);
  }
  return fail('Unknown action.');
}

export function getPlayerView(g, viewer) {
  let prompt;
  const t = top(g);
  if (g.phase === 'over') prompt = 'Game over';
  else if (g.phase === 'roundEnd') prompt = `${nameOf(g, g.lastWinner)} won the hand — next hand starting…`;
  else if (current(g) === viewer) {
    const can = (g.hands[viewer] ?? []).some((c) => canPlay(g, c));
    prompt = can
      ? `Your turn: match ${SUIT_SYMBOLS[g.activeSuit]} or ${t.rank}, or play an 8.`
      : g.drawn === 0 || canDrawMore(g) ? 'No match — draw a card.' : 'Still no match — pass.';
  } else prompt = `${nameOf(g, current(g))} to play`;

  const columns = [{ key: 'round', label: 'Hand' }, ...g.players.map((id) => ({ key: id, label: nameOf(g, id) }))];
  const rows = g.history.map((h) => ({ round: h.round, ...Object.fromEntries(g.players.map((id) => [id, h.winner === id ? `+${h.pts}` : `(${h.values[id]})`])) }));
  rows.push({ _total: true, round: 'Total', ...g.scores });

  return {
    ...getPublicState(g),
    prompt,
    hand: sortHand(g.hands[viewer] ?? []),
    players: g.players.map((id) => ({
      id,
      cardCount: g.hands[id].length,
      stats: g.options.target ? [{ label: 'Pts', value: g.scores[id] }] : [],
    })),
    table: [
      { id: 'stock', type: 'pile', label: 'Stock', count: g.stock.length },
      { id: 'discard', type: 'pile', label: t.rank === '8' ? `Suit: ${SUIT_SYMBOLS[g.activeSuit]} ${SUIT_NAMES[g.activeSuit]}` : 'Discard', count: g.discard.length - 1, top: [t], highlight: t.rank === '8' },
    ],
    info: [
      { label: 'Suit', value: `${SUIT_SYMBOLS[g.activeSuit]}` },
      { label: 'Stock', value: g.stock.length },
      ...(g.options.target ? [{ label: 'Play to', value: g.options.target }] : []),
    ],
    scoreboard: g.options.target ? { columns, rows } : undefined,
    dealId: g.dealId,
  };
}

export function getResults(g) {
  if (g.options.target === 0) {
    const { rankings, winners } = rankPlayers(g.players, (id) => (id === g.lastWinner ? -1 : handPoints(g.hands[id])), {
      lowWins: true,
    });
    return {
      rankings: rankings.map((r) => ({ ...r, score: handPoints(g.hands[r.playerId]), label: r.playerId === g.lastWinner ? 'Winner!' : `${handPoints(g.hands[r.playerId])} points in hand` })),
      winners,
      summary: `${nameOf(g, g.lastWinner)} wins the hand!`,
    };
  }
  const { rankings, winners } = rankPlayers(g.players, (id) => g.scores[id], { label: (id) => `${g.scores[id]} pts` });
  return { rankings, winners, summary: `${winners.map((id) => nameOf(g, id)).join(' & ')} win${winners.length > 1 ? '' : 's'} with ${g.scores[winners[0]]} points!` };
}

/** Bot: shed high non-eight matches first, save eights, draw when stuck. */
export function getAutoAction(g, playerId) {
  const legal = getLegalActions(g, playerId);
  if (!legal.length) return null;
  const hand = g.hands[playerId];
  const play = legal.find((a) => a.type === 'play');
  if (play) {
    const options = hand.filter((c) => play.cards.allowed.includes(c.id)).sort((a, b) => cardPoints(b) - cardPoints(a));
    return { type: 'play', cards: [options[0].id] };
  }
  const eight = legal.find((a) => a.type === 'playEight');
  if (eight) return { type: 'playEight', cards: [eight.cards.allowed[0]], suit: bestSuit(hand) };
  if (legal.some((a) => a.type === 'draw')) return { type: 'draw' };
  return { type: 'pass' };
}
