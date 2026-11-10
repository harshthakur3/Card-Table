// Spades — partnership trick-taking; spades are always trumps.
import { SUIT_NAMES, cardLabel, createDeck, deal, rankValue, shuffle, sortHand } from '../../shared/cards.js';
import { SYSTEM, clone, fail, nameOf, namesMap, nextSeat, ok } from '../../shared/engine.js';
import { followSuitCards, trickWinner } from '../../shared/tricks.js';

export const meta = {
  id: 'spades',
  name: 'Spades',
  order: 7,
  minPlayers: 4,
  maxPlayers: 4,
  tagline: 'Partners across the table. Spades always trump.',
  description: 'Two teams of two. Each player bids tricks, partners add their bids together, and spades always trump. Make your contract, avoid too many bags, or go for a daring Nil.',
  options: [
    {
      key: 'target',
      label: 'Play to',
      type: 'select',
      default: 300,
      choices: [
        { value: 200, label: '200 points' },
        { value: 300, label: '300 points' },
        { value: 500, label: '500 points' },
      ],
    },
    { key: 'nil', label: 'Allow Nil bids (±100)', type: 'boolean', default: true },
    { key: 'bags', label: '10 bags = −100 penalty', type: 'boolean', default: true },
  ],
};

const current = (g) => g.players[g.turnIdx];
const teamOf = (g, id) => g.players.indexOf(id) % 2;
const teamName = (g, t) => `${nameOf(g, g.players[t])} & ${nameOf(g, g.players[t + 2])}`;
const bidLabel = (g, b) => (b === 0 && g.options.nil ? 'Nil' : String(b));

function startRound(g, events) {
  const deck = shuffle(createDeck(), `${g.seed}:r${g.roundIdx}`);
  const { hands } = deal(deck, 4, 13);
  g.hands = {};
  g.players.forEach((id, i) => {
    g.hands[id] = hands[(i - g.dealerIdx - 1 + 8) % 4];
  });
  g.bids = Object.fromEntries(g.players.map((id) => [id, null]));
  g.tricks = Object.fromEntries(g.players.map((id) => [id, 0]));
  g.trick = [];
  g.spadesBroken = false;
  g.lastTrickWinner = null;
  g.turnIdx = (g.dealerIdx + 1) % 4;
  g.leaderIdx = g.turnIdx;
  g.phase = 'bid';
  g.dealId += 1;
  g.autoAdvance = null;
  events.push({ type: 'deal', toast: true, text: `Hand ${g.roundIdx + 1}: ${nameOf(g, current(g))} bids first` });
}

export function createGame(players, options = {}) {
  if (players.length !== 4) throw new Error('Spades needs exactly 4 players');
  const g = {
    game: 'spades',
    players: players.map((p) => p.id),
    names: namesMap(players),
    options: {
      target: [200, 300, 500].includes(options.target) ? options.target : 300,
      nil: options.nil !== false,
      bags: options.bags !== false,
    },
    seed: options.seed ?? 'spades',
    roundIdx: 0,
    dealerIdx: 0,
    teamScores: [0, 0],
    teamBags: [0, 0],
    history: [],
    dealId: 0,
  };
  startRound(g, []);
  return g;
}

export const isGameOver = (g) => g.phase === 'over';

export function legalPlays(g, playerId) {
  const hand = g.hands[playerId];
  if (g.trick.length === 0 && !g.spadesBroken) {
    const nonSpades = hand.filter((c) => c.suit !== 'S');
    if (nonSpades.length) return nonSpades;
  }
  return followSuitCards(hand, g.trick);
}

export function getPublicState(g) {
  return {
    phase: g.phase,
    turn: g.phase === 'bid' || g.phase === 'play' ? current(g) : null,
    bids: g.bids,
    tricks: g.tricks,
    trick: g.trick,
    spadesBroken: g.spadesBroken,
    teams: [
      [g.players[0], g.players[2]],
      [g.players[1], g.players[3]],
    ],
    teamScores: g.teamScores,
    teamBags: g.teamBags,
    players: g.players.map((id) => ({ id, cardCount: g.hands[id].length })),
  };
}

