interface BarItem {
  label: string;
  value: number;
  color?: 'accent' | 'success' | 'warning';
}

interface HorizontalBarChartProps {
  items: BarItem[];
  maxItems?: number;
}

export default function HorizontalBarChart({ items, maxItems = 6 }: HorizontalBarChartProps) {
  const rows = items.slice(0, maxItems);
  const max = Math.max(...rows.map((r) => r.value), 1);

  if (rows.length === 0) {
    return <div className="chart-empty" style={{ height: 48 }}>Không có dữ liệu</div>;
  }

  return (
    <div className="bar-chart">
      {rows.map((row, i) => (
        <div key={row.label} className="bar-chart-row animate-fade-up" style={{ animationDelay: `${i * 60}ms` }}>
          <div className="bar-chart-meta">
            <span className="bar-chart-label mobile-truncate">{row.label}</span>
            <span className="bar-chart-value">{row.value}</span>
          </div>
          <div className="bar-chart-track">
            <span
              className={`bar-chart-fill bar-${row.color || 'accent'}`}
              style={{
                width: `${(row.value / max) * 100}%`,
                animationDelay: `${i * 60 + 120}ms`,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}