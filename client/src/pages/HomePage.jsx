import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { fetchGames } from '../lib/api.js';
import { request } from '../lib/socket.js';
import { getSavedNickname, getToken, saveNickname, validateNickname } from '../lib/session.js';
import { Modal } from '../components/Modal.jsx';
import { Card } from '../cards/Card.jsx';

// The picture on each game tile: a few real cards that hint at the game.
const c = (rank, suit) => ({ rank, suit });
const BACK = { faceDown: true };
const GAME_ART = {
  bluff: [BACK, BACK, c('K', 'S')],
  'oh-hell': [c('A', 'C'), c('K', 'C'), c('Q', 'C')],
  'oh-yeah': [c('J', 'D'), c('Q', 'D'), c('K', 'D')],
  'go-fish': [c('7', 'S'), c('7', 'H'), c('7', 'D'), c('7', 'C')],
  war: [c('K', 'S'), c('K', 'H')],
  hearts: [c('Q', 'S'), c('A', 'H'), c('K', 'H')],
  spades: [c('A', 'S'), c('K', 'S'), c('Q', 'S')],
  rummy: [c('5', 'H'), c('6', 'H'), c('7', 'H'), c('8', 'H')],
  'crazy-eights': [c('8', 'S'), c('8', 'H'), c('8', 'D'), c('8', 'C')],
  'teen-patti': [c('A', 'S'), c('A', 'H'), c('A', 'D')],
};
const DEFAULT_ART = [BACK, c('A', 'S')];

const FAN = [
  { rank: '10', suit: 'S' },
  { rank: 'J', suit: 'H' },
  { rank: 'Q', suit: 'S' },
  { rank: 'K', suit: 'H' },
  { rank: 'A', suit: 'S' },
];

export function HomePage() {
  const [games, setGames] = useState(null);
  const [error, setError] = useState(null);
  const [hosting, setHosting] = useState(null);
  const [code, setCode] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    fetchGames()
      .then(setGames)
      .catch(() => setError('Could not reach the server. Is it running?'));
  }, []);

  function join(e) {
    e.preventDefault();
    const c = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (c.length >= 5) navigate(`/room/${c}`);
  }

  return (
    <main className="page home">
      <section className="hero">
        <div>
          <h1>Card games with friends, right in the browser.</h1>
          <p className="lead">No accounts, no downloads. Host a table, share the code, and play.</p>
          <form className="join-box" onSubmit={join}>
            <label htmlFor="join-code" className="sr-only">
              Room code
            </label>
            <input
              id="join-code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="Room code"
              maxLength={6}
              autoComplete="off"
              spellCheck="false"
              className="code-input"
            />
            <button className="btn" type="submit" disabled={code.trim().length < 5}>
              Join room
            </button>
          </form>
        </div>
        <div className="hero-fan" aria-hidden="true">
          {FAN.map((c, i) => (
            <Card key={c.rank} rank={c.rank} suit={c.suit} size="lg" style={{ '--i': i }} />
          ))}
        </div>
      </section>

      <section className="home-games">
        <h2 className="section-title">Pick a game to host</h2>
        {error && <p className="error">{error}</p>}
        {!games && !error && <p className="muted">Loading games…</p>}
        <ul className="game-grid">
          {games?.map((g) => (
            <li key={g.id} className="game-tile">
              <div className="game-art" aria-hidden="true">
                {(GAME_ART[g.id] ?? DEFAULT_ART).map((card, i, art) => (
                  <Card key={i} rank={card.rank} suit={card.suit} faceDown={card.faceDown} size="md" style={{ '--i': i, '--n': art.length }} />
                ))}
              </div>
              <div className="game-tile-head">
                <h3>{g.name}</h3>
                <p className="players-pill">
                  {g.minPlayers === g.maxPlayers ? g.minPlayers : `${g.minPlayers}–${g.maxPlayers}`} players
                </p>
              </div>
              <p className="game-desc">{g.tagline || g.description}</p>
              <div className="game-card-actions">
                <button className="btn btn-primary" onClick={() => setHosting(g)}>
                  Host a room
                </button>
                <Link className="btn btn-ghost" to={`/rules/${g.id}`}>
                  Rules
                </Link>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {hosting && <HostDialog game={hosting} onClose={() => setHosting(null)} />}
    </main>
  );
}

function HostDialog({ game, onClose }) {
  const [nickname, setNickname] = useState(getSavedNickname());
  const [maxPlayers, setMaxPlayers] = useState(game.maxPlayers);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  async function create(e) {
    e.preventDefault();
    const problem = validateNickname(nickname);
    if (problem) return setError(problem);
    setBusy(true);
    const res = await request('room:create', {
      gameId: game.id,
      maxPlayers,
      nickname: nickname.trim(),
      token: getToken(),
    });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    saveNickname(nickname.trim());
    navigate(`/room/${res.code}`);
  }

  const counts = [];
  for (let n = game.minPlayers; n <= game.maxPlayers; n++) counts.push(n);

  return (
    <Modal title={`Host ${game.name}`} onClose={onClose}>
      <form className="form" onSubmit={create}>
        <label>
          Your nickname
          <input
            autoFocus
            value={nickname}
            onChange={(e) => {
              setNickname(e.target.value);
              setError(null);
            }}
            maxLength={16}
            placeholder="2–16 characters"
          />
        </label>
        <label>
          Max players
          <select value={maxPlayers} onChange={(e) => setMaxPlayers(Number(e.target.value))}>
            {counts.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <p className="muted small">You can change game options in the lobby.</p>
        {error && <p className="error">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Creating…' : 'Create room'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
