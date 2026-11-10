import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useRoom } from '../hooks/useRoom.js';
import { request } from '../lib/socket.js';
import { getSavedNickname, validateNickname } from '../lib/session.js';
import { preloadCardImages } from '../cards/preload.js';
import { useToast } from '../components/Toasts.jsx';
import { Lobby } from './Lobby.jsx';
import { GameTable } from './GameTable.jsx';

export function RoomPage() {
  const { code: rawCode } = useParams();
  const toast = useToast();
  const navigate = useNavigate();
  const tableRef = useRef(null);
  const [privateLog, setPrivateLog] = useState([]);

  const onEvent = useCallback(
    (ev) => {
      if (ev.toast) toast(ev.text, ev.tone ?? (ev.type === 'gameOver' ? 'good' : 'info'));
      if (ev.to && ev.text) setPrivateLog((l) => [...l.slice(-49), { t: ev.t, text: ev.text, private: true }]);
      tableRef.current?.onGameEvent(ev);
    },
    [toast],
  );

  const room = useRoom(rawCode, onEvent);

  useEffect(() => {
    preloadCardImages();
  }, []);

  useEffect(() => {
    const name = room.state?.room?.gameName;
    document.title = name ? `${name} · ${room.code} — Card Table` : 'Card Table';
    return () => {
      document.title = 'Card Table';
    };
  }, [room.state?.room?.gameName, room.code]);

  if (room.phase === 'connecting' || (room.phase === 'joined' && !room.state)) {
    return (
      <main className="page narrow center-page">
        <div className="spinner" aria-hidden="true" />
        <p className="muted">Joining room {room.code}…</p>
      </main>
    );
  }

  if (room.phase === 'nickname') {
    return <NicknameGate room={room} />;
  }

  if (room.phase === 'error' || room.phase === 'evicted') {
    return (
      <main className="page narrow center-page">
        <h1>{room.phase === 'evicted' ? 'You are no longer in this room' : "Can't join this room"}</h1>
        <p className="lead">{room.error}</p>
        <div className="row gap">
          <Link className="btn btn-primary" to="/">
            Back home
          </Link>
          {room.phase === 'error' && (
            <button className="btn btn-ghost" onClick={() => room.join()}>
              Try again
            </button>
          )}
        </div>
      </main>
    );
  }

  const { state } = room;
  const leave = async () => {
    await request('room:leave');
    navigate('/');
  };

  return (
    <>
      {!room.connected && <div className="conn-banner">Connection lost — reconnecting…</div>}
      {state.room.status === 'lobby' ? (
        <Lobby state={state} chat={room.chat} onLeave={leave} />
      ) : (
        <GameTable
          ref={tableRef}
          state={state}
          chat={room.chat}
          privateLog={privateLog}
          serverNow={room.serverNow}
          onLeave={leave}
        />
      )}
    </>
  );
}

function NicknameGate({ room }) {
  const [nickname, setNickname] = useState(getSavedNickname());
  const [localError, setLocalError] = useState(null);
  const [busy, setBusy] = useState(false);
  const s = room.summary;

  async function submit(e) {
    e.preventDefault();
    const problem = validateNickname(nickname);
    if (problem) return setLocalError(problem);
    setLocalError(null);
    setBusy(true);
    await room.join(nickname.trim());
    setBusy(false);
  }

  const err = localError ?? room.error;
  return (
    <main className="page narrow center-page">
      <div className="panel join-panel">
        <h1>{s ? `Join ${s.gameName}` : 'Join the table'}</h1>
        <p className="muted">
          Room {room.code}
          {s && `, ${s.players}/${s.maxPlayers} players, ${s.status === 'playing' ? 'game in progress' : 'waiting in lobby'}`}
        </p>
        <form className="form" onSubmit={submit}>
          <label>
            Pick a nickname
            <input
              autoFocus
              value={nickname}
              maxLength={16}
              onChange={(e) => {
                setNickname(e.target.value);
                setLocalError(null);
              }}
              placeholder="2–16 characters"
              aria-invalid={Boolean(err)}
            />
          </label>
          {err && <p className="error">{err}</p>}
          <button className="btn btn-primary btn-block" disabled={busy}>
            {busy ? 'Joining…' : 'Join'}
          </button>
        </form>
        <Link to="/" className="small muted">
          Back home
        </Link>
      </div>
    </main>
  );
}
