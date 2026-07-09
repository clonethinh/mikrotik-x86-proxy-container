import { useEffect, useState } from 'react';

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function useCountUp(target: number, duration = 600): number {
  const [display, setDisplay] = useState(target);

  useEffect(() => {
    if (prefersReducedMotion()) {
      setDisplay(target);
      return;
    }

    let frame = 0;
    const start = display;
    const t0 = performance.now();

    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / duration);
      const eased = 1 - (1 - p) ** 3;
      setDisplay(Math.round(start + (target - start) * eased));
      if (p < 1) frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, duration]);

  return display;
}