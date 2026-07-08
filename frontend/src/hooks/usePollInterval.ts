import { useCallback, useEffect, useState } from 'react';

export const POLL_INTERVAL_OPTIONS = [1, 5, 10, 15, 30, 60] as const;
export type PollIntervalSec = (typeof POLL_INTERVAL_OPTIONS)[number];

const STORAGE_KEY = 'dashboard_poll_sec';
const DEFAULT_SEC: PollIntervalSec = 5;

function readStored(): PollIntervalSec {
  try {
    const v = parseInt(localStorage.getItem(STORAGE_KEY) || '', 10);
    if (POLL_INTERVAL_OPTIONS.includes(v as PollIntervalSec)) return v as PollIntervalSec;
  } catch { /* ignore */ }
  return DEFAULT_SEC;
}

export function usePollInterval() {
  const [seconds, setSecondsState] = useState<PollIntervalSec>(readStored);

  const setSeconds = useCallback((sec: PollIntervalSec) => {
    setSecondsState(sec);
    try { localStorage.setItem(STORAGE_KEY, String(sec)); } catch { /* ignore */ }
  }, []);

  return { seconds, setSeconds, ms: seconds * 1000 };
}

export function usePollEffect(callback: () => void, ms: number, deps: unknown[] = []) {
  useEffect(() => {
    const id = setInterval(callback, ms);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ms, ...deps]);
}