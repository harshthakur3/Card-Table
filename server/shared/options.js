// Game option schemas. A game's meta.options is a list of:
//   { key, label, type: 'select', choices: [{ value, label }], default, help? }
//   { key, label, type: 'number', min, max, step?, default, help? }
//   { key, label, type: 'boolean', default, help? }
// The host edits these in the lobby; the server always normalizes them before use.

export function defaultOptions(schema = []) {
  return Object.fromEntries(schema.map((o) => [o.key, o.default]));
}

export function normalizeOptions(schema = [], input = {}, base = defaultOptions(schema)) {
  const out = {};
  for (const opt of schema) {
    const has = input && Object.prototype.hasOwnProperty.call(input, opt.key);
    const raw = has ? input[opt.key] : base[opt.key];
    out[opt.key] = normalizeOne(opt, raw);
  }
  return out;
}

function normalizeOne(opt, raw) {
  switch (opt.type) {
    case 'boolean':
      return typeof raw === 'boolean' ? raw : Boolean(opt.default);
    case 'number': {
      const n = Number(raw);
      if (!Number.isFinite(n)) return opt.default;
      const step = opt.step ?? 1;
      const snapped = Math.round(n / step) * step;
      return Math.min(opt.max ?? Infinity, Math.max(opt.min ?? -Infinity, snapped));
    }
    case 'select': {
      const match = opt.choices.find((c) => c.value === raw || String(c.value) === String(raw));
      return match ? match.value : opt.default;
    }
    default:
      return opt.default;
  }
}

/** Basic structural check used by the server registry and the tests. */
export function validateOptionSchema(schema) {
  const problems = [];
  if (!Array.isArray(schema)) return ['options must be an array'];
  const keys = new Set();
  for (const o of schema) {
    if (!o.key) problems.push('option without key');
    if (keys.has(o.key)) problems.push(`duplicate option ${o.key}`);
    keys.add(o.key);
    if (!['select', 'number', 'boolean'].includes(o.type)) problems.push(`${o.key}: unknown type ${o.type}`);
    if (o.type === 'select' && !o.choices?.some((c) => c.value === o.default)) problems.push(`${o.key}: default not in choices`);
    if (o.type === 'number' && (o.default < o.min || o.default > o.max)) problems.push(`${o.key}: default out of range`);
  }
  return problems;
}
