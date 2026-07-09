import { motion, useReducedMotion } from 'motion/react';
import { useCountUp } from '../../hooks/useCountUp';
import { fadeUpVariants, metricPopTransition, springSoft } from '../../lib/motion';
import { staggerDelay } from '../../lib/stagger';

export interface StatStripItem {
  label: string;
  value: number | string;
  hint?: string;
  accent?: boolean;
  icon?: React.ReactNode;
  suffix?: string;
}

interface StatStripProps {
  items: StatStripItem[];
  className?: string;
}

function StatStripValue({ value, suffix = '' }: { value: number | string; suffix?: string }) {
  const reduce = useReducedMotion();
  if (typeof value === 'number') {
    const display = useCountUp(value, 550);
    return (
      <motion.span
        key={display}
        className="stat-strip-value"
        initial={reduce ? false : { scale: 0.9, opacity: 0.6 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={metricPopTransition}
      >
        {display}{suffix}
      </motion.span>
    );
  }
  return <span className="stat-strip-value">{value}{suffix}</span>;
}

export default function StatStrip({ items, className = '' }: StatStripProps) {
  const reduce = useReducedMotion();

  return (
    <div className={`mobile-stat-strip ${className}`} role="list">
      {items.map((item, i) => {
        const inner = (
          <div className={`stat-strip-item ${item.accent ? 'stat-strip-item-accent' : ''}`} role="listitem">
            <div className="stat-strip-top">
              {item.icon ? <span className="stat-strip-icon">{item.icon}</span> : null}
              <span className="stat-strip-label">{item.label}</span>
            </div>
            <StatStripValue value={item.value} suffix={item.suffix} />
            {item.hint ? <span className="stat-strip-hint">{item.hint}</span> : null}
          </div>
        );

        if (reduce) return <div key={item.label}>{inner}</div>;

        return (
          <motion.div
            key={item.label}
            variants={fadeUpVariants}
            initial="hidden"
            animate="show"
            transition={{ ...springSoft, delay: staggerDelay(i, 30, 240) / 1000 }}
          >
            {inner}
          </motion.div>
        );
      })}
    </div>
  );
}