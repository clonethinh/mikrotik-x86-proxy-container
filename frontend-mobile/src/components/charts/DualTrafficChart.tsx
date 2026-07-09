import { useMemo } from 'react';
import { buildLinePath, normalizeSeries } from '../../lib/chartUtils';

interface DualTrafficChartProps {
  rx: number[];
  tx: number[];
  width?: number;
  height?: number;
}

export default function DualTrafficChart({
  rx,
  tx,
  width = 320,
  height = 100,
}: DualTrafficChartProps) {
  const combined = useMemo(() => [...rx, ...tx], [rx, tx]);
  const max = useMemo(() => Math.max(...combined, 1), [combined]);

  const rxNorm = useMemo(() => normalizeSeries(rx.map((v) => v / max)), [rx, max]);
  const txNorm = useMemo(() => normalizeSeries(tx.map((v) => v / max)), [tx, max]);

  const rxPath = useMemo(() => buildLinePath(rxNorm, width, height), [rxNorm, width, height]);
  const txPath = useMemo(() => buildLinePath(txNorm, width, height), [txNorm, width, height]);

  if (rx.length < 2) return <div className="chart-empty" style={{ height }}>Chưa có traffic history</div>;

  return (
    <div className="chart-wrap">
      <div className="chart-legend">
        <span className="chart-legend-item"><i className="dot dot-rx" /> Download</span>
        <span className="chart-legend-item"><i className="dot dot-tx" /> Upload</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="chart-svg chart-animate" preserveAspectRatio="none">
        <path d={rxPath} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" className="chart-line chart-line-rx" />
        <path d={txPath} fill="none" stroke="var(--success)" strokeWidth="2" strokeLinecap="round" className="chart-line chart-line-tx" />
      </svg>
    </div>
  );
}