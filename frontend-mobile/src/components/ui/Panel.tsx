import GlassCard from './GlassCard';

interface PanelProps {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  glow?: boolean;
  flush?: boolean;
}

/** Card panel — padding & border thống nhất toàn app */
export default function Panel({ children, className = '', delay, glow, flush }: PanelProps) {
  return (
    <GlassCard
      glow={glow}
      delay={delay}
      motion="none"
      className={`panel ${flush ? 'panel-flush' : ''} ${className}`}
    >
      {children}
    </GlassCard>
  );
}