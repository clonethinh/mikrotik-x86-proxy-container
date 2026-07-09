import { motion, useReducedMotion } from 'motion/react';
import { useCountUp } from '../../hooks/useCountUp';
import { metricPopTransition } from '../../lib/motion';
import Panel from './Panel';
import MetricGrid, { type MetricItem } from './MetricGrid';
import RingGauge from '../charts/RingGauge';

export interface GaugeItem {
  label: string;
  value: number | null;
  color?: 'accent' | 'success' | 'warning' | 'danger' | 'default';
}

interface ListPageTopProps {
  eyebrow: string;
  /** Giá trị hero — số sẽ count-up; chuỗi hiển thị trực tiếp */
  heroValue: number | string;
  heroSuffix?: string;
  summary?: string;
  badge?: React.ReactNode;
  metrics: MetricItem[];
  gauges?: GaugeItem[];
  meta?: string;
  glow?: boolean;
  toolbar?: React.ReactNode;
}

export default function ListPageTop({
  eyebrow,
  heroValue,
  heroSuffix = '',
  summary,
  badge,
  metrics,
  gauges,
  meta,
  glow,
  toolbar,
}: ListPageTopProps) {
  const reduce = useReducedMotion();
  const isNumericHero = typeof heroValue === 'number';
  const heroDisplay = useCountUp(isNumericHero ? heroValue : 0, 700);

  const heroContent = isNumericHero ? `${heroDisplay}${heroSuffix}` : `${heroValue}${heroSuffix}`;

  return (
    <Panel glow={glow} className="page-top">
      {glow ? <div className="page-top-bg" aria-hidden /> : null}
      <div className="page-top-inner">
        <div className="page-top-head">
          <div className="page-top-primary">
            <span className="page-top-eyebrow">{eyebrow}</span>
            {reduce ? (
              <div className="page-top-hero-value">{heroContent}</div>
            ) : (
              <motion.div
                key={heroContent}
                className="page-top-hero-value"
                initial={{ opacity: 0.65, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={metricPopTransition}
              >
                {heroContent}
              </motion.div>
            )}
            {summary ? <p className="page-top-summary">{summary}</p> : null}
          </div>
          {badge}
        </div>

        {gauges && gauges.length > 0 ? (
          <div className="page-top-gauges">
            {gauges.map((g) => (
              <RingGauge
                key={g.label}
                label={g.label}
                value={g.value}
                color={g.color ?? 'accent'}
                size="md"
              />
            ))}
          </div>
        ) : null}

        <MetricGrid
          items={metrics}
          columns={metrics.length > 4 ? 'auto' : metrics.length <= 3 ? 3 : 4}
        />

        {meta ? <p className="page-top-meta">{meta}</p> : null}

        {toolbar ? (
          <div className="page-top-toolbar">{toolbar}</div>
        ) : null}
      </div>
    </Panel>
  );
}