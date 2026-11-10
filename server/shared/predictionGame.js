// Engine factory for "predict your tricks" games (Oh Hell, Oh Yeah).
// Each game supplies a config; the factory returns a complete engine module.
import { SUIT_NAMES, SUIT_SYMBOLS, cardLabel, createDeck, deal, rankValue, shuffle, sortHand } from './cards.js';
import { SYSTEM, clone, fail, nameOf, namesMap, nextSeat, ok, rankPlayers } from './engine.js';
import { followSuitCards, trickWinner } from './tricks.js';

/** Hand sizes for each round. */
export function buildSchedule(sequence, max) {
  const up = Array.from({ length: max }, (_, i) => i + 1);
  const down = up.slice().reverse();
  switch (sequence) {
    case 'down-up':
      return [...down, ...up.slice(1)];
    case 'up':
      return up;
    case 'down':
      return down;
    case 'up-down':
    default:
      return [...up, ...down.slice(1)];
  }
}

export const trumpLabel = (suit) => (suit ? `${SUIT_SYMBOLS[suit]} ${SUIT_NAMES[suit]}` : 'No trump');

/**
 * @param {object} config
 * @param {object} config.meta
 * @param {(options:object, n:number)=>object} config.normalize   clean options for n players (adds maxCards, schedule bits)
 * @param {(opts:object)=>number[]} config.schedule
 * @param {(ctx:{roundIdx:number, rest:Array, opts:object})=>{trump:string|null, trumpCard:object|null, stock:Array}} config.trump
 * @param {(opts:object)=>'sequential'|'simultaneous'} config.bidding
 * @param {(opts:object)=>boolean} config.hook
 * @param {(ctx:{bid:number, tricks:number, handSize:number, opts:object})=>number} config.score
 * @param {(name:string, bid:number, points:number)=>string} [config.hitText]
 */
