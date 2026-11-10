// Socket.io wiring: translates socket events into RoomManager calls.
// Every handler acknowledges with { ok: true } or { ok: false, code, error }.

export function setupSockets(io, rooms) {
  /** `${code}:${playerId}` -> Set<socket> */
  const socketsBySeat = new Map();
  const seatKey = (code, pid) => `${code}:${pid}`;

  rooms.setEmitter({
    toPlayer: (code, pid, event, payload) => io.to(`p:${code}:${pid}`).emit(event, payload),
    toRoom: (code, event, payload) => io.to(`r:${code}`).emit(event, payload),
    evict: (code, pid, reason) => {
      for (const s of [...(socketsBySeat.get(seatKey(code, pid)) ?? [])]) {
        s.emit('room:evicted', { reason });
        unbind(s, { notify: false });
      }
    },
  });

  function unbind(socket, { notify = true } = {}) {
    const { code, playerId } = socket.data;
    if (!code) return;
    socket.leave(`r:${code}`);
    socket.leave(`p:${code}:${playerId}`);
    const set = socketsBySeat.get(seatKey(code, playerId));
    set?.delete(socket);
    if (set && !set.size) socketsBySeat.delete(seatKey(code, playerId));
    socket.data.code = null;
    socket.data.playerId = null;
    if (notify) rooms.detach(code, playerId);
  }

  async function bind(socket, code, playerId) {
    if (socket.data.code === code && socket.data.playerId === playerId) {
      const room = await rooms.getRoom(code);
      if (room) socket.emit('room:state', rooms.stateFor(room, playerId));
      return;
    }
    unbind(socket);
    socket.data.code = code;
    socket.data.playerId = playerId;
    socket.join(`r:${code}`);
    socket.join(`p:${code}:${playerId}`);
    const key = seatKey(code, playerId);
    if (!socketsBySeat.has(key)) socketsBySeat.set(key, new Set());
    socketsBySeat.get(key).add(socket);
    const room = await rooms.getRoom(code);
    socket.emit('chat:history', rooms.chatHistory(room));
    await rooms.attach(code, playerId);
  }

  io.on('connection', (socket) => {
    socket.data = { code: null, playerId: null };

    const on = (event, fn) =>
      socket.on(event, async (payload, ack) => {
        const reply = typeof ack === 'function' ? ack : () => {};
        try {
          reply((await fn(payload && typeof payload === 'object' ? payload : {})) ?? { ok: true });
        } catch (e) {
          console.error(`[socket] ${event} failed`, e);
          reply({ ok: false, error: 'Server error. Please try again.' });
        }
      });

    const seated = (fn) => async (payload) => {
      const { code, playerId } = socket.data;
      if (!code) return { ok: false, code: 'NOT_SEATED', error: 'You are not in a room.' };
      return fn(code, playerId, payload);
    };

    on('room:create', async (p) => {
      const res = await rooms.createRoom(p);
      if (res.ok) await bind(socket, res.code, res.playerId);
      return res;
    });

    on('room:join', async (p) => {
      const res = await rooms.joinRoom(p);
      if (res.ok) await bind(socket, res.code, res.playerId);
      return res;
    });

    on('room:leave', seated((code, pid) => rooms.leave(code, pid)));
    on('lobby:ready', seated((code, pid, p) => rooms.setReady(code, pid, p.ready)));
    on('lobby:kick', seated((code, pid, p) => rooms.kick(code, pid, p.playerId)));
    on('lobby:settings', seated((code, pid, p) => rooms.updateSettings(code, pid, p)));
    on('game:start', seated((code, pid) => rooms.start(code, pid)));
    on('game:action', seated((code, pid, p) => rooms.action(code, pid, p.action)));
    on('game:playAgain', seated((code, pid) => rooms.playAgain(code, pid)));
    on('game:backToLobby', seated((code, pid) => rooms.backToLobby(code, pid)));
    on('chat:send', seated((code, pid, p) => rooms.chat(code, pid, p.text)));

    socket.on('disconnect', () => unbind(socket));
  });
}
