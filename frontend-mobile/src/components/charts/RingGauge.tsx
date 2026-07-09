interface RingGaugeProps {
  label: string;
  value: number | null;
  color?: 'accent' | 'success' | 'warning' | 'danger' | 'default';
  size?: 'sm' | 'md';
}

const R = 26;
const C = 2 * Math.PI * R;

const STROKE: Record<NonNullable<RingGaugeProps['color']>, string> = {
  accent: 'var(--accent)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
  default: 'var(--muted)',
};

export default function RingGauge({ label, value, color = 'accent', size = 'md' }: RingGaugeProps) {
  const pct = value == null ? 0 : Math.min(100, Math.max(0, value));
  const offset = C - (pct / 100) * C;
  const dim = size === 'sm' ? 64 : 80;
  const display = value == null ? '—' : `${Math.round(pct)}%`;

  return (
    <div className={`ring-gauge ring-gauge-${size}`} data-size={size}>
      <svg width={dim} height={dim} viewBox="0 0 64 64" className="ring-gauge-svg" role="img" aria-label={`${label} ${display}`}>
        <circle cx="32" cy="32" r={R} className="ring-gauge-track" />
        <circle
          cx="32"
          cy="32"
          r={R}
          className="ring-gauge-fill"
          stroke={STROKE[color]}
          strokeDasharray={C}
          strokeDashoffset={offset}
          style={{ '--ring-c': C, '--ring-offset': offset } as React.CSSProperties}
        />
        <text x="32" y="34" textAnchor="middle" className="ring-gauge-text">{display}</text>
      </svg>
      <span className="ring-gauge-label">{label}</span>
    </div>
  );
}