export function createPredictionGame(config) {
  const { meta } = config;
  const current = (g) => g.players[g.turnIdx];
  const handSize = (g) => g.schedule[g.roundIdx];
  const isDealer = (g, id) => g.players[g.dealerIdx] === id;

  function startRound(g, events) {
    const n = g.players.length;
    const size = handSize(g);
    const deck = shuffle(createDeck(), `${g.seed}:round${g.roundIdx}`);
    const { hands, rest } = deal(deck, n, size);
    g.hands = {};
    g.players.forEach((id, i) => {
      g.hands[id] = hands[(i - g.dealerIdx - 1 + 2 * n) % n];
    });
    const t = config.trump({ roundIdx: g.roundIdx, rest, opts: g.options });
    g.trump = t.trump;
    g.trumpCard = t.trumpCard;
    g.stock = t.stock;
    g.bids = Object.fromEntries(g.players.map((id) => [id, null]));
    g.tricks = Object.fromEntries(g.players.map((id) => [id, 0]));
    g.trick = [];
    g.lastTrickWinner = null;
    g.leaderIdx = (g.dealerIdx + 1) % n;
    g.turnIdx = g.leaderIdx;
    g.phase = 'bid';
    g.dealId += 1;
    g.autoAdvance = null;
    events.push({
      type: 'deal',
      toast: true,
      text: `Round ${g.roundIdx + 1} of ${g.schedule.length}: ${size} card${size > 1 ? 's' : ''} each · ${trumpLabel(g.trump)}${g.trumpCard ? ` (${cardLabel(g.trumpCard)})` : ''}`,
    });
  }

  function createGame(players, options = {}) {
    const n = players.length;
    if (n < meta.minPlayers || n > meta.maxPlayers) {
      throw new Error(`${meta.name} needs ${meta.minPlayers}-${meta.maxPlayers} players`);
    }
    const opts = config.normalize(options, n);
    const g = {
      game: meta.id,
      players: players.map((p) => p.id),
      names: namesMap(players),
      options: opts,
      seed: options.seed ?? meta.id,
      schedule: config.schedule(opts),
      roundIdx: 0,
      dealerIdx: 0,
      scores: Object.fromEntries(players.map((p) => [p.id, 0])),
      history: [],
      dealId: 0,
    };
    startRound(g, []);
    return g;
  }

  const isGameOver = (g) => g.phase === 'over';

  function bidsVisible(g, viewer) {
    if (config.bidding(g.options) === 'sequential' || g.phase !== 'bid') return () => true;
    return (id) => id === viewer;
  }

  function forbiddenBid(g, playerId) {
    if (config.bidding(g.options) !== 'sequential' || !config.hook(g.options) || !isDealer(g, playerId)) return null;
    const others = g.players.filter((id) => id !== playerId).reduce((s, id) => s + (g.bids[id] ?? 0), 0);
    const v = handSize(g) - others;
    return v >= 0 && v <= handSize(g) ? v : null;
  }

  function getPublicState(g) {
    const visible = bidsVisible(g, null);
    return {
      phase: g.phase,
      round: g.roundIdx + 1,
      rounds: g.schedule.length,
      handSize: handSize(g),
      trump: g.trump,
      trumpCard: g.trumpCard,
      dealer: g.players[g.dealerIdx],
      turn: g.phase === 'bid' || g.phase === 'play' ? current(g) : null,
      trick: g.trick,
      bids: Object.fromEntries(g.players.map((id) => [id, visible(id) ? g.bids[id] : g.bids[id] == null ? null : 'hidden'])),
      tricks: g.tricks,
      scores: g.scores,
      players: g.players.map((id) => ({ id, cardCount: g.hands[id].length })),
    };
  }

  function getLegalActions(g, playerId) {
    if (!g.players.includes(playerId)) return [];
    if (g.phase === 'bid') {
      const simultaneous = config.bidding(g.options) === 'simultaneous';
      const mine = simultaneous ? g.bids[playerId] == null : current(g) === playerId;
      if (!mine) return [];
      const forbidden = forbiddenBid(g, playerId);
      return [
        {
          type: 'bid',
          label: 'Bid',
          style: 'primary',
          params: [
            {
              name: 'bid',
              label: 'Tricks you will win',
              type: 'number',
              min: 0,
              max: handSize(g),
              default: forbidden === 0 ? 1 : 0,
              disallowed: forbidden == null ? [] : [forbidden],
              disallowedReason: 'Hook rule: total bids cannot equal the number of tricks',
            },
          ],
        },
      ];
    }
    if (g.phase === 'play' && current(g) === playerId) {
      const legal = followSuitCards(g.hands[playerId], g.trick);
      return [{ type: 'play', label: 'Play card', style: 'primary', cards: { min: 1, max: 1, allowed: legal.map((c) => c.id) } }];
    }
    return [];
  }

  function startPlay(g, events) {
    g.phase = 'play';
    g.turnIdx = g.leaderIdx;
    const total = g.players.reduce((s, id) => s + g.bids[id], 0);
    const size = handSize(g);
    const mood = total > size ? 'overbid — someone will miss' : total < size ? 'underbid' : 'exactly even';
    events.push({ type: 'bidsDone', text: `Bids total ${total} for ${size} trick${size > 1 ? 's' : ''} (${mood})` });
  }

  function endRound(g, events) {
    const size = handSize(g);
    const points = {};
    for (const id of g.players) {
      points[id] = config.score({ bid: g.bids[id], tricks: g.tricks[id], handSize: size, opts: g.options });
      g.scores[id] += points[id];
      if (g.bids[id] === g.tricks[id] && config.hitText) {
        events.push({ type: 'hit', toast: true, tone: 'good', text: config.hitText(nameOf(g, id), g.bids[id], points[id]) });
      }
    }
    g.history.push({
      round: g.roundIdx + 1,
      handSize: size,
      trump: g.trump,
      bids: { ...g.bids },
      tricks: { ...g.tricks },
      points,
    });
    const summary = g.players
      .map((id) => `${nameOf(g, id)} ${g.tricks[id]}/${g.bids[id]} (${points[id] >= 0 ? '+' : ''}${points[id]})`)
      .join(', ');
    events.push({ type: 'roundEnd', text: `Round ${g.roundIdx + 1} scores — ${summary}` });
    if (g.roundIdx >= g.schedule.length - 1) {
      g.phase = 'over';
      g.autoAdvance = null;
    } else {
      g.phase = 'roundEnd';
      g.autoAdvance = { delayMs: 4500, action: { type: 'nextRound' } };
    }
  }

  function applyAction(game, playerId, action) {
    const g = clone(game);
    const events = [];
    const type = action?.type;

    if (playerId === SYSTEM) {
      if (type === 'collect' && g.phase === 'trickEnd') {
        const winner = g.lastTrickWinner;
        events.push({ type: 'collect', playerId: winner, anim: { kind: 'toSeat', playerId: winner, count: g.trick.length } });
        g.trick = [];
        g.autoAdvance = null;
        if (g.players.every((id) => g.hands[id].length === 0)) endRound(g, events);
        else {
          g.phase = 'play';
          g.leaderIdx = g.players.indexOf(winner);
          g.turnIdx = g.leaderIdx;
        }
        return ok(g, events);
      }
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
    const me = nameOf(g, playerId);

    if (type === 'bid') {
      if (g.phase !== 'bid') return fail('Bidding is over for this round.');
      const simultaneous = config.bidding(g.options) === 'simultaneous';
      if (simultaneous) {
        if (g.bids[playerId] != null) return fail('You already placed your bid.');
      } else if (current(g) !== playerId) {
        return fail(`It's ${nameOf(g, current(g))}'s turn to bid.`);
      }
      const bid = Number(action.bid);
      if (!Number.isInteger(bid) || bid < 0 || bid > handSize(g)) return fail(`Bid a whole number from 0 to ${handSize(g)}.`);
      const forbidden = forbiddenBid(g, playerId);
      if (forbidden === bid) {
        return fail(`As dealer you can't bid ${bid}: total bids can't equal ${handSize(g)} (hook rule).`);
      }
      g.bids[playerId] = bid;
      if (simultaneous) {
        events.push({ type: 'bid', text: `${me} locked in a prediction`, playerId });
        if (g.players.every((id) => g.bids[id] != null)) {
          events.push({
            type: 'reveal',
            toast: true,
            text: `Predictions: ${g.players.map((id) => `${nameOf(g, id)} ${g.bids[id]}`).join(', ')}`,
          });
          startPlay(g, events);
        }
      } else {
        events.push({ type: 'bid', text: `${me} bids ${bid}`, playerId });
        if (g.players.every((id) => g.bids[id] != null)) startPlay(g, events);
        else g.turnIdx = nextSeat(g.players.length, g.turnIdx);
      }
      return ok(g, events);
    }

    if (type === 'play') {
      if (g.phase !== 'play') return fail(g.phase === 'bid' ? 'Bidding is not finished yet.' : 'Wait for the next trick.');
      if (current(g) !== playerId) return fail(`It's ${nameOf(g, current(g))}'s turn.`);
      const id = Array.isArray(action.cards) ? action.cards[0] : action.card;
      if (Array.isArray(action.cards) && action.cards.length !== 1) return fail('Play exactly one card.');
      const hand = g.hands[playerId];
      const card = hand.find((c) => c.id === id);
      if (!card) return fail("You don't have that card.");
      const legal = followSuitCards(hand, g.trick);
      if (!legal.some((c) => c.id === id)) {
        return fail(`You must follow suit (${SUIT_NAMES[g.trick[0].card.suit]}).`);
      }
      g.hands[playerId] = hand.filter((c) => c.id !== id);
      g.trick.push({ playerId, card });
      events.push({
        type: 'play',
        text: `${me} played ${cardLabel(card)}`,
        playerId,
        anim: { kind: 'toCenter', playerId, count: 1, cards: [card] },
      });
      if (g.trick.length === g.players.length) {
        const winner = trickWinner(g.trick, g.trump);
        g.tricks[winner] += 1;
        g.lastTrickWinner = winner;
        g.phase = 'trickEnd';
        g.autoAdvance = { delayMs: 1400, action: { type: 'collect' } };
        events.push({ type: 'trick', text: `${nameOf(g, winner)} wins the trick`, playerId: winner });
      } else {
        g.turnIdx = nextSeat(g.players.length, g.turnIdx);
      }
      return ok(g, events);
    }

    if (type === 'collect' || type === 'nextRound') return fail('That happens automatically.');
    return fail('Unknown action.');
  }

  function getPlayerView(g, viewer) {
    const visible = bidsVisible(g, viewer);
    const size = handSize(g);
    const simultaneous = config.bidding(g.options) === 'simultaneous';
    const allBid = g.players.every((id) => g.bids[id] != null);
    const bidText = (id) => {
      if (g.bids[id] == null) return '–';
      return visible(id) ? String(g.bids[id]) : '✓';
    };

    let prompt;
    const turnName = nameOf(g, current(g));
    if (g.phase === 'over') prompt = 'Game over';
    else if (g.phase === 'roundEnd') prompt = `Round ${g.roundIdx + 1} finished — next round starting…`;
    else if (g.phase === 'trickEnd') prompt = `${nameOf(g, g.lastTrickWinner)} wins the trick`;
    else if (g.phase === 'bid') {
      if (simultaneous) {
        prompt = g.bids[viewer] == null
          ? `Predict how many of the ${size} tricks you will win. Predictions are revealed together.`
          : `Waiting for ${g.players.filter((id) => g.bids[id] == null).map((id) => nameOf(g, id)).join(', ')} to predict…`;
      } else if (current(g) === viewer) {
        const forbidden = forbiddenBid(g, viewer);
        prompt = `Your bid: how many of the ${size} tricks will you win?${forbidden != null ? ` (Dealer: you can't bid ${forbidden})` : ''}`;
      } else prompt = `${turnName} is bidding…`;
    } else if (current(g) === viewer) {
      prompt = g.trick.length ? 'Your turn — follow suit if you can.' : 'Your lead — play any card.';
    } else prompt = `${turnName} to play`;

    const table = [];
    if (g.trumpCard) table.push({ id: 'trump', type: 'cards', label: `Trump: ${SUIT_NAMES[g.trump]}`, cards: [g.trumpCard] });
    else table.push({ id: 'trump', type: 'text', label: 'Trump', text: g.trump ? `${SUIT_SYMBOLS[g.trump]} ${SUIT_NAMES[g.trump]}` : 'No trump' });
    table.push({
      id: 'trick',
      type: 'trick',
      plays: g.trick,
      winnerId: g.phase === 'trickEnd' ? g.lastTrickWinner : null,
      showNames: true,
    });

    const totalBid = allBid ? g.players.reduce((s, id) => s + g.bids[id], 0) : null;
    const info = [
      { label: 'Round', value: `${g.roundIdx + 1}/${g.schedule.length}` },
      { label: 'Cards', value: size },
      { label: 'Trump', value: g.trump ? SUIT_SYMBOLS[g.trump] : 'None' },
    ];
    if (totalBid != null) info.push({ label: 'Bids', value: `${totalBid}/${size}` });

    const columns = [
      { key: 'round', label: 'Rd' },
      { key: 'cards', label: 'Cards' },
      { key: 'trump', label: 'Trump' },
      ...g.players.map((id) => ({ key: id, label: nameOf(g, id) })),
    ];
    const rows = g.history.map((h) => {
      const row = { round: h.round, cards: h.handSize, trump: h.trump ? SUIT_SYMBOLS[h.trump] : '–' };
      for (const id of g.players) row[id] = `${h.tricks[id]}/${h.bids[id]} → ${h.points[id] >= 0 ? '+' : ''}${h.points[id]}`;
      return row;
    });
    rows.push({ _total: true, round: 'Total', cards: '', trump: '', ...g.scores });

    return {
      ...getPublicState(g),
      bids: Object.fromEntries(g.players.map((id) => [id, visible(id) ? g.bids[id] : g.bids[id] == null ? null : 'hidden'])),
      prompt,
      hand: sortHand(g.hands[viewer] ?? [], { trump: g.trump }),
      players: g.players.map((id) => ({
        id,
        cardCount: g.hands[id].length,
        stats: [
          { label: 'Bid', value: bidText(id) },
          { label: 'Won', value: g.tricks[id] },
          { label: 'Pts', value: g.scores[id] },
        ],
        badge: isDealer(g, id) ? 'Dealer' : undefined,
      })),
      table,
      info,
      scoreboard: { columns, rows },
      dealId: g.dealId,
    };
  }

  function getResults(g) {
    const { rankings, winners } = rankPlayers(g.players, (id) => g.scores[id], { label: (id) => `${g.scores[id]} pts` });
    const names = winners.map((id) => nameOf(g, id)).join(' & ');
    return { rankings, winners, summary: `${names} win${winners.length > 1 ? '' : 's'} with ${g.scores[winners[0]]} points!` };
  }

  /** Simple bot: estimate tricks from high cards and trumps; try to win only when it still needs tricks. */
  function getAutoAction(g, playerId) {
    const legal = getLegalActions(g, playerId);
    if (!legal.length) return null;
    if (g.phase === 'bid') {
      const hand = g.hands[playerId];
      const size = handSize(g);
      let est = hand.filter(
        (c) => c.rank === 'A' || (g.trump && c.suit === g.trump && rankValue(c.rank) >= 11) || (c.rank === 'K' && size >= 6),
      ).length;
      est = Math.max(0, Math.min(size, est));
      const forbidden = legal[0].params[0].disallowed;
      if (forbidden.includes(est)) est = est + 1 <= size ? est + 1 : est - 1;
      return { type: 'bid', bid: est };
    }
    const allowed = legal[0].cards.allowed;
    const hand = g.hands[playerId].filter((c) => allowed.includes(c.id));
    const power = (c) => rankValue(c.rank) + (g.trump && c.suit === g.trump ? 100 : 0);
    const sorted = hand.slice().sort((a, b) => power(a) - power(b));
    const wins = (c) => trickWinner([...g.trick, { playerId, card: c }], g.trump) === playerId;
    const need = (g.bids[playerId] ?? 0) - g.tricks[playerId];
    let pick;
    if (need > 0) pick = sorted.find(wins) ?? sorted[0];
    else {
      const losing = sorted.filter((c) => !wins(c));
      pick = losing.length ? losing[losing.length - 1] : sorted[0];
    }
    return { type: 'play', cards: [pick.id] };
  }

  return {
    meta,
    createGame,
    getPublicState,
    getPlayerView,
    getLegalActions,
    applyAction,
    isGameOver,
    getResults,
    getAutoAction,
  };
}

/** Largest hand size so every player gets `size` cards (and, if needed, one card is left for trump). */
export function clampHandSize(requested, players, needTrumpCard) {
  const cap = Math.floor((needTrumpCard ? 51 : 52) / players);
  return Math.max(1, Math.min(Number(requested) || 7, cap));
}
