import { motion, useReducedMotion } from 'motion/react';
import { useCountUp } from '../../hooks/useCountUp';
import { metricPopTransition } from '../../lib/motion';

export interface MetricItem {
  label: string;
  value: number;
  hint?: string;
  accent?: boolean;
  icon?: React.ReactNode;
}

interface MetricGridProps {
  items: MetricItem[];
  columns?: 4 | 3 | 'auto';
  className?: string;
}

export function MetricCell({
  label,
  value,
  hint,
  accent,
  icon,
}: MetricItem) {
  const display = useCountUp(value, 550);
  const reduce = useReducedMotion();

  return (
    <div
      className={`page-metric-cell ${accent ? 'page-metric-cell-accent' : ''}`}
      role="listitem"
    >
      <div className="page-metric-label">
        {icon ? <span className="page-metric-icon">{icon}</span> : null}
        <span>{label}</span>
      </div>
      {reduce ? (
        <span className="page-metric-value">{display}</span>
      ) : (
        <motion.span
          key={display}
          className="page-metric-value"
          initial={{ opacity: 0.7 }}
          animate={{ opacity: 1 }}
          transition={metricPopTransition}
        >
          {display}
        </motion.span>
      )}
      {hint ? <span className="page-metric-hint">{hint}</span> : null}
    </div>
  );
}

export default function MetricGrid({ items, columns = 4, className = '' }: MetricGridProps) {
  const colClass = columns === 'auto'
    ? 'page-metric-grid-auto'
    : `page-metric-grid-${columns}`;

  return (
    <div
      className={`page-metric-grid ${colClass} ${className}`}
      role="list"
    >
      {items.map((item) => (
        <MetricCell key={item.label} {...item} />
      ))}
    </div>
  );
}