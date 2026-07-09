import { useCallback, useState } from 'react';
import type { SpeedUnit } from '../lib/format';

const STORAGE_KEY = 'mobile_speed_unit';

function readStored(): SpeedUnit {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'MB/s' || v === 'KB/s' || v === 'Mbps') return v;
  } catch { /* ignore */ }
  return 'KB/s';
}

export function useSpeedUnit() {
  const [unit, setUnitState] = useState<SpeedUnit>(readStored);

  const setUnit = useCallback((next: SpeedUnit) => {
    setUnitState(next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* ignore */ }
  }, []);

  return { unit, setUnit };
}