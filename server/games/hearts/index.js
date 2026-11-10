// Hearts — avoid taking hearts and the Queen of Spades. Lowest score wins.
import { SUIT_NAMES, cardLabel, cardsLabel, createDeck, deal, rankValue, shuffle, sortHand, takeCards } from '../../shared/cards.js';
import { SYSTEM, clone, fail, nameOf, namesMap, nextSeat, ok, rankPlayers } from '../../shared/engine.js';
import { trickWinner } from '../../shared/tricks.js';

export const meta = {
  id: 'hearts',
  name: 'Hearts',
  order: 6,
  minPlayers: 3,
  maxPlayers: 5,
  tagline: 'Dodge the hearts. Fear the Queen.',
  description: 'Pass three cards, then play tricks trying NOT to win hearts (1 point each) or the Queen of Spades (13). Take them all to shoot the moon. Lowest score wins.',
  options: [
    {
      key: 'target',
      label: 'Game ends at',
      type: 'select',
      default: 100,
      choices: [
        { value: 50, label: '50 points' },
        { value: 100, label: '100 points' },
      ],
    },
    { key: 'passing', label: 'Pass 3 cards before each hand', type: 'boolean', default: true },
    { key: 'moon', label: 'Shooting the moon (+26 to everyone else)', type: 'boolean', default: true },
    {
      key: 'firstTrickPoints',
      label: 'Allow point cards on the first trick',
      type: 'boolean',
      default: false,
    },
  ],
};

const EXCLUDE = { 3: ['2D'], 4: [], 5: ['2D', '2S'] };
const DIRECTIONS = { 4: ['left', 'right', 'across', 'hold'], other: ['left', 'right', 'hold'] };
const OFFSET = { left: 1, right: -1, across: 2, hold: 0 };
const DIR_LABEL = { left: 'Pass left', right: 'Pass right', across: 'Pass across', hold: 'No passing' };

export const points = (c) => (c.suit === 'H' ? 1 : c.id === 'QS' ? 13 : 0);
const current = (g) => g.players[g.turnIdx];
const sumPoints = (cards) => cards.reduce((s, c) => s + points(c), 0);

function startRound(g, events) {
  const n = g.players.length;
  const deck = shuffle(createDeck({ exclude: EXCLUDE[n] }), `${g.seed}:r${g.roundIdx}`);
  const { hands } = deal(deck, n);
  g.hands = Object.fromEntries(g.players.map((id, i) => [id, hands[i]]));
  g.roundPoints = Object.fromEntries(g.players.map((id) => [id, 0]));
  g.trick = [];
  g.trickNo = 0;
  g.heartsBroken = false;
  g.lastTrickWinner = null;
  g.dealId += 1;
  g.autoAdvance = null;
  const dirs = DIRECTIONS[n] ?? DIRECTIONS.other;
  g.passDir = g.options.passing ? dirs[g.roundIdx % dirs.length] : 'hold';
  if (g.passDir === 'hold') {
    events.push({ type: 'deal', toast: true, text: `Hand ${g.roundIdx + 1}: no passing this time` });
    startPlay(g, events);
  } else {
    g.phase = 'pass';
    g.passed = Object.fromEntries(g.players.map((id) => [id, null]));
    events.push({ type: 'deal', toast: true, text: `Hand ${g.roundIdx + 1}: ${DIR_LABEL[g.passDir].toLowerCase()} — choose 3 cards` });
  }
}

function startPlay(g, events) {
  g.phase = 'play';
  g.passed = null;
  g.turnIdx = g.players.findIndex((id) => g.hands[id].some((c) => c.id === '2C'));
  g.leaderIdx = g.turnIdx;
  events.push({ type: 'lead', text: `${nameOf(g, current(g))} has the 2♣ and leads` });
}

export function createGame(players, options = {}) {
  const n = players.length;
  if (n < meta.minPlayers || n > meta.maxPlayers) throw new Error('Hearts needs 3-5 players');
  const g = {
    game: 'hearts',
    players: players.map((p) => p.id),
    names: namesMap(players),
    options: {
      target: options.target === 50 ? 50 : 100,
      passing: options.passing !== false,
      moon: options.moon !== false,
      firstTrickPoints: Boolean(options.firstTrickPoints),
    },
    seed: options.seed ?? 'hearts',
    roundIdx: 0,
    scores: Object.fromEntries(players.map((p) => [p.id, 0])),
    history: [],
    dealId: 0,
  };
  startRound(g, []);
  return g;
}

export const isGameOver = (g) => g.phase === 'over';

export function legalPlays(g, playerId) {
  const hand = g.hands[playerId];
  if (g.trick.length === 0) {
    if (g.trickNo === 0) return hand.filter((c) => c.id === '2C');
    if (!g.heartsBroken) {
      const nonHearts = hand.filter((c) => c.suit !== 'H');
      if (nonHearts.length) return nonHearts;
    }
    return hand.slice();
  }
  const led = g.trick[0].card.suit;
  const follow = hand.filter((c) => c.suit === led);
  if (follow.length) return follow;
  if (g.trickNo === 0 && !g.options.firstTrickPoints) {
    const safe = hand.filter((c) => points(c) === 0);
    if (safe.length) return safe;
  }
  return hand.slice();
}

