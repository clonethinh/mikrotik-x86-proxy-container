import { motion, useReducedMotion } from 'motion/react';
import { useCountUp } from '../../hooks/useCountUp';
import { fadeUpVariants, metricPopTransition, springSoft } from '../../lib/motion';
import GlassCard from './GlassCard';

interface AnimatedMetricProps {
  label: string;
  value: number;
  hint?: string;
  accent?: boolean;
  icon?: React.ReactNode;
  delay?: number;
  suffix?: string;
}

export default function AnimatedMetric({
  label,
  value,
  hint,
  accent,
  icon,
  delay = 0,
  suffix = '',
}: AnimatedMetricProps) {
  const display = useCountUp(value, 650);
  const reduce = useReducedMotion();

  const inner = (
    <GlassCard motion="none" className="metric-card p-3 h-full">
      <div className="metric-card-top">
        {icon ? <span className="metric-icon">{icon}</span> : null}
        <span className="metric-label">{label}</span>
      </div>
      <motion.div
        key={display}
        className={`metric-value ${accent ? 'metric-value-accent' : ''}`}
        initial={reduce ? false : { scale: 0.88, opacity: 0.6 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={metricPopTransition}
      >
        {display}{suffix}
      </motion.div>
      {hint ? <div className="metric-hint">{hint}</div> : null}
    </GlassCard>
  );

  if (reduce) return inner;

  return (
    <motion.div
      variants={fadeUpVariants}
      initial="hidden"
      animate="show"
      transition={{ ...springSoft, delay: delay / 1000 }}
      whileHover={{ y: -2 }}
    >
      {inner}
    </motion.div>
  );
}