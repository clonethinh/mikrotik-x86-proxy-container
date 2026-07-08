// Realtime hub - WebSocket broadcast manager
import type { WebSocket } from 'ws';
import { logger } from '../lib/logger';

export interface RealtimeEvent {
  type: string;
  payload: any;
  ts?: number;
}

class RealtimeHub {
  private clients = new Set<WebSocket>();
  private buffer: RealtimeEvent[] = [];
  private maxBuffer = 100;

  register(ws: WebSocket): void {
    this.clients.add(ws);
    // Send buffer on connect (so reconnects catch up)
    for (const ev of this.buffer) {
      try { ws.send(JSON.stringify(ev)); } catch {}
    }
    ws.on('close', () => this.clients.delete(ws));
    ws.on('error', () => this.clients.delete(ws));
  }

  broadcast(event: RealtimeEvent): void {
    const ev = { ...event, ts: event.ts || Date.now() };
    this.buffer.push(ev);
    if (this.buffer.length > this.maxBuffer) this.buffer.shift();
    const msg = JSON.stringify(ev);
    let sent = 0;
    for (const ws of Array.from(this.clients)) {
      if (ws.readyState === 1) {
        try { ws.send(msg); sent++; } catch {}
      }
    }
    logger.debug({ type: event.type, sent, total: this.clients.size }, 'realtime broadcast');
  }

  size(): number { return this.clients.size; }
}

export const realtimeHub = new RealtimeHub();