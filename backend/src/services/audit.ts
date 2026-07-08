// Audit log helper - also broadcasts over WebSocket so frontend can refresh in realtime
import { prisma } from '../db/prisma';
import { realtimeHub } from '../realtime/hub';

export async function audit(opts: {
  userId?: number;
  username: string;
  action: string;
  resource?: string;
  resourceId?: number;
  details?: any;
  ip?: string;
  proxyId?: number;
}) {
  let id: number | undefined;
  try {
    const row = await prisma.auditLog.create({
      data: {
        userId: opts.userId,
        username: opts.username,
        action: opts.action,
        resource: opts.resource,
        resourceId: opts.resourceId,
        details: opts.details ? JSON.stringify(opts.details) : null,
        ip: opts.ip,
        proxyId: opts.proxyId,
      },
    });
    id = row.id;
  } catch (e) {
    // don't fail main op if audit fails
    return;
  }
  // Broadcast (best-effort)
  try {
    realtimeHub.broadcast({
      type: 'audit.created',
      payload: {
        id,
        username: opts.username,
        action: opts.action,
        resource: opts.resource,
        resourceId: opts.resourceId,
        proxyId: opts.proxyId,
        createdAt: new Date().toISOString(),
      },
    });
  } catch {}
}