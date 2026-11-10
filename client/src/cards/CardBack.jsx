import { useId } from 'react';

const fill = (token) => ({ fill: `var(${token})` });

/** The pack has no card back, so we draw one: a warm lattice inside a cream border. Colours come from the theme tokens. */
export function CardBack() {
  const pid = `cb${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <svg className="card-svg" viewBox="0 0 167 243" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <pattern id={pid} width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="12" height="12" style={fill('--color-back')} />
          <rect width="6" height="6" style={fill('--color-back-2')} />
          <circle cx="9" cy="9" r="1.4" style={fill('--color-back-3')} />
        </pattern>
      </defs>
      <rect x="0.5" y="0.5" width="166" height="242" rx="11" style={fill('--color-card')} />
      <rect
        x="8"
        y="8"
        width="151"
        height="227"
        rx="7"
        fill={`url(#${pid})`}
        style={{ stroke: 'var(--color-back-line)' }}
        strokeWidth="2"
      />
      <g transform="translate(83.5 121.5)">
        <path d="M0 -30 L20 0 L0 30 L-20 0Z" style={fill('--color-back-trim')} />
        <path d="M0 -19 L12.5 0 L0 19 L-12.5 0Z" style={fill('--color-back')} />
        <circle r="4" style={fill('--color-back-trim')} />
      </g>
    </svg>
  );
}
