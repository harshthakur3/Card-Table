import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { request } from '../lib/socket.js';
import { useToast } from '../components/Toasts.jsx';
import { Hand } from '../components/Hand.jsx';
import { Seat, Zone, seatLayout } from '../components/Table.jsx';
import { ActionBar } from '../components/ActionBar.jsx';
import { Chat } from '../components/Chat.jsx';
import { GameLog } from '../components/GameLog.jsx';
import { RulesPanel } from '../components/RulesPanel.jsx';
import { Modal } from '../components/Modal.jsx';
import { useConfirm } from '../components/ConfirmDialog.jsx';
import { FlyingCards } from '../components/FlyingCards.jsx';

function useTicker(active, ms = 250) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => setTick((t) => t + 1), ms);
    return () => clearInterval(id);
  }, [active, ms]);
}

const PLACES = ['1st', '2nd', '3rd'];

export const GameTable = forwardRef(function GameTable({ state, chat, privateLog, serverNow, onLeave }, ref) {
  const { room, me, game, results, log } = state;
  const view = game?.view ?? { players: [], table: [], hand: [] };
  const actions = useMemo(() => game?.actions ?? [], [game?.actions]);
  const toAct = game?.toAct ?? [];
  const deadline = game?.deadline ?? null;
  const isHost = room.hostId === me;
  const [confirmEl, askConfirm] = useConfirm();
  const toast = useToast();

  const rootRef = useRef(null);
  const flyRef = useRef(null);
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState(null);
  const [sideTab, setSideTab] = useState('log');
  const [sideOpen, setSideOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [hideResults, setHideResults] = useState(false);

  const names = useMemo(() => Object.fromEntries(room.players.map((p) => [p.id, p.nickname])), [room.players]);
  const infoById = useMemo(() => Object.fromEntries(room.players.map((p) => [p.id, p])), [room.players]);
  const { others, pos } = useMemo(() => seatLayout(view.players, me), [view.players, me]);
  const mine = view.players.find((p) => p.id === me);
  const seatIds = view.players.map((p) => p.id);

  useImperativeHandle(ref, () => ({
    onGameEvent(ev) {
      if (ev.anim) flyRef.current?.play(ev.anim, { seats: seatIds });
    },
  }));

  // Deal animation whenever a new hand is dealt.
  const lastDeal = useRef(view.dealId);
  useEffect(() => {
    if (view.dealId != null && view.dealId !== lastDeal.current) {
      lastDeal.current = view.dealId;
      flyRef.current?.play({ kind: 'deal' }, { seats: seatIds });
    }
  }, [view.dealId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (room.status === 'playing') setHideResults(false);
  }, [room.status]);

  // Selection: only cards some current action accepts.
  const hand = useMemo(() => view.hand ?? [], [view.hand]);
  const cardActions = useMemo(() => actions.filter((a) => a.cards), [actions]);
  const allowed = useMemo(() => {
    const s = new Set();
    for (const a of cardActions) for (const id of a.cards.allowed ?? hand.map((c) => c.id)) s.add(id);
    return s;
  }, [cardActions, hand]);
  const maxSel = cardActions.reduce((m, a) => Math.max(m, a.cards.max), 0);
  const allowedKey = [...allowed].join(',');
  useEffect(() => {
    setSelected((sel) => sel.filter((id) => allowed.has(id)));
  }, [allowedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const myTurn = toAct.includes(me);
  const wasMyTurn = useRef(false);
  useEffect(() => {
    if (myTurn && !wasMyTurn.current) navigator.vibrate?.(40);
    wasMyTurn.current = myTurn;
  }, [myTurn]);

  // Unread chat badge.
  const chatLen = useRef(chat.length);
  useEffect(() => {
    const added = chat.length - chatLen.current;
    chatLen.current = chat.length;
    const visible = sideTab === 'chat' && (sideOpen || window.matchMedia('(min-width: 1000px)').matches);
    if (added > 0 && !visible) setUnread((u) => u + added);
  }, [chat.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (sideTab === 'chat') setUnread(0);
  }, [sideTab, sideOpen]);

  useTicker(Boolean(deadline));
  const remaining = deadline ? Math.max(0, deadline - serverNow()) : null;
  const total = (room.settings.turnTimer || 1) * 1000;
  const progress = remaining != null ? remaining / total : null;

  async function submit(action) {
    setBusy(true);
    const res = await request('game:action', { action });
    setBusy(false);
    if (!res.ok) toast(res.error, 'error');
    else setSelected([]);
  }

  function onCardClick(id) {
    setSelected((sel) => {
      if (sel.includes(id)) return sel.filter((x) => x !== id);
      if (maxSel <= 1) return [id];
      if (sel.length >= maxSel) return [...sel.slice(1), id];
      return [...sel, id];
    });
  }

  function onCardDoubleClick(id) {
    const candidates = cardActions.filter(
      (a) => !(a.params ?? []).length && a.cards.min <= 1 && a.cards.max >= 1 && (a.cards.allowed ?? [id]).includes(id),
    );
    if (candidates.length === 1) submit({ type: candidates[0].type, cards: [id] });
  }

  async function hostCall(event) {
    const res = await request(event);
    if (!res.ok) toast(res.error, 'error');
  }

  const mergedLog = useMemo(() => [...log, ...privateLog].sort((a, b) => a.t - b.t), [log, privateLog]);
  const waitingNames = toAct.filter((id) => id !== me).map((id) => names[id]);
  const finished = room.status === 'finished';

  return (
    <div className="game" ref={rootRef}>
      <header className="topbar">
        <button
          className="icon-btn"
          onClick={() =>
            askConfirm(
              { title: 'Leave this table?', message: 'A bot will play your cards for the rest of the game.', confirmLabel: 'Leave', danger: true },
              onLeave,
            )
          }
          aria-label="Leave room"
          title="Leave room"
        >
          ←
        </button>
        <div className="topbar-title">
          <strong>{room.gameName}</strong>
          <span className="topbar-code">{room.code}</span>
        </div>
        <div className="info-chips">
          {(view.info ?? []).map((i) => (
            <span key={i.label} className="info-chip">
              <span>{i.label}</span>
              <b>{i.value}</b>
            </span>
          ))}
        </div>
        {remaining != null && (
          <span className={`timer ${remaining < 6000 ? 'urgent' : ''}`} aria-label="Turn timer">
            {Math.ceil(remaining / 1000)}s
          </span>
        )}
        <div className="topbar-actions">
          {view.scoreboard && (
            <button className="btn btn-small btn-ghost" onClick={() => setPanel('scores')}>
              Scores
            </button>
          )}
          <button className="btn btn-small btn-ghost" onClick={() => setPanel('rules')}>
            Rules
          </button>
          <button
            className="btn btn-small btn-ghost side-toggle"
            onClick={() => {
              setSideOpen((o) => !o);
              setSideTab('chat');
            }}
          >
            Chat{unread > 0 && <span className="unread">{unread}</span>}
          </button>
          {isHost && room.status === 'playing' && (
            <button
              className="btn btn-small btn-danger-ghost"
              onClick={() =>
                askConfirm(
                  { title: 'End this game?', message: 'The game stops for everyone and the table goes back to the lobby.', confirmLabel: 'End game', danger: true },
                  () => hostCall('game:backToLobby'),
                )
              }
            >
              End
            </button>
          )}
        </div>
      </header>

      <div className="game-body">
        <main className="table-area">
          <div className="felt">
            {others.map((p) => (
              <Seat
                key={p.id}
                player={p}
                info={infoById[p.id]}
                pos={pos[p.id]}
                isTurn={toAct.includes(p.id)}
                isHost={room.hostId === p.id}
                progress={toAct.includes(p.id) ? progress : null}
              />
            ))}
            <div className="center" data-anchor="center">
              {view.table.map((z) => (
                <Zone key={z.id} zone={z} pos={pos} names={names} />
              ))}
            </div>
          </div>

          <div className={`turn-banner ${myTurn ? 'mine' : ''}`} aria-live="polite">
            {myTurn && <span className="your-turn">Your turn</span>}
            <span>{view.prompt || (waitingNames.length ? `Waiting for ${waitingNames.join(', ')}…` : '')}</span>
          </div>

          <ActionBar actions={actions} selected={selected} onSubmit={submit} names={names} busy={busy} />

          {mine && (
            <div className={`me-bar ${myTurn ? 'is-turn' : ''}`} data-seat={me}>
              <span className="avatar">{names[me]?.[0]?.toUpperCase()}</span>
              <span className="me-name">{names[me]}</span>
              {mine.cardCount != null && <span className="me-stat">{mine.cardCount} cards</span>}
              {mine.stats?.map((s) => (
                <span key={s.label} className="me-stat">
                  {s.label} <b>{s.value}</b>
                </span>
              ))}
              {mine.badge && <span className="seat-badge">{mine.badge}</span>}
              {myTurn && progress != null && (
                <span className="me-timer" style={{ '--p': progress }} aria-hidden="true" />
              )}
            </div>
          )}

          <Hand
            cards={hand}
            selected={selected}
            allowed={allowed}
            interactive={cardActions.length > 0}
            onCardClick={onCardClick}
            onCardDoubleClick={onCardDoubleClick}
            dealId={view.dealId}
            emptyText={view.handNote}
          />
        </main>

        <aside className={`side ${sideOpen ? 'open' : ''}`}>
          <div className="side-tabs" role="tablist">
            <button role="tab" aria-selected={sideTab === 'log'} className={sideTab === 'log' ? 'on' : ''} onClick={() => setSideTab('log')}>
              Game log
            </button>
            <button role="tab" aria-selected={sideTab === 'chat'} className={sideTab === 'chat' ? 'on' : ''} onClick={() => setSideTab('chat')}>
              Chat{unread > 0 && <span className="unread">{unread}</span>}
            </button>
            <button className="icon-btn side-close" onClick={() => setSideOpen(false)} aria-label="Close panel">
              ✕
            </button>
          </div>
          <div className="side-body">{sideTab === 'log' ? <GameLog entries={mergedLog} /> : <Chat messages={chat} me={me} />}</div>
        </aside>
      </div>

      {panel === 'rules' && <RulesPanel gameId={room.gameId} onClose={() => setPanel(null)} />}
      {panel === 'scores' && view.scoreboard && (
        <Modal title="Scores" wide onClose={() => setPanel(null)}>
          <Scoreboard board={view.scoreboard} />
        </Modal>
      )}

      {finished && results && !hideResults && (
        <Modal title="Game over" onClose={() => setHideResults(true)} className="results-modal">
          <p className="results-summary">{results.summary}</p>
          <ol className="rankings">
            {(results.rankings ?? []).map((r) => (
              <li key={r.playerId ?? r.name} className={r.place === 1 ? 'first' : ''}>
                <span className="place">{PLACES[r.place - 1] ?? `${r.place}th`}</span>
                <span className="rk-name">
                  {r.name ?? names[r.playerId] ?? 'Player'}
                  {r.playerId === me && <span className="muted"> (you)</span>}
                </span>
                <span className="rk-score">{r.label ?? r.score}</span>
              </li>
            ))}
          </ol>
          {view.scoreboard && (
            <details className="results-details">
              <summary>Round by round</summary>
              <Scoreboard board={view.scoreboard} />
            </details>
          )}
          {isHost ? (
            <div className="form-actions">
              <button className="btn btn-ghost" onClick={() => hostCall('game:backToLobby')}>
                Back to lobby
              </button>
              <button className="btn btn-primary" onClick={() => hostCall('game:playAgain')}>
                Play again
              </button>
            </div>
          ) : (
            <p className="muted">Waiting for the host to play again…</p>
          )}
        </Modal>
      )}
      {finished && hideResults && (
        <button className="btn btn-primary results-reopen" onClick={() => setHideResults(false)}>
          Show results
        </button>
      )}
      {confirmEl}
      <FlyingCards ref={flyRef} rootRef={rootRef} />
    </div>
  );
});

function Scoreboard({ board }) {
  return (
    <div className="table-scroll">
      <table className="score-table">
        <thead>
          <tr>
            {board.columns.map((c) => (
              <th key={c.key}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {board.rows.map((r, i) => (
            <tr key={i} className={r._total ? 'total' : ''}>
              {board.columns.map((c) => (
                <td key={c.key}>{r[c.key] ?? ''}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
