import { memo, useState } from 'react';
import { RANKS, SUIT_NAMES, SUIT_SYMBOLS, isRedSuit } from './suits.js';
import { cardImageUrl } from './cardImages.js';
import { imageFailed, markImageFailed } from './preload.js';
import { CardBack } from './CardBack.jsx';
import { FallbackCard } from './FallbackCard.jsx';

const RANK_WORDS = { J: 'Jack', Q: 'Queen', K: 'King', A: 'Ace' };

function describe(rank, suit) {
  if (rank === 'JOKER') return 'Joker';
  if (!RANKS.includes(rank)) return 'Card';
  return `${RANK_WORDS[rank] ?? rank} of ${SUIT_NAMES[suit]}`;
}

/**
 * A playing card. Renders the SVG from the mapped pack, a generated fallback if the image is
 * missing, or our own card back when faceDown.
 * Sizes: xs | sm | md | lg (width comes from CSS so phones can shrink everything).
 */
export const Card = memo(function Card({
  rank,
  suit,
  color,
  faceDown = false,
  size = 'md',
  selected = false,
  playable = false,
  dimmed = false,
  onClick,
  onDoubleClick,
  className = '',
  style,
}) {
  const url = faceDown ? null : cardImageUrl(rank, suit, color);
  const [broken, setBroken] = useState(() => !url || imageFailed(url));
  const clickable = typeof onClick === 'function';

  const classes = [
    'card',
    `card-${size}`,
    faceDown && 'is-back',
    selected && 'is-selected',
    playable && 'is-playable',
    dimmed && 'is-dimmed',
    clickable && 'is-clickable',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const a11y = clickable
    ? {
        role: 'button',
        tabIndex: 0,
        'aria-pressed': selected,
        onKeyDown: (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick(e);
          }
        },
      }
    : {};

  if (faceDown) {
    return (
      <div className={classes} style={style} aria-label="Face-down card" onClick={onClick} {...a11y}>
        <CardBack />
      </div>
    );
  }

  const red = rank === 'JOKER' ? color === 'red' : isRedSuit(suit);
  return (
    <div
      className={classes}
      style={style}
      aria-label={describe(rank, suit)}
      title={describe(rank, suit)}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      {...a11y}
    >
      {broken ? (
        <FallbackCard rank={rank} suit={suit} color={color} />
      ) : (
        <img
          className="card-img"
          src={url}
          alt=""
          draggable={false}
          onError={() => {
            markImageFailed(url);
            setBroken(true);
          }}
        />
      )}
      {/* Large index so rank/suit stay readable when cards are small (shown via CSS). */}
      <span className={`card-index${red ? ' red' : ''}`} aria-hidden="true">
        {rank === 'JOKER' ? '★' : rank}
        <b>{rank === 'JOKER' ? '' : SUIT_SYMBOLS[suit]}</b>
      </span>
    </div>
  );
});