export function getPublicState(g) {
  return {
    phase: g.phase,
    turn: g.phase === 'play' ? current(g) : null,
    passDir: g.passDir,
    heartsBroken: g.heartsBroken,
    trick: g.trick,
    roundPoints: g.roundPoints,
    scores: g.scores,
    players: g.players.map((id) => ({ id, cardCount: g.hands[id].length })),
  };
}

export function getLegalActions(g, playerId) {
  if (!g.players.includes(playerId)) return [];
  if (g.phase === 'pass' && g.passed[playerId] == null) {
    return [
      {
        type: 'pass',
        label: DIR_LABEL[g.passDir],
        style: 'primary',
        cards: { min: 3, max: 3, allowed: g.hands[playerId].map((c) => c.id) },
      },
    ];
  }
  if (g.phase === 'play' && current(g) === playerId) {
    return [{ type: 'play', label: 'Play card', style: 'primary', cards: { min: 1, max: 1, allowed: legalPlays(g, playerId).map((c) => c.id) } }];
  }
  return [];
}

function endRound(g, events) {
  const shooter = g.players.find((id) => g.roundPoints[id] === 26);
  const added = {};
  if (shooter && g.options.moon) {
    for (const id of g.players) added[id] = id === shooter ? 0 : 26;
    events.push({ type: 'moon', toast: true, tone: 'good', text: `${nameOf(g, shooter)} shot the moon! Everyone else gets 26.` });
  } else {
    for (const id of g.players) added[id] = g.roundPoints[id];
  }
  for (const id of g.players) g.scores[id] += added[id];
  g.history.push({ round: g.roundIdx + 1, points: added });
  events.push({ type: 'roundEnd', text: `Hand ${g.roundIdx + 1}: ${g.players.map((id) => `${nameOf(g, id)} +${added[id]}`).join(', ')}` });
  if (Math.max(...Object.values(g.scores)) >= g.options.target) {
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
      events.push({ type: 'collect', anim: { kind: 'toSeat', playerId: w, count: g.trick.length } });
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
      startRound(g, events);
      return ok(g, events);
    }
    return fail('Nothing to advance.');
  }

  if (!g.players.includes(playerId)) return fail('You are not playing in this game.');
  if (g.phase === 'over') return fail('The game is over.');
  const me = nameOf(g, playerId);

  if (type === 'pass') {
    if (g.phase !== 'pass') return fail('It is not time to pass cards.');
    if (g.passed[playerId]) return fail('You already passed your cards.');
    const ids = Array.isArray(action.cards) ? action.cards : [];
    if (ids.length !== 3) return fail('Choose exactly 3 cards to pass.');
    const taken = takeCards(g.hands[playerId], ids);
    if (!taken) return fail("You don't have those cards.");
    g.hands[playerId] = taken.hand;
    g.passed[playerId] = taken.taken;
    events.push({ type: 'passed', text: `${me} chose cards to pass`, playerId });
    if (g.players.every((id) => g.passed[id])) {
      const n = g.players.length;
      g.players.forEach((from, i) => {
        const to = g.players[(i + OFFSET[g.passDir] + n) % n];
        g.hands[to].push(...g.passed[from]);
        events.push({ type: 'received', to, text: `You received ${cardsLabel(g.passed[from])} from ${nameOf(g, from)}` });
      });
      events.push({ type: 'passDone', toast: true, text: 'Cards passed — let the hand begin!' });
      g.dealId += 1;
      startPlay(g, events);
    }
    return ok(g, events);
  }

  if (type === 'play') {
    if (g.phase !== 'play') return fail(g.phase === 'pass' ? 'Pass your cards first.' : 'Wait for the next trick.');
    if (current(g) !== playerId) return fail(`It's ${nameOf(g, current(g))}'s turn.`);
    const id = Array.isArray(action.cards) ? action.cards[0] : action.card;
    const card = g.hands[playerId].find((c) => c.id === id);
    if (!card) return fail("You don't have that card.");
    if (!legalPlays(g, playerId).some((c) => c.id === id)) {
      if (g.trick.length === 0 && g.trickNo === 0) return fail('The first trick must be led with the 2♣.');
      if (g.trick.length === 0) return fail("Hearts haven't been broken yet — lead another suit.");
      if (g.hands[playerId].some((c) => c.suit === g.trick[0].card.suit)) return fail(`You must follow suit (${SUIT_NAMES[g.trick[0].card.suit]}).`);
      return fail("No points on the first trick — play a card that isn't a heart or the Q♠.");
    }
    g.hands[playerId] = g.hands[playerId].filter((c) => c.id !== id);
    g.trick.push({ playerId, card });
    events.push({ type: 'play', text: `${me} played ${cardLabel(card)}`, playerId, anim: { kind: 'toCenter', playerId, count: 1, cards: [card] } });
    if (card.suit === 'H' && !g.heartsBroken) {
      g.heartsBroken = true;
      events.push({ type: 'broken', toast: true, text: 'Hearts are broken!' });
    }
    if (card.id === 'QS') events.push({ type: 'queen', toast: true, tone: 'bad', text: `${me} dropped the Queen of Spades!` });
    if (g.trick.length === g.players.length) {
      const w = trickWinner(g.trick, null);
      const pts = sumPoints(g.trick.map((p) => p.card));
      g.roundPoints[w] += pts;
      g.trickNo += 1;
      g.lastTrickWinner = w;
      g.phase = 'trickEnd';
      g.autoAdvance = { delayMs: 1400, action: { type: 'collect' } };
      events.push({ type: 'trick', text: `${nameOf(g, w)} takes the trick${pts ? ` (+${pts} point${pts > 1 ? 's' : ''})` : ''}` });
    } else {
      g.turnIdx = nextSeat(g.players.length, g.turnIdx);
    }
    return ok(g, events);
  }

  if (type === 'collect' || type === 'nextRound') return fail('That happens automatically.');
  return fail('Unknown action.');
}

