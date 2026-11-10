import { Card } from '../cards/Card.jsx';

/** Seat positions around the top of an oval, in play order starting at my left. */
export function seatLayout(players, me) {
  const idx = players.findIndex((p) => p.id === me);
  const others = idx >= 0 ? [...players.slice(idx + 1), ...players.slice(0, idx)] : players;
  const k = others.length;
  const pos = {};
  others.forEach((p, i) => {
    const t = (i + 1) / (k + 1);
    const a = Math.PI * (1 - t); // left (π) → over the top → right (0)
    pos[p.id] = { x: 50 + 43 * Math.cos(a), y: 54 - 44 * Math.sin(a), angle: a };
  });
  if (idx >= 0) pos[me] = { x: 50, y: 100, angle: -Math.PI / 2 };
  return { others, pos };
}

const STATUS_LABEL = { winner: 'Winner', out: 'Out', folded: 'Folded', finished: 'Finished', allin: 'All-in' };

export function Seat({ player, info, pos, isTurn, isHost, progress }) {
  const away = info?.away || info?.left || info?.connected === false;
  const backs = Math.min(player.cardCount ?? 0, 5);
  return (
    <div
      className={`seat ${isTurn ? 'is-turn' : ''} ${away ? 'is-away' : ''} ${player.status ? `st-${player.status}` : ''}`}
      style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
      data-seat={player.id}
    >
      {(player.cardCount ?? 0) > 0 && (
        <div className="seat-hand" aria-label={`${player.cardCount} cards`}>
          {Array.from({ length: backs }, (_, i) => (
            <Card key={i} faceDown size="xs" className="seat-back" style={{ '--i': i, '--n': backs }} />
          ))}
          <span className="seat-count">{player.cardCount}</span>
        </div>
      )}
      {player.faceUp?.length > 0 && (
        <div className="seat-faceup">
          {player.faceUp.map((c) => (
            <Card key={c.id} rank={c.rank} suit={c.suit} color={c.color} faceDown={c.faceDown} size="xs" />
          ))}
        </div>
      )}
      <div className="seat-plate">
        {isTurn && progress != null && (
          <svg className="turn-ring" viewBox="0 0 36 36" aria-hidden="true">
            <circle cx="18" cy="18" r="16" pathLength="100" strokeDasharray={`${progress * 100} 100`} />
          </svg>
        )}
        <span className="avatar">{info?.nickname?.[0]?.toUpperCase() ?? '?'}</span>
        <span className="seat-name">
          {info?.nickname ?? 'Player'}
          {isHost && (
            <span className="crown">host</span>
          )}
        </span>
      </div>
      {player.stats?.length > 0 && (
        <div className="seat-stats">
          {player.stats.map((s) => (
            <span key={s.label}>
              {s.label} <b>{s.value}</b>
            </span>
          ))}
        </div>
      )}
      {player.badge && <div className="seat-badge">{player.badge}</div>}
      {player.status && STATUS_LABEL[player.status] && (
        <div className={`seat-status ${player.status}`}>{STATUS_LABEL[player.status]}</div>
      )}
      {away && <div className="seat-status away">{info?.left ? 'Bot playing' : 'Away'}</div>}
    </div>
  );
}

function ZoneCards({ cards, size = 'sm' }) {
  return (
    <div className="zone-cards">
      {cards.map((c, i) => (
        <Card key={c.id ?? i} rank={c.rank} suit={c.suit} color={c.color} faceDown={c.faceDown} size={size} />
      ))}
    </div>
  );
}

export function Zone({ zone, pos, names }) {
  const cls = `zone zone-${zone.type} ${zone.tone ? `tone-${zone.tone}` : ''} ${zone.highlight ? 'highlight' : ''}`;
  switch (zone.type) {
    case 'pile': {
      const n = zone.count ?? 0;
      const layers = Math.min(n, 6);
      return (
        <div className={cls} data-zone={zone.id}>
          <div className="pile">
            {n === 0 && !zone.top?.length && <div className="slot-empty">Empty</div>}
            {Array.from({ length: layers }, (_, i) => (
              <Card key={i} faceDown size="sm" className="pile-card" style={{ '--i': i }} />
            ))}
            {zone.top?.map((c, i) => (
              <Card key={c.id} rank={c.rank} suit={c.suit} color={c.color} size="sm" className="pile-top" style={{ '--i': layers + i }} />
            ))}
            {n > 0 && <span className="pile-count">{n}</span>}
          </div>
          {zone.label && <div className="zone-label">{zone.label}</div>}
        </div>
      );
    }
    case 'trick': {
      return (
        <div className={cls} data-zone={zone.id}>
          <div className="trick">
            {(zone.plays ?? []).map((play, i) => {
              const p = pos[play.playerId];
              const a = p ? p.angle : Math.PI / 2;
              const x = 50 + 30 * Math.cos(a);
              const y = 50 - 26 * Math.sin(a);
              const win = zone.winnerId === play.playerId;
              return (
                <div
                  key={`${play.playerId}-${play.card.id}`}
                  className={`trick-card ${win ? 'winner' : ''}`}
                  style={{ left: `${x}%`, top: `${y}%`, zIndex: i + 1, '--from-x': `${(x - 50) * 3}%`, '--from-y': `${(y - 50) * 3}%` }}
                  title={names[play.playerId]}
                >
                  <Card rank={play.card.rank} suit={play.card.suit} color={play.card.color} faceDown={play.card.faceDown} size="sm" />
                  {zone.showNames && <span className="trick-name">{names[play.playerId]}</span>}
                </div>
              );
            })}
          </div>
          {zone.label && <div className="zone-label">{zone.label}</div>}
        </div>
      );
    }
    case 'melds':
      return (
        <div className={cls} data-zone={zone.id}>
          {zone.label && <div className="zone-label">{zone.label}</div>}
          <div className="melds">
            {(zone.groups ?? []).length === 0 && <div className="slot-empty wide">No melds yet</div>}
            {(zone.groups ?? []).map((g) => (
              <div key={g.id} className="meld" title={g.label}>
                <ZoneCards cards={g.cards} size="xs" />
                <span className="meld-label">{g.label}</span>
              </div>
            ))}
          </div>
        </div>
      );
    case 'text':
      return (
        <div className={cls} data-zone={zone.id}>
          {zone.label && <div className="zone-label">{zone.label}</div>}
          <div className="zone-text">{zone.text}</div>
        </div>
      );
    case 'cards':
    default:
      return (
        <div className={cls} data-zone={zone.id}>
          <ZoneCards cards={zone.cards ?? []} size={zone.size ?? 'sm'} />
          {zone.label && <div className="zone-label">{zone.label}</div>}
        </div>
      );
  }
}
