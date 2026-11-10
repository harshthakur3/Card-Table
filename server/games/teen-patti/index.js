// Teen Patti (three-card brag) with play chips only — no real money, nothing to buy.
import { cardsLabel, createDeck, deal, rankValue, shuffle, sortHand } from '../../shared/cards.js';
import { SYSTEM, clone, fail, nameOf, namesMap, nextSeat, ok, rankPlayers } from '../../shared/engine.js';

export const meta = {
  id: 'teen-patti',
  name: 'Teen Patti',
  order: 10,
  minPlayers: 3,
  maxPlayers: 6,
  tagline: 'Three cards, blind bets, big bluffs. Play chips only.',
  description: 'Each player gets three cards and bets with play chips — blind (without looking) or seen. Pack, chaal, or ask for a show. Best three-card hand takes the pot.',
  options: [
    {
      key: 'boot',
      label: 'Boot (ante)',
      type: 'select',
      default: 10,
      choices: [10, 20, 50].map((v) => ({ value: v, label: `${v} chips` })),
    },
    {
      key: 'startChips',
      label: 'Starting chips',
      type: 'select',
      default: 1000,
      choices: [500, 1000, 2000].map((v) => ({ value: v, label: `${v}` })),
    },
    {
      key: 'hands',
      label: 'Number of hands',
      type: 'select',
      default: 10,
      choices: [5, 10, 20].map((v) => ({ value: v, label: `${v} hands` })),
    },
    {
      key: 'potLimit',
      label: 'Pot limit (automatic show)',
      type: 'select',
      default: 128,
      choices: [
        { value: 64, label: '64 × boot' },
        { value: 128, label: '128 × boot' },
        { value: 0, label: 'No limit' },
      ],
    },
  ],
};

export const HAND_NAMES = { 6: 'Trail', 5: 'Pure sequence', 4: 'Sequence', 3: 'Colour', 2: 'Pair', 1: 'High card' };
const STAKE_CAP_MULT = 32;

/** Hand strength as a comparable array: [category, tiebreakers...]. */
export function evaluate(cards) {
  const vals = cards.map((c) => rankValue(c.rank)).sort((a, b) => b - a);
  const suited = cards.every((c) => c.suit === cards[0].suit);
  if (vals[0] === vals[1] && vals[1] === vals[2]) return [6, vals[0]];
  let seq = null;
  if (vals[0] - 1 === vals[1] && vals[1] - 1 === vals[2]) seq = vals[0] === 14 ? 15 : vals[0]; // A-K-Q is the top run
  else if (vals[0] === 14 && vals[1] === 3 && vals[2] === 2) seq = 14; // A-2-3 is second
  if (seq && suited) return [5, seq];
  if (seq) return [4, seq];
  if (suited) return [3, ...vals];
  if (vals[0] === vals[1]) return [2, vals[0], vals[2]];
  if (vals[1] === vals[2]) return [2, vals[1], vals[0]];
  return [1, ...vals];
}

