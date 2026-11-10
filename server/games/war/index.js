// War — flip the top card; highest takes the lot. Ties mean WAR.
import { cardLabel, createDeck, deal, rankName, rankValue, shuffle } from '../../shared/cards.js';
import { SYSTEM, clone, fail, nameOf, namesMap, ok, rankPlayers } from '../../shared/engine.js';

const HARD_CAP = 3000;

export const meta = {
  id: 'war',
  name: 'War',
  order: 5,
  minPlayers: 2,
  maxPlayers: 4,
  tagline: 'Pure luck, maximum drama.',
  description: 'Everyone flips their top card at once — the highest card wins them all. A tie means war: three cards face down, then flip again.',
  options: [
    {
      key: 'maxBattles',
      label: 'Game length',
      type: 'select',
      default: 150,
      choices: [
        { value: 50, label: 'Quick — 50 battles' },
        { value: 150, label: 'Normal — 150 battles' },
        { value: 400, label: 'Long — 400 battles' },
        { value: 0, label: 'Until someone has every card' },
      ],
      help: 'When the limit is reached, whoever holds the most cards wins.',
    },
    {
      key: 'autoFlip',
      label: 'Auto-flip (cards flip by themselves)',
      type: 'boolean',
      default: false,
    },
    {
      key: 'warCards',
      label: 'Face-down cards in a war',
      type: 'select',
      default: 3,
      choices: [1, 2, 3].map((n) => ({ value: n, label: `${n}` })),
    },
  ],
};

const alive = (g) => g.players.filter((id) => g.piles[id].length > 0);

export function createGame(players, options = {}) {
  const n = players.length;
  if (n < meta.minPlayers || n > meta.maxPlayers) throw new Error('War needs 2-4 players');
  const seed = options.seed ?? 'war';
  // 52 doesn't split evenly for 3 players: drop the 2♣ so everyone starts equal.
  const deck = shuffle(createDeck({ exclude: n === 3 ? ['2C'] : [] }), `${seed}:deal`);
  const { hands } = deal(deck, n);
  const maxBattles = [50, 150, 400, 0].includes(Number(options.maxBattles)) ? Number(options.maxBattles) : 150;
  return {
    game: 'war',
    players: players.map((p) => p.id),
    names: namesMap(players),
    options: { maxBattles, autoFlip: Boolean(options.autoFlip), warCards: [1, 2, 3].includes(options.warCards) ? options.warCards : 3 },
    seed,
    piles: Object.fromEntries(players.map((p, i) => [p.id, hands[i]])),
    contenders: players.map((p) => p.id),
    flips: {},
    pot: [],
    atWar: false,
    battles: 0,
    lastBattle: null,
    winner: null,
    phase: 'flip',
    dealId: 1,
    autoAdvance: options.autoFlip ? { delayMs: 1200, action: { type: 'flipAll' } } : null,
  };
}

export const isGameOver = (g) => g.phase === 'over';

function flipFor(g, playerId) {
  const card = g.piles[playerId].shift();
  g.flips[playerId] = card;
}

function finishIfDone(g, events) {
  const left = alive(g);
  const limit = g.options.maxBattles || HARD_CAP;
  if (left.length <= 1 || g.battles >= limit) {
    g.phase = 'over';
    g.autoAdvance = null;
    const top = Math.max(...g.players.map((id) => g.piles[id].length));
    const leaders = g.players.filter((id) => g.piles[id].length === top);
    g.winner = leaders.length === 1 ? leaders[0] : null;
    events.push({
      type: 'end',
      toast: true,
      text: left.length <= 1 ? `${nameOf(g, left[0])} has captured every card!` : `Battle limit reached — most cards wins.`,
    });
    return true;
  }
  return false;
}

function resolve(g, events) {
  const plays = g.contenders.map((id) => ({ playerId: id, card: g.flips[id] }));
  g.pot.push(...plays.map((p) => p.card));
  const best = Math.max(...plays.map((p) => rankValue(p.card.rank)));
  const tied = plays.filter((p) => rankValue(p.card.rank) === best).map((p) => p.playerId);
  g.flips = {};
  g.battles += 1;

  if (tied.length === 1) {
    const w = tied[0];
    const won = shuffle(g.pot, `${g.seed}:pot${g.battles}`);
    g.piles[w].push(...won);
    g.lastBattle = { plays, winnerId: w, war: g.atWar };
    events.push({
      type: 'battle',
      toast: g.atWar,
      text: `${nameOf(g, w)} wins ${g.atWar ? 'the war' : 'the battle'} with ${cardLabel(plays.find((p) => p.playerId === w).card)} (+${won.length} cards)`,
      anim: { kind: 'toSeat', playerId: w, count: won.length },
    });
    g.pot = [];
    g.atWar = false;
    for (const id of g.players) {
      if (g.piles[id].length === 0 && g.contenders.includes(id) && id !== w) {
        events.push({ type: 'out', toast: true, text: `${nameOf(g, id)} is out of cards!` });
      }
    }
    g.contenders = alive(g);
  } else {
    g.lastBattle = { plays, winnerId: null, war: true };
    events.push({ type: 'war', toast: true, text: `WAR! ${tied.map((id) => nameOf(g, id)).join(' and ')} tie with ${rankName(plays.find((p) => p.playerId === tied[0]).card.rank, 2)}` });
    g.atWar = true;
    const stillIn = [];
    for (const id of tied) {
      const down = Math.min(g.options.warCards, Math.max(0, g.piles[id].length - 1));
      g.pot.push(...g.piles[id].splice(0, down));
      if (g.piles[id].length > 0) stillIn.push(id);
    }
    if (stillIn.length === 0) {
      // Everyone in the war ran out: share the pot between them so the game can go on.
      const pot = shuffle(g.pot, `${g.seed}:split${g.battles}`);
      pot.forEach((c, i) => g.piles[tied[i % tied.length]].push(c));
      g.pot = [];
      g.atWar = false;
      g.contenders = alive(g);
    } else if (stillIn.length === 1) {
      const w = stillIn[0];
      g.piles[w].push(...g.pot);
      events.push({ type: 'battle', toast: true, text: `${nameOf(g, w)} wins the war — the others ran out of cards` });
      g.pot = [];
      g.atWar = false;
      g.contenders = alive(g);
    } else {
      g.contenders = stillIn;
    }
  }
  if (!finishIfDone(g, events)) {
    g.autoAdvance = g.options.autoFlip ? { delayMs: g.atWar ? 1800 : 1300, action: { type: 'flipAll' } } : null;
  }
}

