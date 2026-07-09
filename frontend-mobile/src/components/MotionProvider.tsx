import { MotionConfig } from 'motion/react';
import { useReduceMotionAttr } from '../hooks/useReduceMotionAttr';

interface MotionProviderProps {
  children: React.ReactNode;
}

/** MotionConfig + sync HeroUI `data-reduce-motion` (performance & a11y) */
export default function MotionProvider({ children }: MotionProviderProps) {
  useReduceMotionAttr();

  return (
    <MotionConfig reducedMotion="user" transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}>
      {children}
    </MotionConfig>
  );
}