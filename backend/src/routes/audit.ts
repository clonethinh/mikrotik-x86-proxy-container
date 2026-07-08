// Audit log routes
import type { FastifyInstance } from 'fastify';
import { prisma } from '../db/prisma';

export default async function auditRoutes(app: FastifyInstance) {
  // List audit logs (paginated)
  app.get('/api/audit', { preHandler: [app.authenticate] }, async (req) => {
    const q = req.query as { limit?: string; offset?: string; action?: string; username?: string; resource?: string };
    const limit = Math.min(parseInt(q.limit || '100', 10), 500);
    const offset = parseInt(q.offset || '0', 10);

    const where: any = {};
    if (q.action) where.action = { contains: q.action };
    if (q.username) where.username = { contains: q.username };
    if (q.resource) where.resource = q.resource;

    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.auditLog.count({ where }),
    ]);

    return { items, total, limit, offset };
  });

  // Distinct actions (for filter dropdown)
  app.get('/api/audit/actions', { preHandler: [app.authenticate] }, async () => {
    const rows = await prisma.auditLog.findMany({
      distinct: ['action'],
      select: { action: true },
    });
    return rows.map(r => r.action).sort();
  });
}