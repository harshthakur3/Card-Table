import { SUIT_SYMBOLS, isRedSuit } from './suits.js';

/** Generated card face, used when the SVG pack is missing or an image fails to load. */
export function FallbackCard({ rank, suit, color }) {
  const isJoker = rank === 'JOKER';
  const red = isJoker ? color === 'red' : isRedSuit(suit);
  const ink = red ? 'var(--color-face-red)' : 'var(--color-face-ink)';
  const sym = isJoker ? '★' : SUIT_SYMBOLS[suit] ?? '?';
  const label = isJoker ? 'J' : rank;
  const face = ['J', 'Q', 'K'].includes(rank);
  return (
    <svg className="card-svg" viewBox="0 0 167 243" aria-hidden="true">
      <rect x="0.5" y="0.5" width="166" height="242" rx="11" style={{ fill: 'var(--color-face)', stroke: 'var(--color-face-edge)' }} />
      <g style={{ fill: ink, fontFamily: 'var(--font-display)' }} fontWeight="800">
        <text x="14" y="38" fontSize="34" textAnchor="start">{label}</text>
        <text x="14" y="68" fontSize="28">{sym}</text>
        <g transform="rotate(180 83.5 121.5)">
          <text x="14" y="38" fontSize="34">{label}</text>
          <text x="14" y="68" fontSize="28">{sym}</text>
        </g>
        {isJoker ? (
          <>
            <text x="83.5" y="132" fontSize="64" textAnchor="middle">★</text>
            <text x="83.5" y="170" fontSize="22" textAnchor="middle" letterSpacing="3">JOKER</text>
          </>
        ) : face ? (
          <>
            <rect x="38" y="52" width="91" height="139" rx="6" fill="none" style={{ stroke: ink }} strokeWidth="2" opacity="0.5" />
            <text x="83.5" y="138" fontSize="64" textAnchor="middle">{rank}</text>
            <text x="83.5" y="176" fontSize="30" textAnchor="middle">{sym}</text>
          </>
        ) : (
          <text x="83.5" y="146" fontSize="78" textAnchor="middle">{sym}</text>
        )}
      </g>
    </svg>
  );
}
