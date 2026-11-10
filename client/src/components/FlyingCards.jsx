import { forwardRef, useImperativeHandle, useRef } from 'react';
import { cardImageUrl } from '../cards/cardImages.js';

const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function centerOf(el) {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/**
 * Overlay that flies small cards between seats and the centre of the table.
 * Driven by `anim` hints on game events: toCenter | toSeat | clearCenter | deal.
 */
export const FlyingCards = forwardRef(function FlyingCards({ rootRef }, ref) {
  const layer = useRef(null);

  function anchor(id) {
    const root = rootRef.current;
    if (!root) return null;
    if (id === 'center') return root.querySelector('[data-anchor="center"]');
    return root.querySelector(`[data-seat="${CSS.escape(id)}"]`);
  }

  function fly(from, to, { count = 1, cards = null, delay = 0, duration = 420, fade = false }) {
    const host = layer.current;
    if (!host || !from || !to) return;
    const a = centerOf(from);
    const b = centerOf(to);
    const n = Math.min(cards?.length ?? count, 6);
    for (let i = 0; i < n; i++) {
      const el = document.createElement('div');
      const card = cards?.[i];
      const url = card && !card.faceDown ? cardImageUrl(card.rank, card.suit, card.color) : null;
      el.className = `fly-card ${url ? 'face' : 'back'}`;
      if (url) el.style.backgroundImage = `url("${url}")`;
      el.style.left = `${a.x}px`;
      el.style.top = `${a.y}px`;
      host.appendChild(el);
      const jitter = (i - (n - 1) / 2) * 10;
      const anim = el.animate(
        [
          { transform: 'translate(-50%, -50%) scale(0.85) rotate(0deg)', opacity: 0.2 },
          { opacity: 1, offset: 0.15 },
          {
            transform: `translate(calc(-50% + ${b.x - a.x + jitter}px), calc(-50% + ${b.y - a.y}px)) scale(1) rotate(${jitter}deg)`,
            opacity: fade ? 0 : 1,
          },
        ],
        { duration, delay: delay + i * 60, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'both' },
      );
      anim.onfinish = () => el.remove();
      anim.oncancel = () => el.remove();
    }
  }

  useImperativeHandle(ref, () => ({
    play(anim, { seats = [] } = {}) {
      if (!anim || reduceMotion()) return;
      const center = anchor('center');
      switch (anim.kind) {
        case 'toCenter':
          fly(anchor(anim.playerId), center, { count: anim.count, cards: anim.cards });
          break;
        case 'toSeat':
          fly(center, anchor(anim.playerId), { count: anim.count, cards: anim.cards, duration: 520 });
          break;
        case 'seatToSeat':
          fly(anchor(anim.from), anchor(anim.to), { count: anim.count, cards: anim.cards, duration: 520 });
          break;
        case 'clearCenter': {
          const r = center?.getBoundingClientRect();
          if (!r) break;
          const off = document.createElement('div');
          off.style.cssText = `position:fixed;left:${r.left + r.width / 2}px;top:-80px;width:1px;height:1px`;
          document.body.appendChild(off);
          fly(center, off, { count: 4, duration: 500, fade: true });
          setTimeout(() => off.remove(), 900);
          break;
        }
        case 'deal':
          seats.forEach((id, i) => fly(center, anchor(id), { count: 3, delay: i * 90, duration: 380 }));
          break;
        default:
      }
    },
  }));

  return <div className="fly-layer" ref={layer} aria-hidden="true" />;
});
