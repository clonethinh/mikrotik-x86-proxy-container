// Proxy CRUD routes
import type { FastifyInstance } from 'fastify';
import { proxyService } from '../services/proxy/ProxyService';
import { audit } from '../services/audit';
import { renderExport, exportToFile } from '../services/export/ExportService';
import { getMikrotikService } from '../services/mikrotik/MikrotikService';
import { config } from '../lib/config';
import { prisma } from '../db/prisma';
import { realtimeHub } from '../realtime/hub';
import { randomPassword, usernameSchema, passwordSchema } from '../lib/validation';
import { z } from 'zod';
import { logger } from '../lib/logger';

export default async function proxyRoutes(app: FastifyInstance) {
  // List
  app.get('/api/proxies', { preHandler: [app.authenticate] }, async (req) => {
    const q = req.query as { search?: string; status?: string };
    const data = await proxyService.list({ search: q.search, status: q.status });
    return data.map(p => ({ ...p, password: undefined })); // hide password by default
  });

  // Get one
  app.get('/api/proxies/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const id = parseInt((req.params as any).id, 10);
    const data = await proxyService.getById(id);
    if (!data) return reply.code(404).send({ error: 'Not found' });
    return data;
  });

  // Reveal password (audit-logged)
  app.get('/api/proxies/:id/password', { preHandler: [app.authenticate] }, async (req, reply) => {
    const id = parseInt((req.params as any).id, 10);
    const u = req.user as any;
    const data = await proxyService.getById(id);
    if (!data) return reply.code(404).send({ error: 'Not found' });
    await audit({ userId: u.uid, username: u.username, action: 'reveal-password', resource: 'proxy', resourceId: id, ip: req.ip });
    return { password: data.password };
  });

  // Create
  app.post('/api/proxies', { preHandler: [app.authenticate] }, async (req, reply) => {
    try {
      const u = req.user as any;
      const created = await proxyService.create(req.body as any);
      await audit({ userId: u.uid, username: u.username, action: 'create', resource: 'proxy', resourceId: created.id, ip: req.ip, proxyId: created.id, details: { pppoeIdx: created.pppoeIdx } });
      return reply.code(201).send(created);
    } catch (e: any) {
      return reply.code(400).send({ error: e.message });
    }
  });

  // Update
  app.patch('/api/proxies/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    try {
      const id = parseInt((req.params as any).id, 10);
      const u = req.user as any;
      const updated = await proxyService.update(id, req.body as any);
      await audit({ userId: u.uid, username: u.username, action: 'update', resource: 'proxy', resourceId: id, ip: req.ip, proxyId: id });
      return updated;
    } catch (e: any) {
      return reply.code(400).send({ error: e.message });
    }
  });

  // Delete
  app.delete('/api/proxies/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    try {
      const id = parseInt((req.params as any).id, 10);
      const u = req.user as any;
      await proxyService.delete(id);
      await audit({ userId: u.uid, username: u.username, action: 'delete', resource: 'proxy', resourceId: id, ip: req.ip });
      return { ok: true };
    } catch (e: any) {
      return reply.code(400).send({ error: e.message });
    }
  });

  // Start
  app.post('/api/proxies/:id/start', { preHandler: [app.authenticate] }, async (req, reply) => {
    try {
      const id = parseInt((req.params as any).id, 10);
      const u = req.user as any;
      const result = await proxyService.start(id);
      await audit({ userId: u.uid, username: u.username, action: 'start', resource: 'proxy', resourceId: id, ip: req.ip, proxyId: id });
      return result;
    } catch (e: any) {
      return reply.code(400).send({ error: e.message });
    }
  });

  // Stop
  app.post('/api/proxies/:id/stop', { preHandler: [app.authenticate] }, async (req, reply) => {
    try {
      const id = parseInt((req.params as any).id, 10);
      const u = req.user as any;
      const result = await proxyService.stop(id);
      await audit({ userId: u.uid, username: u.username, action: 'stop', resource: 'proxy', resourceId: id, ip: req.ip, proxyId: id });
      return result;
    } catch (e: any) {
      return reply.code(400).send({ error: e.message });
    }
  });

  // Reload IP
  app.post('/api/proxies/:id/reload-ip', { preHandler: [app.authenticate] }, async (req, reply) => {
    try {
      const id = parseInt((req.params as any).id, 10);
      const u = req.user as any;
      realtimeNotifyProxyAction(id, 'reloading');
      const result = await proxyService.reloadIp(id);
      await audit({ userId: u.uid, username: u.username, action: 'reload-ip', resource: 'proxy', resourceId: id, ip: req.ip, proxyId: id, details: { newIp: result.publicIp } });
      return result;
    } catch (e: any) {
      return reply.code(400).send({ error: e.message });
    }
  });

  // Test ping (health check)
  app.post('/api/proxies/:id/test', { preHandler: [app.authenticate] }, async (req, reply) => {
    try {
      const id = parseInt((req.params as any).id, 10);
      const u = req.user as any;
      const result = await proxyService.healthCheck(id);
      await audit({ userId: u.uid, username: u.username, action: 'test', resource: 'proxy', resourceId: id, ip: req.ip, proxyId: id, details: result });
      return result;
    } catch (e: any) {
      return reply.code(400).send({ error: e.message });
    }
  });

  // Bulk actions
  app.post('/api/proxies/bulk', { preHandler: [app.authenticate] }, async (req, reply) => {
    try {
      const { ids, action } = req.body as { ids: number[]; action: 'start' | 'stop' | 'reload-ip' | 'test' | 'delete' };
      const u = req.user as any;
      const results: any[] = [];
      for (const id of ids) {
        try {
          let r;
          if (action === 'start') r = await proxyService.start(id);
          else if (action === 'stop') r = await proxyService.stop(id);
          else if (action === 'reload-ip') r = await proxyService.reloadIp(id);
          else if (action === 'test') r = await proxyService.healthCheck(id);
          else if (action === 'delete') r = await proxyService.delete(id);
          results.push({ id, ok: true });
        } catch (e: any) {
          results.push({ id, ok: false, error: e.message });
        }
      }
      await audit({ userId: u.uid, username: u.username, action: `bulk-${action}`, ip: req.ip, details: { ids, results } });
      return { results };
    } catch (e: any) {
      return reply.code(400).send({ error: e.message });
    }
  });

  // Bulk update credentials (custom user/pass)
  app.post('/api/proxies/bulk-update-credentials', { preHandler: [app.authenticate] }, async (req, reply) => {
    try {
      const body = req.body as any;
      const u = req.user as any;
      let updates: Array<{ id: number; username?: string; password?: string }> = [];
      let lineErrors: string[] = [];

      if (body.mode === 'same') {
        const parsed = z.object({
          mode: z.literal('same'),
          ids: z.array(z.number().int().positive()).min(1),
          username: usernameSchema.optional(),
          password: passwordSchema.optional(),
        }).refine(d => !!(d.username || d.password), { message: 'Cần username hoặc password' }).parse(body);
        updates = parsed.ids.map(id => ({
          id,
          username: parsed.username,
          password: parsed.password,
        }));
      } else if (body.mode === 'lines') {
        const parsed = z.object({
          mode: z.literal('lines'),
          text: z.string().min(1),
        }).parse(body);
        const resolved = await proxyService.resolveBulkCredentialLines(parsed.text);
        updates = resolved.updates;
        lineErrors = resolved.errors;
      } else {
        return reply.code(400).send({ error: 'mode phải là "same" hoặc "lines"' });
      }

      const result = await proxyService.bulkUpdateCredentials(updates);
      await audit({
        userId: u.uid,
        username: u.username,
        action: 'bulk-update-credentials',
        ip: req.ip,
        details: { mode: body.mode, count: result.updated, lineErrors },
      });
      return { ...result, errors: lineErrors };
    } catch (e: any) {
      return reply.code(400).send({ error: e.message });
    }
  });

  // Regenerate credentials (bulk)
  app.post('/api/proxies/regenerate-credentials', { preHandler: [app.authenticate] }, async (req, reply) => {
    try {
      const { ids } = req.body as { ids: number[] };
      const u = req.user as any;
      const updated: any[] = [];
      for (const id of ids) {
        const newPw = randomPassword(12);
        const r = await proxyService.update(id, { password: newPw });
        updated.push({ id, password: newPw });
      }
      await audit({ userId: u.uid, username: u.username, action: 'regenerate-credentials', ip: req.ip, details: { count: ids.length } });
      return { updated };
    } catch (e: any) {
      return reply.code(400).send({ error: e.message });
    }
  });

  // Export
  app.post('/api/proxies/export', { preHandler: [app.authenticate] }, async (req, reply) => {
    try {
      const u = req.user as any;
      const { ids, format, template, includeSocks, fileFormat } = req.body as any;
      const where = ids && ids.length > 0 ? { id: { in: ids } } : {};
      const proxies = await prisma.proxyUser.findMany({ where, orderBy: { pppoeIdx: 'asc' } });
      const text = renderExport({
        proxies: proxies as any,
        format: format || 'ipportuserpass',
        template,
        includeSocks: !!includeSocks,
      });
      const file = fileFormat ? exportToFile(fileFormat, text, proxies) : null;
      await audit({ userId: u.uid, username: u.username, action: 'export', ip: req.ip, details: { format, count: proxies.length, fileFormat } });
      if (file) {
        reply.header('Content-Type', file.mime);
        reply.header('Content-Disposition', `attachment; filename="proxies-${Date.now()}.${file.ext}"`);
        return reply.send(file.content);
      }
      return { text, count: proxies.length };
    } catch (e: any) {
      return reply.code(400).send({ error: e.message });
    }
  });

  // IP history
  app.get('/api/proxies/:id/ip-history', { preHandler: [app.authenticate] }, async (req) => {
    const id = parseInt((req.params as any).id, 10);
    const data = await proxyService.getById(id);
    return data?.ipHistory || [];
  });

  // Health history
  app.get('/api/proxies/:id/health-history', { preHandler: [app.authenticate] }, async (req) => {
    const id = parseInt((req.params as any).id, 10);
    const data = await proxyService.getById(id);
    return data?.healthChecks || [];
  });

  // Re-apply Mikrotik resources (NAT/routing/veth) without recreating DB row
  app.post('/api/proxies/:id/reapply', { preHandler: [app.authenticate] }, async (req, reply) => {
    try {
      const id = parseInt((req.params as any).id, 10);
      const u = req.user as any;
      const result = await proxyService.ensureApplied(id);
      await audit({ userId: u.uid, username: u.username, action: 'reapply', resource: 'proxy', resourceId: id, ip: req.ip, proxyId: id });
      return result;
    } catch (e: any) {
      return reply.code(400).send({ error: e.message });
    }
  });

  // Restart container
  app.post('/api/proxies/:id/restart', { preHandler: [app.authenticate] }, async (req, reply) => {
    try {
      const id = parseInt((req.params as any).id, 10);
      const u = req.user as any;
      realtimeNotifyProxyAction(id, 'restarting');
      const result = await proxyService.restart(id);
      await audit({ userId: u.uid, username: u.username, action: 'restart', resource: 'proxy', resourceId: id, ip: req.ip, proxyId: id });
      return result;
    } catch (e: any) {
      return reply.code(400).send({ error: e.message });
    }
  });

  // Container logs
  app.get('/api/proxies/:id/logs', { preHandler: [app.authenticate] }, async (req, reply) => {
    try {
      const id = parseInt((req.params as any).id, 10);
      const lines = Math.min(parseInt((req.query as any).lines || '100', 10), 500);
      const logs = await proxyService.getLogs(id, lines);
      return { logs };
    } catch (e: any) {
      return reply.code(400).send({ error: e.message });
    }
  });

  // Bulk import (text body, mỗi dòng = pppoeIdx)
  app.post('/api/proxies/import', { preHandler: [app.authenticate] }, async (req, reply) => {
    try {
      const body = (req.body as any)?.text || '';
      const u = req.user as any;
      if (!body || typeof body !== 'string') {
        return reply.code(400).send({ error: 'Body phải chứa text' });
      }
      const result = await proxyService.importBulk(body);
      await audit({ userId: u.uid, username: u.username, action: 'import', ip: req.ip, details: result });
      return result;
    } catch (e: any) {
      return reply.code(400).send({ error: e.message });
    }
  });
}

function realtimeNotifyProxyAction(id: number, action: string) {
  // Trigger an event - ProxyService will broadcast full status
  realtimeHub.broadcast({ type: `proxy.${action}`, payload: { id } });
}