import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fetchGames } from '../lib/api.js';
import { useGameInfo } from '../components/RulesPanel.jsx';
import { Markdown } from '../components/Markdown.jsx';

export function RulesPage() {
  const { gameId } = useParams();
  const [games, setGames] = useState([]);
  const { info, error } = useGameInfo(gameId);

  useEffect(() => {
    fetchGames().then(setGames).catch(() => {});
  }, []);

  return (
    <main className="page rules-page">
      <nav className="rules-nav" aria-label="Games">
        <h2>Rulebook</h2>
        {games.map((g) => (
          <Link key={g.id} to={`/rules/${g.id}`} className={g.id === gameId ? 'active' : ''}>
            {g.name}
          </Link>
        ))}
      </nav>
      <article className="rules-content">
        {!gameId && (
          <>
            <h1>Rulebook</h1>
            <p className="lead">Pick a game to read its rules. You can also open them from inside any game.</p>
          </>
        )}
        {gameId && error && <p className="error">{error}</p>}
        {gameId && !info && !error && <p className="muted">Loading…</p>}
        {info && <Markdown source={info.rules} />}
      </article>
    </main>
  );
}