export function getLegalActions(g, playerId) {
  if (!g.players.includes(playerId) || current(g) !== playerId) return [];
  if (g.phase === 'bid') {
    return [
      {
        type: 'bid',
        label: 'Bid',
        style: 'primary',
        params: [
          {
            name: 'bid',
            label: g.options.nil ? 'Tricks (0 = Nil)' : 'Tricks',
            type: 'number',
            min: g.options.nil ? 0 : 1,
            max: 13,
            default: g.options.nil ? 1 : 1,
            labels: g.options.nil ? { 0: 'Nil' } : undefined,
          },
        ],
      },
    ];
  }
  if (g.phase === 'play') {
    return [{ type: 'play', label: 'Play card', style: 'primary', cards: { min: 1, max: 1, allowed: legalPlays(g, playerId).map((c) => c.id) } }];
  }
  return [];
}

function endRound(g, events) {
  const rows = { round: g.roundIdx + 1 };
  for (const t of [0, 1]) {
    const members = [g.players[t], g.players[t + 2]];
    let delta = 0;
    let bags = 0;
    const contract = members.reduce((s, id) => s + (g.bids[id] > 0 ? g.bids[id] : 0), 0);
    const counted = members.filter((id) => g.bids[id] > 0 || !g.options.nil).reduce((s, id) => s + g.tricks[id], 0);
    const nilTricks = g.options.nil ? members.filter((id) => g.bids[id] === 0).reduce((s, id) => s + g.tricks[id], 0) : 0;
    for (const id of members) {
      if (g.options.nil && g.bids[id] === 0) {
        const made = g.tricks[id] === 0;
        delta += made ? 100 : -100;
        events.push({ type: 'nil', toast: true, tone: made ? 'good' : 'bad', text: `${nameOf(g, id)} ${made ? 'made' : 'failed'} their Nil (${made ? '+' : '−'}100)` });
      }
    }
    if (contract > 0) {
      if (counted >= contract) {
        delta += 10 * contract;
        bags += counted - contract;
      } else {
        delta -= 10 * contract;
      }
    }
    bags += nilTricks;
    delta += bags;
    g.teamBags[t] += bags;
    if (g.options.bags && g.teamBags[t] >= 10) {
      g.teamBags[t] -= 10;
      delta -= 100;
      events.push({ type: 'bags', toast: true, tone: 'bad', text: `${teamName(g, t)} hit 10 bags (−100)` });
    }
    g.teamScores[t] += delta;
    rows[`t${t}`] = `${counted + nilTricks}/${contract} → ${delta >= 0 ? '+' : ''}${delta}`;
  }
  g.history.push(rows);
  events.push({ type: 'roundEnd', text: `Hand ${g.roundIdx + 1}: ${teamName(g, 0)} ${rows.t0}, ${teamName(g, 1)} ${rows.t1}` });
  const [a, b] = g.teamScores;
  if ((a >= g.options.target || b >= g.options.target) && a !== b) {
    g.phase = 'over';
    g.autoAdvance = null;
  } else {
    g.phase = 'roundEnd';
    g.autoAdvance = { delayMs: 4500, action: { type: 'nextRound' } };
  }
}

