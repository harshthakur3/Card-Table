// Oh Yeah — a prediction trick-taking game. Rules are our own and fully documented in rules.md;
// every rule that differs from Oh Hell is a host option so it can be adjusted without code changes.
import { buildSchedule, clampHandSize, createPredictionGame } from '../../shared/predictionGame.js';

const ROTATION = ['S', 'H', 'D', 'C', null]; // ♠ ♥ ♦ ♣ then No trump, repeating

const meta = {
  id: 'oh-yeah',
  name: 'Oh Yeah',
  order: 3,
  minPlayers: 3,
  maxPlayers: 7,
  tagline: 'Secret predictions, rotating trumps.',
  description:
    'Everyone secretly predicts their tricks and all predictions are revealed together. Trumps rotate ♠ ♥ ♦ ♣ No-trump. Nail your number and shout “Oh Yeah!”.',
  options: [
    {
      key: 'maxCards',
      label: 'Most cards in a hand',
      type: 'select',
      default: 7,
      choices: [3, 5, 7, 8, 10, 13].map((n) => ({ value: n, label: `${n} cards` })),
      help: 'Automatically lowered so everyone can be dealt that many cards.',
    },
    {
      key: 'sequence',
      label: 'Round sequence',
      type: 'select',
      default: 'down-up',
      choices: [
        { value: 'down-up', label: 'Down then up (max … 1 … max)' },
        { value: 'up-down', label: 'Up then down (1 … max … 1)' },
        { value: 'down', label: 'Down only (max … 1)' },
        { value: 'up', label: 'Up only (1 … max)' },
      ],
    },
    {
      key: 'trumpMode',
      label: 'Trumps',
      type: 'select',
      default: 'rotate',
      choices: [
        { value: 'rotate', label: 'Rotate ♠ ♥ ♦ ♣ No-trump' },
        { value: 'turnup', label: 'Turn up a card (like Oh Hell)' },
        { value: 'none', label: 'Never any trumps' },
      ],
    },
    {
      key: 'bidding',
      label: 'Predictions',
      type: 'select',
      default: 'secret',
      choices: [
        { value: 'secret', label: 'Secret, revealed together' },
        { value: 'turns', label: 'Out loud, in turn' },
      ],
    },
    {
      key: 'missPenalty',
      label: 'Penalty for a wrong prediction',
      type: 'select',
      default: 1,
      choices: [
        { value: 0, label: 'None' },
        { value: 1, label: '−1 per trick off' },
        { value: 2, label: '−2 per trick off' },
      ],
    },
  ],
};

const engine = createPredictionGame({
  meta,
  normalize(options, n) {
    const trumpMode = ['rotate', 'turnup', 'none'].includes(options.trumpMode) ? options.trumpMode : 'rotate';
    return {
      maxCards: clampHandSize(options.maxCards ?? 7, n, trumpMode === 'turnup'),
      sequence: options.sequence ?? 'down-up',
      trumpMode,
      bidding: options.bidding === 'turns' ? 'turns' : 'secret',
      missPenalty: [0, 1, 2].includes(Number(options.missPenalty)) ? Number(options.missPenalty) : 1,
    };
  },
  schedule: (opts) => buildSchedule(opts.sequence, opts.maxCards),
  trump({ roundIdx, rest, opts }) {
    if (opts.trumpMode === 'turnup') return { trump: rest[0]?.suit ?? null, trumpCard: rest[0] ?? null, stock: rest.slice(1) };
    if (opts.trumpMode === 'none') return { trump: null, trumpCard: null, stock: rest };
    return { trump: ROTATION[roundIdx % ROTATION.length], trumpCard: null, stock: rest };
  },
  bidding: (opts) => (opts.bidding === 'turns' ? 'sequential' : 'simultaneous'),
  hook: () => false,
  // Exact: 10 + 2 per trick predicted. Miss: −missPenalty per trick off.
  score({ bid, tricks, opts }) {
    if (bid === tricks) return 10 + 2 * bid;
    return -opts.missPenalty * Math.abs(bid - tricks);
  },
  hitText: (name, bid, pts) => `${name}: “Oh Yeah!” — predicted ${bid} exactly (+${pts})`,
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