export function getPublicState(g) {
  return {
    phase: g.phase,
    contenders: g.contenders,
    flipped: Object.keys(g.flips),
    atWar: g.atWar,
    battles: g.battles,
    potCount: g.pot.length,
    players: g.players.map((id) => ({ id, cardCount: g.piles[id].length })),
  };
}

export function getLegalActions(g, playerId) {
  if (g.phase !== 'flip' || !g.contenders.includes(playerId) || g.flips[playerId]) return [];
  if (g.options.autoFlip) return [{ type: 'flip', label: g.atWar ? 'Flip for war!' : 'Flip now', style: 'primary', optional: true }];
  return [{ type: 'flip', label: g.atWar ? 'Flip for war!' : 'Flip!', style: g.atWar ? 'danger' : 'primary' }];
}

export function applyAction(game, playerId, action) {
  if (game.phase === 'over') return fail('The game is over.');
  const g = clone(game);
  const events = [];
  if (playerId === SYSTEM) {
    if (action?.type !== 'flipAll') return fail('Nothing to advance.');
    for (const id of g.contenders) if (!g.flips[id]) flipFor(g, id);
    g.autoAdvance = null;
    resolve(g, events);
    return ok(g, events);
  }
  if (!g.players.includes(playerId)) return fail('You are not playing in this game.');
  if (action?.type !== 'flip') return fail('Unknown action.');
  if (!g.contenders.includes(playerId)) return fail(g.piles[playerId].length ? 'You are not in this war.' : 'You are out of cards.');
  if (g.flips[playerId]) return fail('You already flipped — waiting for the others.');
  flipFor(g, playerId);
  events.push({ type: 'flip', playerId, anim: { kind: 'toCenter', playerId, count: 1, cards: [g.flips[playerId]] } });
  if (g.contenders.every((id) => g.flips[id])) {
    g.autoAdvance = null;
    resolve(g, events);
  }
  return ok(g, events);
}

export function getPlayerView(g, viewer) {
  const flipping = Object.keys(g.flips).length > 0;
  const plays = flipping
    ? g.contenders.filter((id) => g.flips[id]).map((id) => ({ playerId: id, card: g.flips[id] }))
    : g.lastBattle?.plays ?? [];
  let prompt;
  if (g.phase === 'over') prompt = 'Game over';
  else if (getLegalActions(g, viewer).some((a) => !a.optional)) prompt = g.atWar ? 'WAR! Flip your next card.' : 'Flip your top card!';
  else if (!g.piles[viewer]?.length) prompt = 'You are out of cards — watch the rest of the war.';
  else if (g.options.autoFlip) prompt = g.atWar ? 'War! Cards flip automatically…' : 'Cards flip automatically…';
  else prompt = `Waiting for ${g.contenders.filter((id) => !g.flips[id]).map((id) => nameOf(g, id)).join(', ')} to flip…`;

  const table = [
    {
      id: 'battle',
      type: 'trick',
      label: g.atWar ? 'War!' : flipping ? 'Battle' : g.lastBattle ? 'Last battle' : 'Battle',
      plays,
      winnerId: flipping ? null : g.lastBattle?.winnerId ?? null,
      showNames: true,
    },
  ];
  if (g.pot.length) table.push({ id: 'pot', type: 'pile', label: 'War chest', count: g.pot.length });

  return {
    ...getPublicState(g),
    prompt,
    hand: [],
    handNote: g.piles[viewer] ? `Your deck: ${g.piles[viewer].length} cards face down` : '',
    players: g.players.map((id) => ({
      id,
      cardCount: g.piles[id].length,
      status: g.phase === 'over' && g.winner === id ? 'winner' : g.piles[id].length === 0 ? 'out' : undefined,
    })),
    table,
    info: [
      { label: 'Battle', value: g.options.maxBattles ? `${g.battles}/${g.options.maxBattles}` : g.battles },
      ...(g.pot.length ? [{ label: 'War chest', value: g.pot.length }] : []),
    ],
    dealId: g.dealId,
  };
}

export function getResults(g) {
  const { rankings, winners } = rankPlayers(g.players, (id) => g.piles[id].length, {
    label: (id) => `${g.piles[id].length} cards`,
  });
  return {
    rankings,
    winners,
    summary: `${winners.map((id) => nameOf(g, id)).join(' & ')} win${winners.length > 1 ? '' : 's'} with ${g.piles[winners[0]].length} cards!`,
  };
}

export function getAutoAction(g, playerId) {
  return getLegalActions(g, playerId).length ? { type: 'flip' } : null;
}
