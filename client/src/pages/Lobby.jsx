import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchGames } from '../lib/api.js';
import { request } from '../lib/socket.js';
import { useToast } from '../components/Toasts.jsx';
import { Chat } from '../components/Chat.jsx';
import { OptionsForm } from '../components/OptionsForm.jsx';
import { RulesPanel } from '../components/RulesPanel.jsx';
import { useConfirm } from '../components/ConfirmDialog.jsx';

const TIMER_CHOICES = [0, 15, 30, 45, 60, 90, 120];

export function Lobby({ state, chat, onLeave }) {
  const { room, me } = state;
  const toast = useToast();
  const [games, setGames] = useState([]);
  const [showRules, setShowRules] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmEl, askConfirm] = useConfirm();
  const isHost = room.hostId === me;
  const self = room.players.find((p) => p.id === me);
  const meta = games.find((g) => g.id === room.gameId);
  const link = `${window.location.origin}/room/${room.code}`;

  useEffect(() => {
    fetchGames().then(setGames).catch(() => {});
  }, []);

  async function call(event, payload) {
    const res = await request(event, payload);
    if (!res.ok) toast(res.error, 'error');
    return res;
  }

  const notReady = room.players.filter((p) => p.id !== room.hostId && !p.ready);
  const count = room.players.length;
  let startBlocker = null;
  if (count < room.minPlayers) startBlocker = `Need at least ${room.minPlayers} players (${count} here).`;
  else if (notReady.length) startBlocker = `Waiting for ${notReady.map((p) => p.nickname).join(', ')} to be ready.`;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      toast('Invite link copied!', 'good');
    } catch {
      toast(link, 'info', 6000);
    }
  }

  async function share() {
    if (navigator.share) {
      navigator.share({ title: `Join my ${room.gameName} table`, text: `Room code ${room.code}`, url: link }).catch(() => {});
    } else copyLink();
  }

  async function start() {
    setBusy(true);
    await call('game:start');
    setBusy(false);
  }

  const counts = [];
  for (let n = Math.max(room.minPlayers, count); n <= room.maxPlayersAllowed; n++) counts.push(n);

  return (
    <main className="page lobby">
      <section className="panel lobby-main">
        <header className="lobby-head">
          <div>
            <h1>{room.gameName}</h1>
            <p className="muted small">Lobby</p>
          </div>
          <div className="row gap-s">
            <button className="btn btn-ghost btn-small" onClick={() => setShowRules(true)}>
              Rules
            </button>
            <button className="btn btn-ghost btn-small" onClick={onLeave}>
              Leave
            </button>
          </div>
        </header>

        <div className="share-box">
          <div>
            <span className="muted small">Room code</span>
            <div className="room-code" aria-label={`Room code ${room.code.split('').join(' ')}`}>
              {room.code}
            </div>
          </div>
          <div className="share-actions">
            <button className="btn btn-small" onClick={copyLink}>
              Copy link
            </button>
            <button className="btn btn-small btn-ghost" onClick={share}>
              Share…
            </button>
          </div>
        </div>

        <h2 className="sub-title">
          Players <span className="muted">({count}/{room.maxPlayers})</span>
        </h2>
        <ul className="player-list">
          {room.players.map((p) => (
            <li key={p.id} className={`player-row ${p.connected ? '' : 'offline'}`}>
              <span className="avatar" aria-hidden="true">
                {p.nickname[0]?.toUpperCase()}
              </span>
              <span className="player-name">
                {p.nickname}
                {p.id === me && <span className="muted"> (you)</span>}
              </span>
              {p.isHost && <span className="badge badge-host">Host</span>}
              {!p.connected && <span className="badge badge-off">reconnecting…</span>}
              {!p.isHost && <span className={`ready-pill ${p.ready ? 'on' : ''}`}>{p.ready ? 'Ready' : 'Not ready'}</span>}
              {isHost && p.id !== me && (
                <button
                  className="btn btn-tiny btn-danger-ghost"
                  onClick={() => {
                    askConfirm(
                      { title: `Remove ${p.nickname}?`, message: 'They will not be able to rejoin this room.', confirmLabel: 'Kick', danger: true },
                      () => call('lobby:kick', { playerId: p.id }),
                    );
                  }}
                >
                  Kick
                </button>
              )}
            </li>
          ))}
          {Array.from({ length: Math.max(0, room.maxPlayers - count) }, (_, i) => (
            <li key={`empty${i}`} className="player-row empty">
              <span className="avatar" aria-hidden="true">
                ?
              </span>
              <span className="muted">Open seat</span>
            </li>
          ))}
        </ul>

        <div className="lobby-actions">
          {isHost ? (
            <>
              <button className="btn btn-primary btn-large" disabled={Boolean(startBlocker) || busy} onClick={start}>
                Start game
              </button>
              {startBlocker && <p className="muted small">{startBlocker}</p>}
            </>
          ) : (
            <>
              <button
                className={`btn btn-large ${self?.ready ? 'btn-ghost' : 'btn-primary'}`}
                onClick={() => call('lobby:ready', { ready: !self?.ready })}
              >
                {self?.ready ? "I'm not ready" : "I'm ready"}
              </button>
              <p className="muted small">The host starts the game once everyone is ready.</p>
            </>
          )}
        </div>
      </section>

      <section className="panel lobby-settings">
        <h2 className="sub-title">Table settings {!isHost && <span className="muted small">(host only)</span>}</h2>
        <div className="options-form">
          <div className="option-row">
            <label htmlFor="set-game">Game</label>
            <select
              id="set-game"
              value={room.gameId}
              disabled={!isHost}
              onChange={(e) => call('lobby:settings', { gameId: e.target.value })}
            >
              {games.map((g) => (
                <option key={g.id} value={g.id} disabled={g.maxPlayers < count}>
                  {g.name} ({g.minPlayers}–{g.maxPlayers})
                </option>
              ))}
            </select>
          </div>
          <div className="option-row">
            <label htmlFor="set-max">Max players</label>
            <select
              id="set-max"
              value={room.maxPlayers}
              disabled={!isHost}
              onChange={(e) => call('lobby:settings', { maxPlayers: Number(e.target.value) })}
            >
              {counts.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <div className="option-row">
            <label htmlFor="set-timer">Turn timer</label>
            <select
              id="set-timer"
              value={room.settings.turnTimer}
              disabled={!isHost}
              onChange={(e) => call('lobby:settings', { turnTimer: Number(e.target.value) })}
            >
              {TIMER_CHOICES.map((t) => (
                <option key={t} value={t}>
                  {t === 0 ? 'Off' : `${t} seconds`}
                </option>
              ))}
            </select>
            <small className="muted">When time runs out, a simple move is made for the player.</small>
          </div>
        </div>
        <h3 className="sub-title small-title">{room.gameName} options</h3>
        <OptionsForm
          schema={meta?.options ?? []}
          values={room.options}
          editable={isHost}
          onChange={(key, value) => call('lobby:settings', { options: { ...room.options, [key]: value } })}
        />
        <p className="small">
          <Link to={`/rules/${room.gameId}`} target="_blank" rel="noreferrer">
            Open the full rules in a new tab
          </Link>
        </p>
      </section>

      <section className="panel lobby-chat">
        <h2 className="sub-title">Chat</h2>
        <Chat messages={chat} me={me} />
      </section>

      {showRules && <RulesPanel gameId={room.gameId} onClose={() => setShowRules(false)} />}
      {confirmEl}
    </main>
  );
}
