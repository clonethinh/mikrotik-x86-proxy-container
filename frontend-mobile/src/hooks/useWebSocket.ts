import { useEffect, useRef } from 'react';
import { isUiPreview } from '../lib/env';
import { getToken } from '../services/api';
import { useWSStore } from '../services/ws';

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const { setConnected, emit } = useWSStore();

  useEffect(() => {
    if (isUiPreview) {
      setConnected(true);
      const tick = setInterval(() => {
        emit({
          type: 'proxy.metrics',
          payload: {
            proxyId: 1 + Math.floor(Math.random() * 8),
            rxBps: 10000 + Math.round(Math.random() * 8000),
            txBps: 6000 + Math.round(Math.random() * 4000),
            clients: 1 + Math.floor(Math.random() * 5),
          },
        });
      }, 4000);
      return () => clearInterval(tick);
    }

    let stopped = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (stopped) return;
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const token = getToken();
      const url = `${proto}://${location.host}/ws${token ? `?token=${encodeURIComponent(token)}` : ''}`;
      try {
        const ws = new WebSocket(url);
        wsRef.current = ws;
        ws.onopen = () => setConnected(true);
        ws.onmessage = (e) => {
          try { emit(JSON.parse(e.data)); } catch { /* ignore */ }
        };
        ws.onclose = () => {
          setConnected(false);
          retryTimer = setTimeout(connect, 3000);
        };
        ws.onerror = () => ws.close();
      } catch {
        setConnected(false);
        retryTimer = setTimeout(connect, 3000);
      }
    };

    connect();
    return () => {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      try { wsRef.current?.close(); } catch { /* ignore */ }
    };
  }, [setConnected, emit]);
}