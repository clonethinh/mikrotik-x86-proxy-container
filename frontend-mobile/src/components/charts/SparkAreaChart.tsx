import { useId, useMemo } from 'react';
import { buildAreaPath, buildLinePath, normalizeSeries } from '../../lib/chartUtils';

interface SparkAreaChartProps {
  data: number[];
  width?: number;
  height?: number;
  color?: 'accent' | 'success' | 'warning' | 'danger';
  label?: string;
  showGrid?: boolean;
}

const COLOR_MAP = {
  accent: { stroke: 'var(--accent)', fill: 'url(#grad-accent)' },
  success: { stroke: 'var(--success)', fill: 'url(#grad-success)' },
  warning: { stroke: 'var(--warning)', fill: 'url(#grad-warning)' },
  danger: { stroke: 'var(--danger)', fill: 'url(#grad-danger)' },
};

export default function SparkAreaChart({
  data,
  width = 320,
  height = 88,
  color = 'accent',
  label,
  showGrid = true,
}: SparkAreaChartProps) {
  const uid = useId().replace(/:/g, '');
  const gradId = `grad-${color}-${uid}`;
  const colors = COLOR_MAP[color];

  const normalized = useMemo(() => normalizeSeries(data), [data]);
  const area = useMemo(() => buildAreaPath(normalized, width, height), [normalized, width, height]);
  const line = useMemo(() => buildLinePath(normalized, width, height), [normalized, width, height]);

  if (data.length < 2) {
    return (
      <div className="chart-empty" style={{ height }}>
        Chưa đủ dữ liệu biểu đồ
      </div>
    );
  }

  return (
    <div className="chart-wrap">
      {label ? <div className="chart-label">{label}</div> : null}
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="chart-svg chart-animate"
        preserveAspectRatio="none"
        role="img"
        aria-label={label || 'Biểu đồ'}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={colors.stroke} stopOpacity="0.35" />
            <stop offset="100%" stopColor={colors.stroke} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {showGrid ? (
          <>
            <line x1="0" y1={height * 0.25} x2={width} y2={height * 0.25} className="chart-grid" />
            <line x1="0" y1={height * 0.5} x2={width} y2={height * 0.5} className="chart-grid" />
            <line x1="0" y1={height * 0.75} x2={width} y2={height * 0.75} className="chart-grid" />
          </>
        ) : null}
        <path d={area} fill={`url(#${gradId})`} className="chart-area" />
        <path d={line} fill="none" stroke={colors.stroke} strokeWidth="2" strokeLinecap="round" className="chart-line" />
        <circle
          cx={width - 4}
          cy={4 + (height - 8) * (1 - (normalized[normalized.length - 1] ?? 0))}
          r="3.5"
          fill={colors.stroke}
          className="chart-dot-pulse"
        />
      </svg>
    </div>
  );
}