export function getPlayerView(g, viewer) {
  let prompt;
  if (g.phase === 'over') prompt = 'Game over';
  else if (g.phase === 'pass') {
    prompt = g.passed[viewer] ? 'Waiting for everyone to pass…' : `${DIR_LABEL[g.passDir]}: select 3 cards to give away.`;
  } else if (g.phase === 'roundEnd') prompt = 'Hand over — dealing the next one…';
  else if (g.phase === 'trickEnd') prompt = `${nameOf(g, g.lastTrickWinner)} takes the trick`;
  else if (current(g) === viewer) {
    if (g.trick.length === 0 && g.trickNo === 0) prompt = 'You have the 2♣ — lead it.';
    else prompt = g.trick.length ? 'Your turn — follow suit if you can.' : 'Your lead.';
  } else prompt = `${nameOf(g, current(g))} to play`;

  const columns = [{ key: 'round', label: 'Hand' }, ...g.players.map((id) => ({ key: id, label: nameOf(g, id) }))];
  const rows = g.history.map((h) => ({ round: h.round, ...h.points }));
  rows.push({ _total: true, round: 'Total', ...g.scores });

  return {
    ...getPublicState(g),
    prompt,
    hand: sortHand(g.hands[viewer] ?? []),
    players: g.players.map((id) => ({
      id,
      cardCount: g.hands[id].length,
      stats: [
        { label: 'Hand', value: g.roundPoints[id] },
        { label: 'Total', value: g.scores[id] },
      ],
      badge: g.phase === 'pass' && g.passed?.[id] ? '✓ passed' : undefined,
    })),
    table: [{ id: 'trick', type: 'trick', plays: g.trick, winnerId: g.phase === 'trickEnd' ? g.lastTrickWinner : null, showNames: true }],
    info: [
      { label: 'Hand', value: g.roundIdx + 1 },
      { label: 'Passing', value: DIR_LABEL[g.passDir].replace('Pass ', '') },
      { label: 'Hearts', value: g.heartsBroken ? 'Broken' : 'Not broken' },
      { label: 'Ends at', value: g.options.target },
    ],
    scoreboard: { columns, rows },
    dealId: g.dealId,
  };
}

export function getResults(g) {
  const { rankings, winners } = rankPlayers(g.players, (id) => g.scores[id], { lowWins: true, label: (id) => `${g.scores[id]} pts` });
  return { rankings, winners, summary: `${winners.map((id) => nameOf(g, id)).join(' & ')} win${winners.length > 1 ? '' : 's'} with only ${g.scores[winners[0]]} points!` };
}

function danger(c) {
  if (c.id === 'QS') return 100;
  if (c.suit === 'S' && (c.rank === 'A' || c.rank === 'K')) return 90;
  return (c.suit === 'H' ? 20 : 0) + rankValue(c.rank);
}

/** Bot: pass dangerous cards, duck under the winning card, dump points when void. */
export function getAutoAction(g, playerId) {
  const legal = getLegalActions(g, playerId);
  if (!legal.length) return null;
  if (legal[0].type === 'pass') {
    const pick = g.hands[playerId].slice().sort((a, b) => danger(b) - danger(a)).slice(0, 3);
    return { type: 'pass', cards: pick.map((c) => c.id) };
  }
  const cards = legalPlays(g, playerId);
  const asc = cards.slice().sort((a, b) => points(a) - points(b) || rankValue(a.rank) - rankValue(b.rank));
  if (!g.trick.length) return { type: 'play', cards: [asc[0].id] };
  const led = g.trick[0].card.suit;
  if (cards[0].suit === led) {
    const high = Math.max(...g.trick.filter((p) => p.card.suit === led).map((p) => rankValue(p.card.rank)));
    const below = cards.filter((c) => rankValue(c.rank) < high).sort((a, b) => rankValue(b.rank) - rankValue(a.rank));
    return { type: 'play', cards: [(below[0] ?? asc[0]).id] };
  }
  const queen = cards.find((c) => c.id === 'QS');
  if (queen) return { type: 'play', cards: [queen.id] };
  const desc = cards.slice().sort((a, b) => danger(b) - danger(a));
  return { type: 'play', cards: [desc[0].id] };
}
