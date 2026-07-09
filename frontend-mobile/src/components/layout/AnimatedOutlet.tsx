import { useLocation, Outlet } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { pageVariants, pageVariantsReduced } from '../../lib/motion';

/** Chuyển trang với Motion (AnimatePresence + spring) */
export default function AnimatedOutlet() {
  const location = useLocation();
  const reduce = useReducedMotion();

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={location.pathname}
        className="page-motion-root"
        variants={reduce ? pageVariantsReduced : pageVariants}
        initial="initial"
        animate="animate"
        exit="exit"
        transition={reduce ? { duration: 0.12 } : { duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      >
        <Outlet />
      </motion.div>
    </AnimatePresence>
  );
}