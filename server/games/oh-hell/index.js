// Oh Hell (Contract Whist): bid exactly how many tricks you will take.
import { buildSchedule, clampHandSize, createPredictionGame } from '../../shared/predictionGame.js';

const meta = {
  id: 'oh-hell',
  name: 'Oh Hell',
  order: 2,
  minPlayers: 3,
  maxPlayers: 7,
  tagline: 'Contract Whist. Exactly right or nothing.',
  description:
    'Hands grow by one card each round, then shrink again. Bid the exact number of tricks you will take — a turned-up card sets trumps, and only exact bids score.',
  options: [
    {
      key: 'maxCards',
      label: 'Most cards in a hand',
      type: 'select',
      default: 7,
      choices: [3, 5, 7, 8, 10, 13].map((n) => ({ value: n, label: `${n} cards` })),
      help: 'Automatically lowered if there are not enough cards for everyone plus a trump card.',
    },
    {
      key: 'sequence',
      label: 'Round sequence',
      type: 'select',
      default: 'up-down',
      choices: [
        { value: 'up-down', label: 'Up then down (1 … max … 1)' },
        { value: 'down-up', label: 'Down then up (max … 1 … max)' },
        { value: 'up', label: 'Up only (1 … max)' },
        { value: 'down', label: 'Down only (max … 1)' },
      ],
    },
    {
      key: 'hook',
      label: 'Hook rule',
      type: 'boolean',
      default: true,
      help: "The dealer bids last and can't make the total bids equal the number of tricks.",
    },
    {
      key: 'scoring',
      label: 'Scoring',
      type: 'select',
      default: 'classic',
      choices: [
        { value: 'classic', label: 'Exact bid: 10 + bid · miss: 0' },
        { value: 'tricks', label: '1 per trick won + 10 bonus if exact' },
        { value: 'penalty', label: 'Exact bid: 10 + bid · miss: −1 per trick off' },
      ],
    },
  ],
};

const engine = createPredictionGame({
  meta,
  normalize(options, n) {
    return {
      maxCards: clampHandSize(options.maxCards ?? 7, n, true),
      sequence: options.sequence ?? 'up-down',
      hook: options.hook !== false,
      scoring: ['classic', 'tricks', 'penalty'].includes(options.scoring) ? options.scoring : 'classic',
    };
  },
  schedule: (opts) => buildSchedule(opts.sequence, opts.maxCards),
  // The first undealt card is turned face up; its suit is trumps.
  trump: ({ rest }) => ({ trump: rest[0]?.suit ?? null, trumpCard: rest[0] ?? null, stock: rest.slice(1) }),
  bidding: () => 'sequential',
  hook: (opts) => opts.hook,
  score({ bid, tricks, opts }) {
    const exact = bid === tricks;
    if (opts.scoring === 'tricks') return tricks + (exact ? 10 : 0);
    if (exact) return 10 + bid;
    return opts.scoring === 'penalty' ? -Math.abs(bid - tricks) : 0;
  },
  hitText: (name, bid, pts) => `${name} made their bid of ${bid} exactly (+${pts})`,
});

export default engine;
export const {
  createGame,
  getPublicState,
  getPlayerView,
  getLegalActions,
  applyAction,
  isGameOver,
  getResults,
  getAutoAction,
} = engine;
export { meta };
