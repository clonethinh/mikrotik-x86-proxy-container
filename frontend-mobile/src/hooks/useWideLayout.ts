import { useEffect, useState } from 'react';

const WIDE_BP = 1024;

/** Màn ≥1024px — hiển thị bảng đầy đủ như desktop */
export function useWideLayout(breakpoint = WIDE_BP): boolean {
  const [wide, setWide] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(`(min-width: ${breakpoint}px)`).matches;
  });

  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${breakpoint}px)`);
    const sync = () => setWide(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, [breakpoint]);

  return wide;
}

export const WIDE_LAYOUT_BP = WIDE_BP;