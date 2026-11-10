// Bluff / Cheat — shed all your cards by playing them face down and claiming a rank.
import { RANKS, createDeck, deal, rankName, shuffle, sortHand, takeCards } from '../../shared/cards.js';
import { clone, fail, nameOf, namesMap, nextSeat, ok, rankPlayers } from '../../shared/engine.js';

const SEQUENCE = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const RANK_CHOICES = RANKS.map((r) => ({ value: r, label: r }));

export const meta = {
  id: 'bluff',
  name: 'Bluff',
  order: 1,
  minPlayers: 3,
  maxPlayers: 8,
  tagline: 'Also called Cheat. Lie with a straight face.',
  description:
    'Play cards face down and claim a rank. Anyone can call bluff — whoever is wrong picks up the whole pile. First to empty their hand wins.',
  options: [
    {
      key: 'decks',
      label: 'Decks',
      type: 'select',
      default: 1,
      choices: [
        { value: 1, label: '1 deck (52 cards)' },
        { value: 2, label: '2 decks (104 cards)' },
      ],
      help: 'Use 2 decks for 6+ players.',
    },
    {
      key: 'claimMode',
      label: 'Claims',
      type: 'select',
      default: 'free',
      choices: [
        { value: 'free', label: 'Round leader picks the rank; others follow or pass' },
        { value: 'sequence', label: 'Ranks go in order A, 2, 3 … K (classic Cheat)' },
      ],
    },
    {
      key: 'discardOnPass',
      label: 'Set pile aside when everyone passes',
      type: 'boolean',
      default: true,
      help: 'Only used with "Round leader picks the rank". Off: the pile stays and keeps growing.',
    },
  ],
};

const maxPerPlay = (g) => 4 * g.options.decks;
const currentId = (g) => g.players[g.turnIdx];

/** Rank the current player must claim, or null if they may choose. */
function requiredRank(g) {
  if (g.options.claimMode === 'sequence') return SEQUENCE[g.seqIdx % SEQUENCE.length];
  return g.claimRank;
}

export function createGame(players, options = {}) {
  if (players.length < meta.minPlayers || players.length > meta.maxPlayers) {
    throw new Error(`Bluff needs ${meta.minPlayers}-${meta.maxPlayers} players`);
  }
  const opts = {
    decks: options.decks === 2 ? 2 : 1,
    claimMode: options.claimMode === 'sequence' ? 'sequence' : 'free',
    discardOnPass: options.discardOnPass !== false,
  };
  const seed = options.seed ?? 'bluff';
  const deck = shuffle(createDeck({ decks: opts.decks }), `${seed}:deal`);
  const { hands } = deal(deck, players.length);
  const ids = players.map((p) => p.id);
  // Whoever holds the A♠ (first deck) starts; otherwise the first seat.
  let first = hands.findIndex((h) => h.some((c) => c.id === 'AS'));
  if (first < 0) first = 0;
  return {
    game: 'bluff',
    players: ids,
    names: namesMap(players),
    options: opts,
    seed,
    hands: Object.fromEntries(ids.map((id, i) => [id, hands[i]])),
    pile: [],
    setAside: 0,
    turnIdx: first,
    claimRank: null,
    seqIdx: 0,
    lastPlay: null,
    passes: 0,
    reveal: null,
    winner: null,
    phase: 'play',
    dealId: 1,
    autoAdvance: null,
  };
}

export function isGameOver(g) {
  return g.phase === 'over';
}

export function getPublicState(g) {
  return {
    phase: g.phase,
    turn: g.phase === 'play' ? currentId(g) : null,
    players: g.players.map((id) => ({ id, cardCount: g.hands[id].length })),
    pileCount: g.pile.length,
    setAside: g.setAside,
    claimRank: g.claimRank,
    requiredRank: requiredRank(g),
    lastPlay: g.lastPlay
      ? { playerId: g.lastPlay.playerId, count: g.lastPlay.cards.length, rank: g.lastPlay.rank }
      : null,
    reveal: g.reveal,
    winner: g.winner,
  };
}

export function getLegalActions(g, playerId) {
  if (g.phase !== 'play' || !g.players.includes(playerId)) return [];
  const actions = [];
  const isTurn = currentId(g) === playerId;
  const lp = g.lastPlay;

  if (isTurn) {
    const hand = g.hands[playerId];
    const rank = requiredRank(g);
    const play = {
      type: 'play',
      label: rank ? `Play as ${rankName(rank, 2)}` : 'Play',
      style: 'primary',
      cards: { min: 1, max: Math.min(maxPerPlay(g), hand.length), allowed: hand.map((c) => c.id) },
    };
    if (!rank) {
      const counts = {};
      for (const c of hand) counts[c.rank] = (counts[c.rank] ?? 0) + 1;
      const best = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] ?? 'A';
      play.params = [{ name: 'rank', label: 'Claim', type: 'choice', options: RANK_CHOICES, default: best }];
      play.label = 'Play';
    }
    actions.push(play);
    if (g.options.claimMode === 'free' && lp) actions.push({ type: 'pass', label: 'Pass', style: 'secondary' });
  }
  if (lp && lp.playerId !== playerId) {
    actions.push({ type: 'callBluff', label: 'Call bluff!', style: 'danger', optional: true });
  }
  return actions;
}

