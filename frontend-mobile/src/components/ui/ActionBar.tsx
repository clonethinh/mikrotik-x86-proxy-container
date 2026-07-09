import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { springSnappy } from '../../lib/motion';

interface ActionBarProps {
  children: React.ReactNode;
  label?: string;
}

export default function ActionBar({ children, label }: ActionBarProps) {
  const reduce = useReducedMotion();

  if (reduce) {
    return (
      <div className="action-bar action-bar-static">
        {label ? <span className="action-bar-label">{label}</span> : null}
        <div className="action-bar-buttons">{children}</div>
      </div>
    );
  }

  return (
    <AnimatePresence mode="popLayout">
      <motion.div
        key={label ?? 'action-bar'}
        className="action-bar action-bar-motion"
        initial={{ opacity: 0, y: 12, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -8, scale: 0.97 }}
        transition={springSnappy}
        layout
      >
        {label ? <span className="action-bar-label">{label}</span> : null}
        <div className="action-bar-buttons">{children}</div>
      </motion.div>
    </AnimatePresence>
  );
}