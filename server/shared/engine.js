// Helpers shared by game engine modules.
//
// Engine contract (each module in /games/<id>/index.js):
//   meta                      { id, name, minPlayers, maxPlayers, description, options: [...] }
//   createGame(players, options)            players = [{ id, name }], options includes `seed`
//   getPublicState(game)                    info anyone may see
//   getPlayerView(game, playerId)           public state + that player's own hand only
//   getLegalActions(game, playerId)         action descriptors the UI renders generically
//   applyAction(game, playerId, action)     -> { state, events } | { error }
//   isGameOver(game) / getResults(game)
//   getAutoAction(game, playerId)           optional: move used for timeouts / disconnected players
//
// Engines never mutate their input: applyAction clones first.

export const SYSTEM = '__system__';

export function clone(value) {
  return structuredClone(value);
}

export function ok(state, events = []) {
  return { state, events };
}

export function fail(error) {
  return { error };
}

export function nameOf(game, playerId) {
  return game.names?.[playerId] ?? 'Someone';
}

export function namesMap(players) {
  return Object.fromEntries(players.map((p) => [p.id, p.name ?? p.id]));
}

/** Index of the next seat after `idx` for which `eligible(index)` is true; -1 if none. */
export function nextSeat(count, idx, eligible = () => true) {
  for (let step = 1; step <= count; step++) {
    const i = (idx + step) % count;
    if (eligible(i)) return i;
  }
  return -1;
}

/**
 * Turn a score map into ranked results. Ties share a place.
 * @param {string[]} playerIds
 * @param {(id:string)=>number} scoreOf
 * @param {{lowWins?: boolean, label?: (id:string)=>string}} [o]
 */
export function rankPlayers(playerIds, scoreOf, { lowWins = false, label } = {}) {
  const sorted = playerIds.slice().sort((a, b) => (lowWins ? scoreOf(a) - scoreOf(b) : scoreOf(b) - scoreOf(a)));
  const rankings = [];
  sorted.forEach((id, i) => {
    const prev = rankings[i - 1];
    const place = prev && scoreOf(prev.playerId) === scoreOf(id) ? prev.place : i + 1;
    rankings.push({ playerId: id, place, score: scoreOf(id), label: label ? label(id) : undefined });
  });
  return { rankings, winners: rankings.filter((r) => r.place === 1).map((r) => r.playerId) };
}

/** Build a choice param for the generic action UI. */
export function choiceParam(name, label, options, def) {
  return { name, label, type: 'choice', options, default: def ?? options[0]?.value };
}

export function isPlainAction(action) {
  return action && typeof action === 'object' && typeof action.type === 'string';
}