/** When the next player acts, the previous unchallenged play stands. Returns true if that wins the game. */
function acceptLastPlay(g, events) {
  const lp = g.lastPlay;
  if (lp && g.hands[lp.playerId].length === 0) {
    g.winner = lp.playerId;
    g.phase = 'over';
    events.push({
      type: 'win',
      toast: true,
      text: `Nobody challenged — ${nameOf(g, lp.playerId)} is out of cards and wins!`,
    });
    return true;
  }
  return false;
}

export function applyAction(game, playerId, action) {
  if (game.phase !== 'play') return fail('The game is over.');
  if (!game.players.includes(playerId)) return fail('You are not playing in this game.');
  const g = clone(game);
  const events = [];
  const me = nameOf(g, playerId);

  switch (action?.type) {
    case 'play': {
      if (currentId(g) !== playerId) return fail(`It's ${nameOf(g, currentId(g))}'s turn.`);
      const ids = Array.isArray(action.cards) ? action.cards : [];
      if (ids.length < 1) return fail('Select at least one card to play.');
      if (ids.length > maxPerPlay(g)) return fail(`You can play at most ${maxPerPlay(g)} cards at once.`);
      const taken = takeCards(g.hands[playerId], ids);
      if (!taken) return fail("You don't have those cards.");
      let rank = requiredRank(g);
      if (!rank) {
        if (!RANKS.includes(action.rank)) return fail('Choose which rank you are claiming.');
        rank = action.rank;
      }
      if (acceptLastPlay(g, events)) return ok(g, events);
      g.hands[playerId] = taken.hand;
      g.pile.push(...taken.taken);
      g.lastPlay = { playerId, cards: taken.taken, rank };
      if (g.options.claimMode === 'free') g.claimRank = rank;
      else g.seqIdx += 1;
      g.passes = 0;
      g.reveal = null;
      const n = taken.taken.length;
      events.push({
        type: 'play',
        text: `${me} played ${n} card${n > 1 ? 's' : ''}, claiming ${n} ${rankName(rank, n)}`,
        playerId,
        anim: { kind: 'toCenter', playerId, count: n, faceDown: true },
      });
      if (g.hands[playerId].length === 0) {
        events.push({ type: 'lastCards', toast: true, text: `${me} played their last cards! Call bluff or they win.` });
      }
      g.turnIdx = nextSeat(g.players.length, g.turnIdx);
      return ok(g, events);
    }

    case 'pass': {
      if (currentId(g) !== playerId) return fail(`It's ${nameOf(g, currentId(g))}'s turn.`);
      if (g.options.claimMode !== 'free') return fail('Passing is not allowed in this mode.');
      if (!g.lastPlay) return fail('You are starting the round — you must play at least one card.');
      if (acceptLastPlay(g, events)) return ok(g, events);
      g.passes += 1;
      events.push({ type: 'pass', text: `${me} passed`, playerId });
      if (g.passes >= g.players.length - 1) {
        const leader = g.lastPlay.playerId;
        if (g.options.discardOnPass) {
          g.setAside += g.pile.length;
          events.push({
            type: 'clear',
            toast: true,
            text: `Everyone passed — the pile (${g.pile.length} cards) is set aside. ${nameOf(g, leader)} starts a new round.`,
            anim: { kind: 'clearCenter' },
          });
          g.pile = [];
        } else {
          events.push({ type: 'clear', toast: true, text: `Everyone passed — ${nameOf(g, leader)} starts a new round.` });
        }
        g.claimRank = null;
        g.lastPlay = null;
        g.passes = 0;
        g.turnIdx = g.players.indexOf(leader);
      } else {
        g.turnIdx = nextSeat(g.players.length, g.turnIdx);
      }
      return ok(g, events);
    }

    case 'callBluff': {
      const lp = g.lastPlay;
      if (!lp) return fail('There is nothing to call bluff on.');
      if (lp.playerId === playerId) return fail("You can't call bluff on yourself.");
      const truthful = lp.cards.every((c) => c.rank === lp.rank);
      const loser = truthful ? playerId : lp.playerId;
      const winner = truthful ? lp.playerId : playerId;
      const count = g.pile.length;
      g.hands[loser] = sortHand([...g.hands[loser], ...g.pile], { by: 'rank' });
      g.pile = [];
      g.reveal = { playerId: lp.playerId, callerId: playerId, cards: lp.cards, rank: lp.rank, truthful };
      const them = nameOf(g, lp.playerId);
      events.push({ type: 'callBluff', toast: true, text: `${me} called bluff on ${them}!`, playerId });
      events.push({
        type: 'reveal',
        toast: true,
        tone: truthful ? 'good' : 'bad',
        text: truthful
          ? `${them} told the truth — ${me} picks up ${count} cards`
          : `${them} was bluffing! ${them} picks up ${count} cards`,
        cards: lp.cards,
        anim: { kind: 'toSeat', playerId: loser, count, faceDown: true },
      });
      g.lastPlay = null;
      g.claimRank = null;
      g.passes = 0;
      if (truthful && g.hands[lp.playerId].length === 0) {
        g.winner = lp.playerId;
        g.phase = 'over';
        events.push({ type: 'win', toast: true, text: `${them} is out of cards and wins!` });
        return ok(g, events);
      }
      g.turnIdx = g.players.indexOf(winner);
      events.push({ type: 'lead', text: `${nameOf(g, winner)} starts the next round` });
      return ok(g, events);
    }

    default:
      return fail('Unknown action.');
  }
}

