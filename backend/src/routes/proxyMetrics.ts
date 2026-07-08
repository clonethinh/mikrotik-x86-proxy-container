// Proxy metrics & limits API
import type { FastifyInstance } from 'fastify';
import { prisma } from '../db/prisma';
import { hubShardId } from '../lib/hubUtils';
import { getAllLiveMetrics, getLiveMetrics } from '../services/metrics/ProxyMetricsCollector';
import { syncHubConfigForShard } from '../services/proxy/HubConfigService';
import { hubProxyService } from '../services/proxy/HubProxyService';

export default async function proxyMetricsRoutes(app: FastifyInstance) {
  app.get('/api/proxies/metrics/live-all', { preHandler: [app.authenticate] }, async () => {
    return getAllLiveMetrics();
  });

  app.get('/api/proxies/:id/metrics/live', { preHandler: [app.authenticate] }, async (req, reply) => {
    const id = parseInt((req.params as { id: string }).id, 10);
    const proxy = await prisma.proxyUser.findUnique({ where: { id } });
    if (!proxy) return reply.code(404).send({ error: 'Not found' });
    return getLiveMetrics(id);
  });

  app.get('/api/proxies/:id/metrics/history', { preHandler: [app.authenticate] }, async (req, reply) => {
    const id = parseInt((req.params as { id: string }).id, 10);
    const q = req.query as { period?: string };
    const period = q.period || 'day';
    if (!['hour', 'day', 'week', 'month'].includes(period)) {
      return reply.code(400).send({ error: 'period must be hour|day|week|month' });
    }
    const proxy = await prisma.proxyUser.findUnique({ where: { id } });
    if (!proxy) return reply.code(404).send({ error: 'Not found' });

    const rows = await prisma.proxyTrafficRollup.findMany({
      where: { proxyId: id, period },
      orderBy: { bucket: 'asc' },
      take: period === 'hour' ? 48 : period === 'day' ? 30 : period === 'week' ? 12 : 12,
    });
    return rows.map(r => ({
      bucket: r.bucket,
      rxBytes: r.rxBytes.toString(),
      txBytes: r.txBytes.toString(),
      requests: r.requests,
      errors: r.errors,
    }));
  });

  app.get('/api/proxies/:id/limits', { preHandler: [app.authenticate] }, async (req, reply) => {
    const id = parseInt((req.params as { id: string }).id, 10);
    const limit = await prisma.proxyLimit.findUnique({ where: { proxyId: id } });
    if (!limit) return { proxyId: id, enabled: false };
    return {
      ...limit,
      expiresAt: limit.expiresAt?.toISOString() ?? null,
      allowedHours: limit.allowedHours ? JSON.parse(limit.allowedHours) : null,
    };
  });

  app.patch('/api/proxies/:id/limits', { preHandler: [app.authenticate] }, async (req, reply) => {
    const u = req.user as { role?: string };
    if (u.role !== 'admin') return reply.code(403).send({ error: 'admin only' });
    const id = parseInt((req.params as { id: string }).id, 10);
    const body = req.body as Record<string, unknown>;
    const proxy = await prisma.proxyUser.findUnique({ where: { id } });
    if (!proxy) return reply.code(404).send({ error: 'Not found' });

    const data: Record<string, unknown> = {};
    for (const k of [
      'quotaDailyMb', 'quotaWeeklyMb', 'quotaMonthlyMb',
      'speedDownKbps', 'speedUpKbps', 'maxConnections', 'enabled',
    ]) {
      if (body[k] !== undefined) data[k] = body[k];
    }
    if (body.allowedHours !== undefined) {
      data.allowedHours = body.allowedHours ? JSON.stringify(body.allowedHours) : null;
    }
    if (body.expiresAt !== undefined) {
      data.expiresAt = body.expiresAt ? new Date(String(body.expiresAt)) : null;
    }

    const limit = await prisma.proxyLimit.upsert({
      where: { proxyId: id },
      create: { proxyId: id, enabled: true, ...data },
      update: data,
    });

    let shardId = 0;
    try {
      shardId = hubShardId(proxy.pppoeIdx);
      await syncHubConfigForShard(shardId);
      await hubProxyService.reloadHubShard(shardId);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'sync failed';
      return reply.code(502).send({
        error: `Limits saved but hub reload failed: ${msg}`,
        limit: {
          ...limit,
          expiresAt: limit.expiresAt?.toISOString() ?? null,
          allowedHours: limit.allowedHours ? JSON.parse(limit.allowedHours) : null,
        },
      });
    }

    return {
      ...limit,
      expiresAt: limit.expiresAt?.toISOString() ?? null,
      allowedHours: limit.allowedHours ? JSON.parse(limit.allowedHours) : null,
      applied: true,
      shardId,
    };
  });

  app.get('/api/proxies/:id/uptime', { preHandler: [app.authenticate] }, async (req, reply) => {
    const id = parseInt((req.params as { id: string }).id, 10);
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const checks = await prisma.healthCheck.findMany({
      where: { proxyId: id, checkedAt: { gte: since } },
      orderBy: { checkedAt: 'asc' },
    });
    if (!checks.length) return { proxyId: id, uptimePct: null, samples: 0 };
    const ok = checks.filter(c => c.ok).length;
    return { proxyId: id, uptimePct: Math.round((ok / checks.length) * 1000) / 10, samples: checks.length };
  });
}