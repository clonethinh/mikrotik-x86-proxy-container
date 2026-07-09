import { useEffect } from 'react';

/** Đồng bộ `data-reduce-motion` trên `<html>` — HeroUI tắt transition/animation theo doc */
export function useReduceMotionAttr() {
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');

    const sync = () => {
      if (mq.matches) {
        document.documentElement.setAttribute('data-reduce-motion', 'true');
      } else {
        document.documentElement.removeAttribute('data-reduce-motion');
      }
    };

    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
}