import { Card } from '@heroui/react';

type Motion = 'fade-up' | 'slide-in' | 'none';

interface GlassCardProps {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  glow?: boolean;
  motion?: Motion;
}

const MOTION_CLASS: Record<Exclude<Motion, 'none'>, string> = {
  'fade-up': 'animate-fade-up',
  'slide-in': 'animate-slide-in-right',
};

export default function GlassCard({
  children,
  className = '',
  delay = 0,
  glow,
  motion = 'fade-up',
}: GlassCardProps) {
  const motionClass = motion === 'none' ? '' : MOTION_CLASS[motion];
  return (
    <Card
      className={`glass-card ${motionClass} ${glow ? 'glass-card-glow' : ''} ${className}`}
      style={{ animationDelay: motion === 'none' ? undefined : `${delay}ms` }}
    >
      {children}
    </Card>
  );
}