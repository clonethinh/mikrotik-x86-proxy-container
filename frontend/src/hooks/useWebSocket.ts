// WebSocket hook - connects once, dispatches to global WS store
import { useEffect, useRef } from 'react';
import { getToken } from '../services/api';
import { useWSStore } from '../services/ws';
import { isUiPreview } from '../lib/env';

export function useWebSocket(onEvent?: (msg: any) => void) {
  const wsRef = useRef<WebSocket | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const { setConnected, emit } = useWSStore();

  useEffect(() => {
    if (isUiPreview) {
      setConnected(true);
      return;
    }

    let stopped = false;
    let retryTimer: any = null;

    const connect = () => {
      if (stopped) return;
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const token = getToken();
      const url = `${proto}://${location.host}/ws${token ? `?token=${encodeURIComponent(token)}` : ''}`;
      try {
        const ws = new WebSocket(url);
        wsRef.current = ws;
        ws.onopen = () => {
          setConnected(true);
          console.log('WS connected');
        };
        ws.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data);
            emit(msg);
            if (onEventRef.current) onEventRef.current(msg);
          } catch {}
        };
        ws.onclose = () => {
          setConnected(false);
          retryTimer = setTimeout(connect, 3000);
        };
        ws.onerror = () => ws.close();
      } catch (e) {
        setConnected(false);
        retryTimer = setTimeout(connect, 3000);
      }
    };

    connect();
    return () => {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      try { wsRef.current?.close(); } catch {}
    };
  }, [setConnected, emit]);
}