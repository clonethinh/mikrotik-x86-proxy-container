import GlassCard from './GlassCard';

interface MetricTileProps {
  label: string;
  value: string | number;
  hint?: string;
  accent?: boolean;
  delay?: number;
}

export default function MetricTile({ label, value, hint, accent, delay = 0 }: MetricTileProps) {
  return (
    <GlassCard delay={delay} className="metric-card p-3">
      <div className="metric-label">{label}</div>
      <div className={`metric-value ${accent ? 'metric-value-accent' : ''}`}>{value}</div>
      {hint ? <div className="metric-hint">{hint}</div> : null}
    </GlassCard>
  );
}