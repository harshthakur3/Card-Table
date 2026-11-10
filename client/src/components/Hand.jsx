import { useLayoutEffect, useRef, useState } from 'react';
import { Card } from '../cards/Card.jsx';

/** Width of a hand card for a given container width (px). */
function handCardWidth(width) {
  if (width < 380) return 58;
  if (width < 520) return 64;
  if (width < 800) return 78;
  return 92;
}

/**
 * Fanned hand at the bottom of the table. Tap a card to select it; double-tap plays it when
 * there is exactly one obvious move. Cards re-deal (animate in) whenever dealId changes.
 */
export function Hand({ cards, selected, allowed, interactive, onCardClick, onCardDoubleClick, dealId, emptyText }) {
  const ref = useRef(null);
  const [width, setWidth] = useState(600);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = cards.length;
  const cw = handCardWidth(width);
  const ch = cw * 1.452;
  const mid = (n - 1) / 2;
  const rot = n > 1 ? Math.min(2.4, 28 / n) : 0;
  // Outer cards rotate around a point below the hand, so their top corners swing outwards.
  const edge = Math.ceil(1.3 * ch * Math.sin((rot * mid * Math.PI) / 180)) + 6;
  const step = n > 1 ? Math.max(4, Math.min(cw * 0.62, (width - cw - 2 * edge) / (n - 1))) : 0;
  const total = cw + step * Math.max(0, n - 1);
  const start = Math.max(edge, (width - total) / 2);
  const compact = cw < 80 || step < cw * 0.42;

  return (
    <div
      ref={ref}
      className={`hand ${compact ? 'compact' : ''}`}
      style={{ '--hand-cw': `${cw}px`, height: `${ch + 30}px` }}
      aria-label={`Your hand, ${n} cards`}
    >
      <div className="hand-inner" key={dealId}>
        {cards.map((c, i) => {
          const off = i - mid;
          const isSel = selected.includes(c.id);
          const canPlay = interactive && allowed.has(c.id);
          const lift = isSel ? -22 : 0;
          const curve = n > 1 ? Math.pow(off / Math.max(mid, 1), 2) * Math.min(12, n) : 0;
          return (
            <div
              key={c.id}
              className="hand-slot"
              style={{
                transform: `translate(${start + i * step}px, ${curve + lift}px) rotate(${off * rot}deg)`,
                zIndex: i + 1,
                animationDelay: `${Math.min(i * 40, 900)}ms`,
              }}
            >
              <Card
                rank={c.rank}
                suit={c.suit}
                color={c.color}
                faceDown={c.faceDown}
                size="hand"
                selected={isSel}
                playable={canPlay}
                dimmed={interactive && !canPlay}
                onClick={interactive && canPlay ? () => onCardClick(c.id) : undefined}
                onDoubleClick={interactive && canPlay ? () => onCardDoubleClick(c.id) : undefined}
              />
            </div>
          );
        })}
        {n === 0 && <p className="hand-empty muted">{emptyText || 'No cards in hand'}</p>}
      </div>
    </div>
  );
}
