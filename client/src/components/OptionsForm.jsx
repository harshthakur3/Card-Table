/** Renders a game's option schema (meta.options). Read-only for non-hosts. */
export function OptionsForm({ schema = [], values = {}, editable, onChange }) {
  if (!schema.length) return <p className="muted small">This game has no extra options.</p>;
  return (
    <div className="options-form">
      {schema.map((opt) => {
        const value = values[opt.key] ?? opt.default;
        const id = `opt-${opt.key}`;
        let control;
        if (opt.type === 'boolean') {
          control = (
            <label className="switch">
              <input
                id={id}
                type="checkbox"
                checked={Boolean(value)}
                disabled={!editable}
                onChange={(e) => onChange(opt.key, e.target.checked)}
              />
              <span className="switch-track" aria-hidden="true" />
              <span>{opt.label}</span>
            </label>
          );
          return (
            <div key={opt.key} className="option-row">
              {control}
              {opt.help && <small className="muted">{opt.help}</small>}
            </div>
          );
        }
        if (opt.type === 'select') {
          control = (
            <select
              id={id}
              value={String(value)}
              disabled={!editable}
              onChange={(e) => {
                const choice = opt.choices.find((c) => String(c.value) === e.target.value);
                onChange(opt.key, choice ? choice.value : e.target.value);
              }}
            >
              {opt.choices.map((c) => (
                <option key={String(c.value)} value={String(c.value)}>
                  {c.label}
                </option>
              ))}
            </select>
          );
        } else {
          control = (
            <input
              id={id}
              type="number"
              min={opt.min}
              max={opt.max}
              step={opt.step ?? 1}
              value={value}
              disabled={!editable}
              onChange={(e) => onChange(opt.key, Number(e.target.value))}
            />
          );
        }
        return (
          <div key={opt.key} className="option-row">
            <label htmlFor={id}>{opt.label}</label>
            {control}
            {opt.help && <small className="muted">{opt.help}</small>}
          </div>
        );
      })}
    </div>
  );
}