export function applyAction(game, playerId, action) {
  const g = clone(game);
  const events = [];
  const type = action?.type;

  if (playerId === SYSTEM) {
    if (type === 'collect' && g.phase === 'trickEnd') {
      const w = g.lastTrickWinner;
      events.push({ type: 'collect', anim: { kind: 'toSeat', playerId: w, count: 4 } });
      g.trick = [];
      g.autoAdvance = null;
      if (g.players.every((id) => g.hands[id].length === 0)) endRound(g, events);
      else {
        g.phase = 'play';
        g.turnIdx = g.players.indexOf(w);
        g.leaderIdx = g.turnIdx;
      }
      return ok(g, events);
    }
    if (type === 'nextRound' && g.phase === 'roundEnd') {
      g.roundIdx += 1;
      g.dealerIdx = (g.dealerIdx + 1) % 4;
      startRound(g, events);
      return ok(g, events);
    }
    return fail('Nothing to advance.');
  }

  if (!g.players.includes(playerId)) return fail('You are not playing in this game.');
  if (g.phase === 'over') return fail('The game is over.');
  const me = nameOf(g, playerId);

  if (type === 'bid') {
    if (g.phase !== 'bid') return fail('Bidding is over.');
    if (current(g) !== playerId) return fail(`It's ${nameOf(g, current(g))}'s turn to bid.`);
    const bid = Number(action.bid);
    const min = g.options.nil ? 0 : 1;
    if (!Number.isInteger(bid) || bid < min || bid > 13) return fail(`Bid ${min === 0 ? 'Nil or ' : ''}1 to 13 tricks.`);
    g.bids[playerId] = bid;
    events.push({ type: 'bid', text: `${me} bids ${bidLabel(g, bid)}`, toast: bid === 0, playerId });
    if (g.players.every((id) => g.bids[id] != null)) {
      g.phase = 'play';
      g.turnIdx = g.leaderIdx;
    } else g.turnIdx = nextSeat(4, g.turnIdx);
    return ok(g, events);
  }

  if (type === 'play') {
    if (g.phase !== 'play') return fail(g.phase === 'bid' ? 'Bidding is not finished.' : 'Wait for the next trick.');
    if (current(g) !== playerId) return fail(`It's ${nameOf(g, current(g))}'s turn.`);
    const id = Array.isArray(action.cards) ? action.cards[0] : action.card;
    const card = g.hands[playerId].find((c) => c.id === id);
    if (!card) return fail("You don't have that card.");
    if (!legalPlays(g, playerId).some((c) => c.id === id)) {
      if (g.trick.length === 0) return fail("Spades haven't been broken — lead another suit.");
      return fail(`You must follow suit (${SUIT_NAMES[g.trick[0].card.suit]}).`);
    }
    g.hands[playerId] = g.hands[playerId].filter((c) => c.id !== id);
    g.trick.push({ playerId, card });
    events.push({ type: 'play', text: `${me} played ${cardLabel(card)}`, playerId, anim: { kind: 'toCenter', playerId, count: 1, cards: [card] } });
    if (card.suit === 'S' && !g.spadesBroken) {
      g.spadesBroken = true;
      events.push({ type: 'broken', toast: true, text: 'Spades are broken!' });
    }
    if (g.trick.length === 4) {
      const w = trickWinner(g.trick, 'S');
      g.tricks[w] += 1;
      g.lastTrickWinner = w;
      g.phase = 'trickEnd';
      g.autoAdvance = { delayMs: 1400, action: { type: 'collect' } };
      events.push({ type: 'trick', text: `${nameOf(g, w)} wins the trick` });
    } else g.turnIdx = nextSeat(4, g.turnIdx);
    return ok(g, events);
  }
  if (type === 'collect' || type === 'nextRound') return fail('That happens automatically.');
  return fail('Unknown action.');
}

export function getPlayerView(g, viewer) {
  let prompt;
  if (g.phase === 'over') prompt = 'Game over';
  else if (g.phase === 'roundEnd') prompt = 'Hand over — dealing the next one…';
  else if (g.phase === 'trickEnd') prompt = `${nameOf(g, g.lastTrickWinner)} wins the trick`;
  else if (current(g) === viewer) {
    const partner = g.players[(g.players.indexOf(viewer) + 2) % 4];
    prompt = g.phase === 'bid'
      ? `Your bid. Your partner ${nameOf(g, partner)} ${g.bids[partner] == null ? "hasn't bid yet" : `bid ${bidLabel(g, g.bids[partner])}`}.`
      : g.trick.length ? 'Your turn — follow suit if you can.' : 'Your lead.';
  } else prompt = `${nameOf(g, current(g))} to ${g.phase === 'bid' ? 'bid' : 'play'}`;

  const teamLabel = (t) => `${teamName(g, t)}: ${g.teamScores[t]}`;
  const contract = (t) => [g.players[t], g.players[t + 2]].reduce((s, id) => s + (g.bids[id] > 0 ? g.bids[id] : 0), 0);
  const won = (t) => g.tricks[g.players[t]] + g.tricks[g.players[t + 2]];

  const columns = [
    { key: 'round', label: 'Hand' },
    { key: 't0', label: teamName(g, 0) },
    { key: 't1', label: teamName(g, 1) },
  ];
  const rows = [...g.history, { _total: true, round: 'Total', t0: `${g.teamScores[0]} (${g.teamBags[0]} bags)`, t1: `${g.teamScores[1]} (${g.teamBags[1]} bags)` }];

  return {
    ...getPublicState(g),
    prompt,
    hand: sortHand(g.hands[viewer] ?? [], { trump: 'S' }),
    players: g.players.map((id) => ({
      id,
      cardCount: g.hands[id].length,
      stats: [
        { label: 'Bid', value: g.bids[id] == null ? '–' : bidLabel(g, g.bids[id]) },
        { label: 'Won', value: g.tricks[id] },
      ],
      badge: teamOf(g, id) === 0 ? 'Team A' : 'Team B',
    })),
    table: [{ id: 'trick', type: 'trick', plays: g.trick, winnerId: g.phase === 'trickEnd' ? g.lastTrickWinner : null, showNames: true }],
    info: [
      { label: 'Team A', value: g.teamScores[0] },
      { label: 'Team B', value: g.teamScores[1] },
      ...(g.phase !== 'bid' ? [{ label: 'A tricks', value: `${won(0)}/${contract(0)}` }, { label: 'B tricks', value: `${won(1)}/${contract(1)}` }] : []),
      { label: 'Spades', value: g.spadesBroken ? 'Broken' : 'Not broken' },
      { label: 'To', value: g.options.target },
    ],
    teams: [teamLabel(0), teamLabel(1)],
    scoreboard: { columns, rows },
    dealId: g.dealId,
  };
}

