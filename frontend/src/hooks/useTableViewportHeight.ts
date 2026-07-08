import { useEffect, useState, type RefObject } from 'react';

const DEFAULT_FOOTER = 64;
const MIN_HEIGHT = 200;

export function useTableViewportHeight(
  containerRef: RefObject<HTMLElement | null>,
  deps: unknown[] = [],
  footerReserve = DEFAULT_FOOTER,
) {
  const [height, setHeight] = useState(MIN_HEIGHT);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const measure = () => {
      const top = el.getBoundingClientRect().top;
      const next = Math.max(MIN_HEIGHT, Math.floor(window.innerHeight - top - footerReserve));
      setHeight(next);
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (el.parentElement) ro.observe(el.parentElement);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef, footerReserve, ...deps]);

  return height;
}