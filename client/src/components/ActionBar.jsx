import { useEffect, useMemo, useState } from 'react';

/** Default value for a param descriptor. */
function defaultFor(p) {
  if (p.default !== undefined) return p.default;
  if (p.type === 'number') {
    let v = p.min ?? 0;
    while ((p.disallowed ?? []).includes(v) && v < (p.max ?? v)) v++;
    return v;
  }
  const first = p.options?.[0];
  return first && typeof first === 'object' ? first.value : first;
}

function optionList(p, names) {
  return (p.options ?? []).map((o) => {
    if (o && typeof o === 'object') return o;
    return { value: o, label: p.type === 'player' ? names[o] ?? o : String(o) };
  });
}

function ParamInput({ p, value, onChange, names }) {
  if (p.type === 'number') {
    const values = [];
    for (let v = p.min ?? 0; v <= (p.max ?? 0); v++) values.push(v);
    if (values.length <= 14) {
      return (
        <div className="chips" role="radiogroup" aria-label={p.label}>
          {values.map((v) => {
            const blocked = (p.disallowed ?? []).includes(v);
            return (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={value === v}
                className={`chip ${value === v ? 'on' : ''}`}
                disabled={blocked}
                title={blocked ? p.disallowedReason ?? 'Not allowed' : undefined}
                onClick={() => onChange(v)}
              >
                {p.labels?.[v] ?? v}
              </button>
            );
          })}
        </div>
      );
    }
    return (
      <input
        type="number"
        className="num-input"
        min={p.min}
        max={p.max}
        value={value}
        aria-label={p.label}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    );
  }
  const opts = optionList(p, names);
  if (opts.length <= 7) {
    return (
      <div className="chips" role="radiogroup" aria-label={p.label}>
        {opts.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            className={`chip ${value === o.value ? 'on' : ''}`}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    );
  }
  return (
    <select value={String(value)} aria-label={p.label} onChange={(e) => onChange(opts.find((o) => String(o.value) === e.target.value)?.value)}>
      {opts.map((o) => (
        <option key={String(o.value)} value={String(o.value)}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/**
 * Generic action UI: every game describes its moves as descriptors
 *   { type, label, style, optional, cards: {min, max, allowed}, params: [...] }
 * and this bar renders buttons, pickers and validation for them.
 */
export function ActionBar({ actions, selected, onSubmit, names, busy }) {
  const [values, setValues] = useState({});
  const signature = useMemo(
    () => JSON.stringify(actions.map((a) => [a.type, (a.params ?? []).map((p) => [p.name, p.default, p.min, p.max])])),
    [actions],
  );
  useEffect(() => setValues({}), [signature]);

  if (!actions.length) return null;

  const valueOf = (a, p) => values[`${a.type}.${p.name}`] ?? defaultFor(p);
  const setValue = (a, p, v) => setValues((s) => ({ ...s, [`${a.type}.${p.name}`]: v }));

  return (
    <div className="action-bar">
      {actions.map((a) => {
        const spec = a.cards;
        let hint = null;
        let cardsOk = true;
        if (spec) {
          const n = selected.length;
          const allowedOk = !spec.allowed || selected.every((id) => spec.allowed.includes(id));
          cardsOk = n >= spec.min && n <= spec.max && allowedOk;
          if (!cardsOk) {
            hint = spec.min === spec.max ? `Select ${spec.min} card${spec.min > 1 ? 's' : ''}` : `Select ${spec.min}–${spec.max} cards`;
          }
        }
        const params = a.params ?? [];
        const paramsOk = params.every((p) => {
          const v = valueOf(a, p);
          if (v === undefined || v === null || v === '') return false;
          return !(p.disallowed ?? []).includes(v);
        });
        const enabled = cardsOk && paramsOk && !busy;
        const submit = () => {
          const action = { type: a.type };
          if (spec) action.cards = selected;
          for (const p of params) action[p.name] = valueOf(a, p);
          onSubmit(action, a);
        };
        return (
          <div key={a.type} className={`action-group ${params.length ? 'has-params' : ''}`}>
            {params.map((p) => (
              <div key={p.name} className="param">
                <span className="param-label">{p.label}</span>
                <ParamInput p={p} value={valueOf(a, p)} onChange={(v) => setValue(a, p, v)} names={names} />
              </div>
            ))}
            <button
              className={`btn btn-${a.style ?? 'primary'} action-btn`}
              disabled={!enabled}
              title={hint ?? a.help ?? undefined}
              onClick={submit}
            >
              {a.label}
              {spec && cardsOk && selected.length > 0 && <span className="btn-count">{selected.length}</span>}
            </button>
            {hint && spec && selected.length > 0 && <span className="action-hint">{hint}</span>}
          </div>
        );
      })}
    </div>
  );
}
