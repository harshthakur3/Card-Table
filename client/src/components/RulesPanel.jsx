import { useEffect, useState } from 'react';
import { fetchGameInfo } from '../lib/api.js';
import { Markdown } from './Markdown.jsx';

export function useGameInfo(gameId) {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let alive = true;
    setInfo(null);
    setError(null);
    if (gameId) {
      fetchGameInfo(gameId)
        .then((i) => alive && setInfo(i))
        .catch((e) => alive && setError(e.message));
    }
    return () => {
      alive = false;
    };
  }, [gameId]);
  return { info, error };
}

/** Slide-in rules panel used inside the game, so you never leave the table. */
export function RulesPanel({ gameId, onClose }) {
  const { info, error } = useGameInfo(gameId);
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="drawer-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer rules-drawer" aria-label="Rules">
        <header className="drawer-head">
          <h2>{info ? `${info.name} rules` : 'Rules'}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close rules">
            ✕
          </button>
        </header>
        <div className="drawer-body">
          {error && <p className="error">Could not load rules: {error}</p>}
          {!info && !error && <p className="muted">Loading…</p>}
          {info && <Markdown source={info.rules} />}
        </div>
      </aside>
    </div>
  );
}
