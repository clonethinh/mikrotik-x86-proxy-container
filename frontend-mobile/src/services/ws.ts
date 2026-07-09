import { create } from 'zustand';
import { useEffect } from 'react';

export interface RealtimeEvent {
  type: string;
  payload: unknown;
  ts?: number;
}

type Listener = (msg: RealtimeEvent) => void;

interface WSState {
  connected: boolean;
  lastEvent: RealtimeEvent | null;
  setConnected: (c: boolean) => void;
  setLastEvent: (e: RealtimeEvent) => void;
  listeners: Set<Listener>;
  subscribe: (l: Listener) => () => void;
  emit: (msg: RealtimeEvent) => void;
}

export const useWSStore = create<WSState>((set, get) => ({
  connected: false,
  lastEvent: null,
  setConnected: (c) => set({ connected: c }),
  setLastEvent: (e) => set({ lastEvent: e }),
  listeners: new Set<Listener>(),
  subscribe: (l) => {
    get().listeners.add(l);
    return () => { get().listeners.delete(l); };
  },
  emit: (msg) => {
    set({ lastEvent: msg });
    for (const l of Array.from(get().listeners)) {
      try { l(msg); } catch { /* ignore */ }
    }
  },
}));

export function useWSEvent(filter: (msg: RealtimeEvent) => boolean, cb: (msg: RealtimeEvent) => void, deps: unknown[] = []) {
  useEffect(() => {
    const unsub = useWSStore.getState().subscribe((msg) => {
      if (filter(msg)) cb(msg);
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}