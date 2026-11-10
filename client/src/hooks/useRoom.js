import { useCallback, useEffect, useRef, useState } from 'react';
import { request, socket } from '../lib/socket.js';
import { getToken, saveNickname } from '../lib/session.js';
import { fetchRoomSummary } from '../lib/api.js';

/**
 * Connects this tab to a room.
 * phase: connecting | nickname | joined | error | evicted
 * Reconnects automatically: on socket reconnect we re-join with the guest token, which
 * restores the same seat on the server.
 */
export function useRoom(rawCode, onEvent) {
  const code = String(rawCode ?? '').toUpperCase();
  const [phase, setPhase] = useState('connecting');
  const [state, setState] = useState(null);
  const [chat, setChat] = useState([]);
  const [error, setError] = useState(null);
  const [summary, setSummary] = useState(null);
  const [connected, setConnected] = useState(socket.connected);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const offsetRef = useRef(0);

  const join = useCallback(
    async (nickname) => {
      const res = await request('room:join', { code, nickname, token: getToken() });
      if (res.ok) {
        if (nickname) saveNickname(nickname);
        setError(null);
        setPhase('joined');
        return res;
      }
      if (res.code === 'NEED_NICKNAME') {
        setError(null);
        setPhase('nickname');
        fetchRoomSummary(code)
          .then(setSummary)
          .catch(() => {});
        return res;
      }
      if (nickname && (res.code === 'NICK_TAKEN' || res.code === 'INVALID')) {
        setError(res.error);
        setPhase('nickname');
        return res;
      }
      if (res.code === 'TIMEOUT' && phaseRef.current === 'joined') return res; // keep the table up while reconnecting
      setError(res.error ?? 'Could not join the room.');
      setPhase('error');
      return res;
    },
    [code],
  );

  useEffect(() => {
    const onState = (s) => {
      if (s.room.code !== code) return;
      offsetRef.current = s.serverNow - Date.now();
      setState(s);
    };
    const onHistory = (h) => setChat(h);
    const onChat = (m) => setChat((c) => [...c.slice(-99), m]);
    const onGameEvent = (ev) => onEventRef.current?.(ev);
    const onEvicted = ({ reason }) => {
      setPhase('evicted');
      setError(reason === 'kicked' ? 'The host removed you from this room.' : 'You left the room.');
    };
    const onConnect = () => {
      setConnected(true);
      if (phaseRef.current === 'joined') join();
    };
    const onDisconnect = () => setConnected(false);

    socket.on('room:state', onState);
    socket.on('chat:history', onHistory);
    socket.on('chat:message', onChat);
    socket.on('game:event', onGameEvent);
    socket.on('room:evicted', onEvicted);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    setPhase('connecting');
    setState(null);
    join();
    return () => {
      socket.off('room:state', onState);
      socket.off('chat:history', onHistory);
      socket.off('chat:message', onChat);
      socket.off('game:event', onGameEvent);
      socket.off('room:evicted', onEvicted);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, [code, join]);

  const serverNow = useCallback(() => Date.now() + offsetRef.current, []);

  return { code, phase, state, chat, error, summary, connected, join, serverNow };
}
