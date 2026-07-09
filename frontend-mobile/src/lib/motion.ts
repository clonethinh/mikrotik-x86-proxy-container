import type { Transition, Variants } from 'motion/react';

/** Spring mượt — page, card, drawer */
export const springSnappy: Transition = {
  type: 'spring',
  stiffness: 420,
  damping: 34,
  mass: 0.85,
};

export const springSoft: Transition = {
  type: 'spring',
  stiffness: 280,
  damping: 30,
  mass: 1,
};

export const springBounce: Transition = {
  type: 'spring',
  stiffness: 500,
  damping: 22,
  mass: 0.7,
};

/** Chỉ opacity + transform — GPU-friendly (HeroUI performance tips) */
export const pageVariants: Variants = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
};

export const pageVariantsReduced: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
};

export const listContainerVariants: Variants = {
  hidden: {},
  show: {
    transition: {
      staggerChildren: 0.055,
      delayChildren: 0.03,
    },
  },
};

export const listItemVariants: Variants = {
  hidden: { opacity: 0, x: 12 },
  show: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.2, ease: [0.22, 1, 0.36, 1] },
  },
};

export const fadeUpVariants: Variants = {
  hidden: { opacity: 0, y: 18 },
  show: {
    opacity: 1,
    y: 0,
    transition: springSoft,
  },
};

export const metricPopTransition: Transition = {
  type: 'spring',
  stiffness: 600,
  damping: 18,
};