export function getPlayerView(g, playerId) {
  const pub = getPublicState(g);
  const hand = g.hands[playerId] ? sortHand(g.hands[playerId], { by: 'rank' }) : [];
  const turnId = currentId(g);
  const rank = requiredRank(g);
  const lp = g.lastPlay;

  let prompt = '';
  if (g.phase === 'over') prompt = `${nameOf(g, g.winner)} wins!`;
  else if (turnId === playerId) {
    if (lp && g.hands[lp.playerId].length === 0) prompt = `${nameOf(g, lp.playerId)} is on their last play — call bluff, or they win when you play.`;
    else if (rank) prompt = `Your turn: play 1–${maxPerPlay(g)} cards as ${rankName(rank, 2)}${g.options.claimMode === 'free' && lp ? ', pass,' : ''}${lp ? ' or call bluff' : ''}.`;
    else prompt = 'Your turn: you lead — pick cards and the rank you claim.';
  } else {
    prompt = `Waiting for ${nameOf(g, turnId)}${lp && lp.playerId !== playerId ? ' — you can call bluff on the last play' : ''}`;
  }

  const table = [{ id: 'pile', type: 'pile', label: 'Pile', count: g.pile.length, faceDown: true }];
  if (lp) {
    table.push({
      id: 'claim',
      type: 'cards',
      label: `${nameOf(g, lp.playerId)}: “${lp.cards.length} ${rankName(lp.rank, lp.cards.length)}”`,
      cards: lp.cards.map((_, i) => ({ id: `claim${i}`, faceDown: true })),
      highlight: true,
    });
  }
  if (g.reveal) {
    table.push({
      id: 'reveal',
      type: 'cards',
      label: g.reveal.truthful ? `Truth! (${nameOf(g, g.reveal.playerId)})` : `Bluff! (${nameOf(g, g.reveal.playerId)})`,
      tone: g.reveal.truthful ? 'good' : 'bad',
      cards: g.reveal.cards,
    });
  }

  const info = [];
  if (g.options.claimMode === 'sequence') info.push({ label: 'Next rank', value: rank });
  else info.push({ label: 'Claim', value: g.claimRank ? rankName(g.claimRank, 2) : 'Open' });
  if (g.setAside) info.push({ label: 'Set aside', value: g.setAside });
  info.push({ label: 'Pile', value: g.pile.length });

  return {
    ...pub,
    prompt,
    hand,
    players: pub.players.map((p) => ({
      ...p,
      status: g.winner === p.id ? 'winner' : undefined,
      badge: lp?.playerId === p.id ? `claimed ${lp.cards.length}` : undefined,
    })),
    table,
    info,
    dealId: g.dealId,
  };
}

export function getResults(g) {
  const { rankings, winners } = rankPlayers(g.players, (id) => (id === g.winner ? -1 : g.hands[id].length), {
    lowWins: true,
  });
  return {
    winners,
    rankings: rankings.map((r) => ({
      ...r,
      score: g.hands[r.playerId].length,
      label: r.playerId === g.winner ? 'Out of cards!' : `${g.hands[r.playerId].length} cards left`,
    })),
    summary: g.winner ? `${nameOf(g, g.winner)} emptied their hand and wins!` : 'Game over',
  };
}

/** Simple honest-when-possible bot, used for timeouts and disconnected players. */
export function getAutoAction(g, playerId) {
  if (g.phase !== 'play' || currentId(g) !== playerId) return null;
  const hand = g.hands[playerId];
  const max = maxPerPlay(g);
  const rank = requiredRank(g);
  if (rank) {
    const matching = hand.filter((c) => c.rank === rank).slice(0, max);
    if (matching.length) return { type: 'play', cards: matching.map((c) => c.id) };
    if (g.options.claimMode === 'free' && g.lastPlay) return { type: 'pass' };
    return { type: 'play', cards: [sortHand(hand, { by: 'rank' })[0].id] };
  }
  const groups = {};
  for (const c of hand) (groups[c.rank] ||= []).push(c);
  const best = Object.values(groups).sort((a, b) => b.length - a.length)[0];
  return { type: 'play', cards: best.slice(0, max).map((c) => c.id), rank: best[0].rank };
}
