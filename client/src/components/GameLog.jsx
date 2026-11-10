import { useEffect, useRef } from 'react';

function time(t) {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function GameLog({ entries }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries.length]);
  return (
    <div className="log-list" ref={ref}>
      {entries.length === 0 && <p className="muted small">Nothing yet.</p>}
      {entries.map((e, i) => (
        <div key={`${e.t}-${i}`} className={`log-entry ${e.private ? 'private' : ''}`}>
          <time>{time(e.t)}</time>
          <span>{e.text}</span>
        </div>
      ))}
    </div>
  );
}
