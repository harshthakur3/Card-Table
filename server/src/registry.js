// Discovers game modules: every folder in /games that has an index.js is a game.
// Adding a game = adding /games/<id>/index.js + /games/<id>/rules.md. Nothing here changes.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateOptionSchema } from '../shared/options.js';

const REQUIRED_FUNCTIONS = [
  'createGame',
  'getPublicState',
  'getPlayerView',
  'getLegalActions',
  'applyAction',
  'isGameOver',
  'getResults',
];

export function validateEngine(engine, folder) {
  const problems = [];
  if (!engine?.meta) problems.push('missing meta');
  const m = engine?.meta ?? {};
  for (const key of ['id', 'name', 'description']) if (!m[key]) problems.push(`meta.${key} missing`);
  if (!Number.isInteger(m.minPlayers) || !Number.isInteger(m.maxPlayers) || m.minPlayers > m.maxPlayers) {
    problems.push('meta.minPlayers/maxPlayers invalid');
  }
  if (folder && m.id && m.id !== folder) problems.push(`meta.id "${m.id}" must match folder "${folder}"`);
  for (const fn of REQUIRED_FUNCTIONS) if (typeof engine?.[fn] !== 'function') problems.push(`${fn}() missing`);
  problems.push(...validateOptionSchema(m.options ?? []));
  return problems;
}

export async function loadGames(dir) {
  const games = new Map();
  const folders = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_') && !d.name.startsWith('.'));

  for (const folder of folders) {
    const modPath = path.join(dir, folder.name, 'index.js');
    if (!fs.existsSync(modPath)) continue;
    const mod = await import(pathToFileURL(modPath).href);
    const engine = mod.default ?? mod;
    const problems = validateEngine(engine, folder.name);
    if (problems.length) {
      console.warn(`[games] skipping "${folder.name}": ${problems.join('; ')}`);
      continue;
    }
    const rulesPath = path.join(dir, folder.name, 'rules.md');
    const rules = fs.existsSync(rulesPath) ? fs.readFileSync(rulesPath, 'utf8') : `# ${engine.meta.name}\n\nRules coming soon.`;
    games.set(engine.meta.id, { engine, rules });
  }
  return games;
}

export function publicMeta(meta) {
  return {
    id: meta.id,
    name: meta.name,
    minPlayers: meta.minPlayers,
    maxPlayers: meta.maxPlayers,
    description: meta.description,
    tagline: meta.tagline ?? '',
    order: meta.order ?? 100,
    options: meta.options ?? [],
  };
}
