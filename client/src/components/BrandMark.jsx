const SPADE =
  'M24.5 12.2c-2.6 3-6 5-6 8a3.2 3.2 0 0 0 5.2 2.5c-.2 1.5-.8 2.6-1.7 3.5h5c-.9-.9-1.5-2-1.7-3.5a3.2 3.2 0 0 0 5.2-2.5c0-3-3.4-5-6-8z';

/** The Card Table logo: two overlapping cards, the front one carrying a spade. Colours come from the theme tokens. */
export function BrandMark({ size = 34 }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <rect x="6" y="7" width="19" height="27" rx="4" transform="rotate(-14 15.5 20.5)" style={{ fill: 'var(--color-accent)' }} />
      <rect x="15" y="6" width="19" height="27" rx="4" transform="rotate(10 24.5 19.5)" style={{ fill: 'var(--color-card)' }} />
      <path d={SPADE} transform="rotate(10 24.5 19.5)" style={{ fill: 'var(--color-card-ink)' }} />
    </svg>
  );
}
