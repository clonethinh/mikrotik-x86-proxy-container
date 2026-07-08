// WebSocket handler - @fastify/websocket v11+ uses (socket, request) signature
import type { FastifyInstance } from 'fastify';
import { realtimeHub } from '../realtime/hub';
import { config } from '../lib/config';

export default async function wsHandler(app: FastifyInstance) {
  if (!config.realtime.enabled) return;

  app.get(config.realtime.wsPath, { websocket: true }, (socket, req) => {
    // Optional: auth via query token
    const q = req.query as { token?: string };
    if (q.token) {
      try {
        const decoded = app.jwt.verify(q.token);
        (socket as any).user = decoded;
      } catch {
        // allow anonymous read
      }
    }
    realtimeHub.register(socket);
    socket.on('message', (data: any) => {
      try {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from((data as any).toString());
        const msg = JSON.parse(buf.toString());
        if (msg.type === 'ping') {
          socket.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
        }
      } catch {}
    });
  });
}