export function getResults(g) {
  const [a, b] = g.teamScores;
  const winTeam = a === b ? null : a > b ? 0 : 1;
  const rankings = g.players.map((id) => {
    const t = teamOf(g, id);
    return { playerId: id, place: winTeam == null || t === winTeam ? 1 : 2, score: g.teamScores[t], label: `Team ${t ? 'B' : 'A'} · ${g.teamScores[t]} pts` };
  });
  rankings.sort((x, y) => x.place - y.place);
  const winners = rankings.filter((r) => r.place === 1).map((r) => r.playerId);
  return {
    rankings,
    winners,
    summary: winTeam == null ? `It's a tie at ${a}!` : `${teamName(g, winTeam)} win ${Math.max(a, b)} to ${Math.min(a, b)}!`,
  };
}

/** Bot: bid high cards and long spades; play to make the team contract, duck when partner is winning. */
export function getAutoAction(g, playerId) {
  const legal = getLegalActions(g, playerId);
  if (!legal.length) return null;
  const hand = g.hands[playerId];
  if (g.phase === 'bid') {
    const spades = hand.filter((c) => c.suit === 'S');
    let est = hand.filter((c) => c.rank === 'A').length;
    est += hand.filter((c) => c.rank === 'K' && hand.filter((x) => x.suit === c.suit).length >= 2 && c.suit !== 'S').length;
    est += spades.filter((c) => rankValue(c.rank) >= 12 && c.rank !== 'A').length;
    est += Math.max(0, spades.length - 3);
    return { type: 'bid', bid: Math.max(1, Math.min(13, est)) };
  }
  const allowed = legal[0].cards.allowed;
  const cards = hand.filter((c) => allowed.includes(c.id));
  const power = (c) => rankValue(c.rank) + (c.suit === 'S' ? 100 : 0);
  const asc = cards.slice().sort((a, b) => power(a) - power(b));
  const t = teamOf(g, playerId);
  const partner = g.players[(g.players.indexOf(playerId) + 2) % 4];
  const need = [g.players[t], g.players[t + 2]].reduce((s, id) => s + (g.bids[id] > 0 ? g.bids[id] : 0), 0)
    - (g.tricks[g.players[t]] + g.tricks[g.players[t + 2]]);
  const nil = g.bids[playerId] === 0 && g.options.nil;
  const wins = (c) => trickWinner([...g.trick, { playerId, card: c }], 'S') === playerId;
  const partnerWinning = g.trick.length > 0 && trickWinner(g.trick, 'S') === partner;
  let pick;
  if (nil || need <= 0 || partnerWinning) {
    const losing = asc.filter((c) => !wins(c));
    pick = losing.length ? losing[losing.length - 1] : asc[0];
  } else {
    pick = asc.find(wins) ?? asc[0];
  }
  return { type: 'play', cards: [pick.id] };
}