export function compareHands(a, b) {
  const x = evaluate(a);
  const y = evaluate(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

const current = (g) => g.players[g.turnIdx];
const active = (g) => g.inHand.filter((id) => !g.folded[id]);
const bettors = (g) => active(g).filter((id) => !g.allIn[id]);
const describe = (cards) => `${HAND_NAMES[evaluate(cards)[0]]} (${cardsLabel(sortHand(cards, { by: 'rank' }).reverse())})`;

function costs(g, id) {
  const call = g.seen[id] ? 2 * g.stake : g.stake;
  const canRaise = g.stake * 2 <= g.options.boot * STAKE_CAP_MULT;
  return { call, raise: canRaise ? call * 2 : null };
}

function startHand(g, events) {
  g.inHand = g.players.filter((id) => g.chips[id] >= g.options.boot);
  if (g.inHand.length < 2) {
    g.phase = 'over';
    g.autoAdvance = null;
    return;
  }
  const deck = shuffle(createDeck(), `${g.seed}:hand${g.handIdx}`);
  const { hands } = deal(deck, g.inHand.length, 3);
  g.hands = Object.fromEntries(g.players.map((id) => [id, []]));
  g.inHand.forEach((id, i) => {
    g.hands[id] = hands[i];
  });
  g.pot = 0;
  for (const id of g.inHand) {
    g.chips[id] -= g.options.boot;
    g.pot += g.options.boot;
  }
  g.seen = Object.fromEntries(g.players.map((id) => [id, false]));
  g.folded = Object.fromEntries(g.players.map((id) => [id, !g.inHand.includes(id)]));
  g.allIn = Object.fromEntries(g.players.map((id) => [id, false]));
  g.stake = g.options.boot;
  g.lastResult = null;
  g.turnIdx = nextSeat(g.players.length, g.dealerIdx, (i) => g.inHand.includes(g.players[i]));
  g.phase = 'bet';
  g.dealId += 1;
  g.autoAdvance = null;
  events.push({ type: 'deal', toast: true, text: `Hand ${g.handIdx + 1} of ${g.options.hands}: boot ${g.options.boot} each — pot ${g.pot}` });
}

export function createGame(players, options = {}) {
  const n = players.length;
  if (n < meta.minPlayers || n > meta.maxPlayers) throw new Error('Teen Patti needs 3-6 players');
  const boot = [10, 20, 50].includes(options.boot) ? options.boot : 10;
  const startChips = [500, 1000, 2000].includes(options.startChips) ? options.startChips : 1000;
  const mult = [0, 64, 128].includes(options.potLimit) ? options.potLimit : 128;
  const g = {
    game: 'teen-patti',
    players: players.map((p) => p.id),
    names: namesMap(players),
    options: { boot, startChips, hands: [5, 10, 20].includes(options.hands) ? options.hands : 10, potLimit: mult ? mult * boot : 0 },
    seed: options.seed ?? 'teen-patti',
    chips: Object.fromEntries(players.map((p) => [p.id, startChips])),
    handIdx: 0,
    dealerIdx: 0,
    history: [],
    dealId: 0,
  };
  startHand(g, []);
  return g;
}

export const isGameOver = (g) => g.phase === 'over';

function finishHand(g, winners, reason, revealIds, events) {
  const share = Math.floor(g.pot / winners.length);
  let rest = g.pot - share * winners.length;
  for (const id of winners) {
    g.chips[id] += share + (rest > 0 ? 1 : 0);
    rest -= 1;
  }
  g.lastResult = {
    winners,
    reason,
    pot: g.pot,
    revealed: Object.fromEntries(revealIds.map((id) => [id, g.hands[id]])),
  };
  const names = winners.map((id) => nameOf(g, id)).join(' & ');
  const how = revealIds.length ? ` with ${describe(g.hands[winners[0]])}` : '';
  events.push({ type: 'win', toast: true, tone: 'good', text: `${names} win${winners.length > 1 ? '' : 's'} the pot of ${g.pot}${how}`, anim: { kind: 'toSeat', playerId: winners[0], count: 4 } });
  g.history.push({ hand: g.handIdx + 1, winners, pot: g.pot, reason });
  g.pot = 0;
  g.handIdx += 1;
  const solvent = g.players.filter((id) => g.chips[id] >= g.options.boot).length;
  if (g.handIdx >= g.options.hands || solvent < 2) {
    g.phase = 'over';
    g.autoAdvance = null;
  } else {
    g.phase = 'handEnd';
    g.autoAdvance = { delayMs: 5500, action: { type: 'nextHand' } };
  }
}

function showdown(g, ids, reason, events) {
  let best = [ids[0]];
  for (const id of ids.slice(1)) {
    const c = compareHands(g.hands[id], g.hands[best[0]]);
    if (c > 0) best = [id];
    else if (c === 0) best.push(id);
  }
  events.push({ type: 'showdown', toast: true, text: `Show! ${ids.map((id) => `${nameOf(g, id)}: ${describe(g.hands[id])}`).join(' · ')}` });
  finishHand(g, best, reason, ids, events);
}

/** After a bet/pack: end the hand or move to the next bettor. */
function afterMove(g, events) {
  const act = active(g);
  if (act.length === 1) {
    finishHand(g, act, 'everyone else packed', [], events);
    return;
  }
  if (g.options.potLimit && g.pot >= g.options.potLimit) {
    events.push({ type: 'limit', toast: true, text: `Pot limit of ${g.options.potLimit} reached — automatic show!` });
    showdown(g, act, 'pot limit', events);
    return;
  }
  const b = bettors(g);
  if (b.length === 0 || (b.length === 1 && act.length > 1 && act.every((id) => id === b[0] || g.allIn[id]))) {
    showdown(g, act, 'all-in', events);
    return;
  }
  g.turnIdx = nextSeat(g.players.length, g.turnIdx, (i) => b.includes(g.players[i]));
}

export function getPublicState(g) {
  return {
    phase: g.phase,
    turn: g.phase === 'bet' ? current(g) : null,
    pot: g.pot,
    stake: g.stake,
    chips: g.chips,
    hand: g.handIdx + 1,
    players: g.players.map((id) => ({
      id,
      cardCount: g.inHand?.includes(id) && !g.folded[id] ? 3 : 0,
      seen: g.seen?.[id] ?? false,
      folded: g.folded?.[id] ?? true,
      allIn: g.allIn?.[id] ?? false,
    })),
    lastResult: g.lastResult,
  };
}

export function getLegalActions(g, playerId) {
  if (g.phase !== 'bet' || !g.inHand.includes(playerId) || g.folded[playerId]) return [];
  const out = [];
  if (!g.seen[playerId]) out.push({ type: 'see', label: 'See cards', style: 'secondary', optional: true });
  if (current(g) !== playerId || g.allIn[playerId]) return out;
  const { call, raise } = costs(g, playerId);
  const chips = g.chips[playerId];
  const blind = !g.seen[playerId];
  const amounts = [];
  if (chips >= call) amounts.push({ value: 'call', label: `${blind ? 'Blind' : 'Chaal'} ${call}` });
  if (raise && chips >= raise) amounts.push({ value: 'raise', label: `Raise ${raise}` });
  if (chips < call && chips > 0) amounts.push({ value: 'allin', label: `All-in ${chips}` });
  if (amounts.length) {
    out.push({
      type: 'bet',
      label: 'Bet',
      style: 'primary',
      params: [{ name: 'amount', label: blind ? 'Blind bet' : 'Chaal', type: 'choice', options: amounts, default: amounts[0].value }],
    });
  }
  if (active(g).length === 2 && chips > 0) {
    out.push({ type: 'show', label: `Show (${Math.min(call, chips)})`, style: 'secondary' });
  }
  out.push({ type: 'pack', label: 'Pack', style: 'danger' });
  return out;
}

export function applyAction(game, playerId, action) {
  const g = clone(game);
  const events = [];
  const type = action?.type;
  if (playerId === SYSTEM) {
    if (type === 'nextHand' && g.phase === 'handEnd') {
      g.dealerIdx = (g.dealerIdx + 1) % g.players.length;
      startHand(g, events);
      return ok(g, events);
    }
    return fail('Nothing to advance.');
  }
  if (!g.players.includes(playerId)) return fail('You are not playing in this game.');
  if (g.phase !== 'bet') return fail(g.phase === 'over' ? 'The game is over.' : 'Wait for the next hand.');
  if (!g.inHand.includes(playerId)) return fail('You are out of chips for this hand.');
  if (g.folded[playerId]) return fail('You already packed this hand.');
  const me = nameOf(g, playerId);

  if (type === 'see') {
    if (g.seen[playerId]) return fail('You have already seen your cards.');
    g.seen[playerId] = true;
    events.push({ type: 'see', text: `${me} looked at their cards`, playerId });
    events.push({ type: 'seen', to: playerId, text: `Your cards: ${describe(g.hands[playerId])}` });
    return ok(g, events);
  }

  if (current(g) !== playerId) return fail(`It's ${nameOf(g, current(g))}'s turn.`);
  if (g.allIn[playerId]) return fail('You are all-in.');
  const { call, raise } = costs(g, playerId);

  if (type === 'pack') {
    g.folded[playerId] = true;
    events.push({ type: 'pack', toast: true, text: `${me} packed`, playerId });
    afterMove(g, events);
    return ok(g, events);
  }

  if (type === 'bet') {
    const chips = g.chips[playerId];
    let amt;
    if (action.amount === 'call') amt = call;
    else if (action.amount === 'raise') {
      if (!raise) return fail('The stake is already at its limit — you can only call.');
      amt = raise;
    } else if (action.amount === 'allin') {
      if (chips >= call) return fail('You have enough chips to call.');
      amt = chips;
    } else return fail('Choose how much to bet.');
    if (amt > chips) return fail(`You only have ${chips} chips.`);
    g.chips[playerId] -= amt;
    g.pot += amt;
    if (action.amount === 'raise') g.stake *= 2;
    if (g.chips[playerId] === 0) g.allIn[playerId] = true;
    const blind = !g.seen[playerId];
    const word = action.amount === 'raise' ? 'raised to' : action.amount === 'allin' ? 'went all-in with' : blind ? 'bet blind' : 'chaal';
    events.push({ type: 'bet', text: `${me} ${word} ${amt}`, toast: action.amount !== 'call', playerId, anim: { kind: 'toCenter', playerId, count: 1 } });
    afterMove(g, events);
    return ok(g, events);
  }

  if (type === 'show') {
    const act = active(g);
    if (act.length !== 2) return fail('You can only ask for a show when two players are left.');
    const amt = Math.min(call, g.chips[playerId]);
    g.chips[playerId] -= amt;
    g.pot += amt;
    const other = act.find((id) => id !== playerId);
    events.push({ type: 'show', toast: true, text: `${me} asks ${nameOf(g, other)} for a show (${amt})` });
    const c = compareHands(g.hands[playerId], g.hands[other]);
    // On a tie, the player who asked for the show loses.
    const winner = c > 0 ? playerId : other;
    events.push({ type: 'showdown', toast: true, text: `${me}: ${describe(g.hands[playerId])} vs ${nameOf(g, other)}: ${describe(g.hands[other])}` });
    finishHand(g, [winner], 'show', [playerId, other], events);
    return ok(g, events);
  }
  return fail('Unknown action.');
}

export function getPlayerView(g, viewer) {
  const inHand = g.inHand?.includes(viewer);
  const revealed = g.lastResult?.revealed ?? {};
  const mineVisible = inHand && (g.seen[viewer] || revealed[viewer]);
  const hand = !inHand
    ? []
    : mineVisible
      ? sortHand(g.hands[viewer], { by: 'rank' })
      : [0, 1, 2].map((i) => ({ id: `blind${i}`, faceDown: true }));

  let prompt;
  if (g.phase === 'over') prompt = 'Game over';
  else if (g.phase === 'handEnd') prompt = `${g.lastResult.winners.map((id) => nameOf(g, id)).join(' & ')} won ${g.lastResult.pot} — next hand soon…`;
  else if (!inHand) prompt = 'You are out of chips — watching.';
  else if (g.folded[viewer]) prompt = 'You packed — waiting for the hand to finish.';
  else if (current(g) === viewer) {
    const { call } = costs(g, viewer);
    prompt = g.seen[viewer]
      ? `Your turn: chaal ${call}, raise, ${active(g).length === 2 ? 'show, ' : ''}or pack.`
      : `Your turn (blind): bet ${call} without looking, see your cards, or pack.`;
  } else prompt = `${nameOf(g, current(g))} to bet`;

  const statusOf = (id) => {
    if (!g.inHand?.includes(id)) return 'Out';
    if (g.folded[id]) return 'Packed';
    if (g.allIn[id]) return 'All-in';
    return g.seen[id] ? 'Seen' : 'Blind';
  };

  const table = [{ id: 'pot', type: 'text', label: 'Pot', text: g.phase === 'handEnd' ? `${g.lastResult.pot} → ${g.lastResult.winners.map((id) => nameOf(g, id)).join(' & ')}` : String(g.pot) }];
  if (g.phase === 'handEnd' && Object.keys(revealed).length) {
    const w = g.lastResult.winners[0];
    table.push({ id: 'winning', type: 'cards', label: `${nameOf(g, w)}: ${HAND_NAMES[evaluate(revealed[w])[0]]}`, cards: sortHand(revealed[w], { by: 'rank' }), tone: 'good' });
  }

  return {
    ...getPublicState(g),
    prompt,
    hand,
    handNote: inHand ? '' : 'Out of chips',
    players: g.players.map((id) => ({
      id,
      cardCount: g.inHand?.includes(id) && !g.folded[id] ? 3 : 0,
      stats: [{ label: 'Chips', value: g.chips[id] }],
      badge: g.phase === 'bet' ? statusOf(id) : undefined,
      status: g.folded?.[id] && g.inHand?.includes(id) && g.phase === 'bet' ? 'folded' : g.lastResult?.winners.includes(id) && g.phase !== 'bet' ? 'winner' : undefined,
      faceUp: revealed[id] ? sortHand(revealed[id], { by: 'rank' }) : undefined,
    })),
    table,
    info: [
      { label: 'Hand', value: `${Math.min(g.handIdx + 1, g.options.hands)}/${g.options.hands}` },
      { label: 'Pot', value: g.pot },
      { label: 'Stake', value: g.stake },
      { label: 'Boot', value: g.options.boot },
      ...(g.options.potLimit ? [{ label: 'Pot limit', value: g.options.potLimit }] : []),
    ],
    dealId: g.dealId,
  };
}

export function getResults(g) {
  const { rankings, winners } = rankPlayers(g.players, (id) => g.chips[id], { label: (id) => `${g.chips[id]} chips` });
  return { rankings, winners, summary: `${winners.map((id) => nameOf(g, id)).join(' & ')} finish${winners.length > 1 ? '' : 'es'} with ${g.chips[winners[0]]} chips!` };
}

/** Bot: looks at its cards, raises strong hands, calls fair ones, packs weak ones. */
export function getAutoAction(g, playerId) {
  const legal = getLegalActions(g, playerId);
  if (!legal.length) return null;
  if (current(g) !== playerId) return null;
  if (!g.seen[playerId]) return { type: 'see' };
  const [cat, high] = evaluate(g.hands[playerId]);
  const has = (t) => legal.some((a) => a.type === t);
  if (has('show') && cat >= 2) return { type: 'show' };
  const bet = legal.find((a) => a.type === 'bet');
  const opts = bet ? bet.params[0].options.map((o) => o.value) : [];
  if (opts.includes('allin')) return cat >= 2 ? { type: 'bet', amount: 'allin' } : { type: 'pack' };
  if (cat >= 3 && opts.includes('raise') && g.stake < g.options.boot * 8) return { type: 'bet', amount: 'raise' };
  if (cat >= 2 && opts.includes('call')) return { type: 'bet', amount: 'call' };
  if (cat === 1 && high >= 13 && g.stake <= g.options.boot * 2 && opts.includes('call')) return { type: 'bet', amount: 'call' };
  if (has('show') && high >= 12) return { type: 'show' };
  return { type: 'pack' };
}
