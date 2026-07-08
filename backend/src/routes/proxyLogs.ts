// Proxy request logs & domain stats API (PR-3)
import type { FastifyInstance } from 'fastify';
import { prisma } from '../db/prisma';
import { hubShardId } from '../lib/hubUtils';
import { tailRawLinesForUser } from '../services/logs/LogTailer';
import { normalizeLogLine } from '../lib/proxyLogParser';

function serializeRequestLog(r: {
  id: number;
  proxyId: number;
  ts: Date;
  clientIp: string;
  destHost: string | null;
  destPort: number | null;
  rxBytes: bigint;
  txBytes: bigint;
  errorCode: number;
  durationMs: number | null;
  service: string | null;
}) {
  return {
    id: r.id,
    proxyId: r.proxyId,
    ts: r.ts.toISOString(),
    clientIp: r.clientIp,
    destHost: r.destHost,
    destPort: r.destPort,
    rxBytes: r.rxBytes.toString(),
    txBytes: r.txBytes.toString(),
    errorCode: r.errorCode,
    durationMs: r.durationMs,
    service: r.service,
  };
}

export default async function proxyLogsRoutes(app: FastifyInstance) {
  app.get('/api/proxies/:id/logs/requests', { preHandler: [app.authenticate] }, async (req, reply) => {
    const id = parseInt((req.params as { id: string }).id, 10);
    const q = req.query as {
      limit?: string;
      host?: string;
      since?: string;
      before?: string;
    };
    const proxy = await prisma.proxyUser.findUnique({ where: { id } });
    if (!proxy) return reply.code(404).send({ error: 'Not found' });

    const limit = Math.min(200, Math.max(1, parseInt(q.limit || '50', 10) || 50));
    const where: {
      proxyId: number;
      destHost?: { contains: string };
      ts?: { gte?: Date; lt?: Date };
    } = { proxyId: id };

    if (q.host?.trim()) {
      where.destHost = { contains: q.host.trim() };
    }
    if (q.since) {
      const d = new Date(q.since);
      if (!Number.isNaN(d.getTime())) where.ts = { ...where.ts, gte: d };
    }
    if (q.before) {
      const d = new Date(q.before);
      if (!Number.isNaN(d.getTime())) where.ts = { ...where.ts, lt: d };
    }

    const rows = await prisma.proxyRequestLog.findMany({
      where,
      orderBy: { ts: 'desc' },
      take: limit,
    });
    return rows.map(serializeRequestLog);
  });

  app.get('/api/proxies/:id/logs/domains', { preHandler: [app.authenticate] }, async (req, reply) => {
    const id = parseInt((req.params as { id: string }).id, 10);
    const q = req.query as { bucket?: string; limit?: string };
    const proxy = await prisma.proxyUser.findUnique({ where: { id } });
    if (!proxy) return reply.code(404).send({ error: 'Not found' });

    let bucket = q.bucket || new Date().toISOString().slice(0, 10);
    const limit = Math.min(100, Math.max(1, parseInt(q.limit || '20', 10) || 20));

    let rows = await prisma.proxyDomainStats.findMany({
      where: { proxyId: id, bucket },
      orderBy: { hits: 'desc' },
      take: limit,
    });

    if (!rows.length && !q.bucket) {
      const latest = await prisma.proxyDomainStats.findFirst({
        where: { proxyId: id },
        orderBy: { bucket: 'desc' },
      });
      if (latest) {
        bucket = latest.bucket;
        rows = await prisma.proxyDomainStats.findMany({
          where: { proxyId: id, bucket },
          orderBy: { hits: 'desc' },
          take: limit,
        });
      }
    }
    return rows.map(r => ({
      bucket: r.bucket,
      domain: r.domain,
      hits: r.hits,
      rxBytes: r.rxBytes.toString(),
      txBytes: r.txBytes.toString(),
      totalBytes: (r.rxBytes + r.txBytes).toString(),
    }));
  });

  app.get('/api/proxies/:id/logs/tail', { preHandler: [app.authenticate] }, async (req, reply) => {
    const id = parseInt((req.params as { id: string }).id, 10);
    const q = req.query as { lines?: string };
    const proxy = await prisma.proxyUser.findUnique({ where: { id } });
    if (!proxy) return reply.code(404).send({ error: 'Not found' });

    if (process.env.DEPLOY_TARGET !== 'router') {
      return { proxyId: id, username: proxy.username, lines: [], source: 'unavailable' };
    }

    let shardId = 0;
    try {
      shardId = hubShardId(proxy.pppoeIdx);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'invalid shard';
      return reply.code(400).send({ error: msg });
    }

    const lineCount = Math.min(500, Math.max(1, parseInt(q.lines || '100', 10) || 100));
    try {
      const raw = await tailRawLinesForUser(shardId, proxy.username, lineCount);
      return {
        proxyId: id,
        username: proxy.username,
        shardId,
        lines: raw.map(normalizeLogLine).filter(Boolean),
        source: 'hub-log',
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'tail failed';
      return reply.code(502).send({ error: msg });
    }
  });
}