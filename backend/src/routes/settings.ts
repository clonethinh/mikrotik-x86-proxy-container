// Settings routes — auto-proxy mode for infinite pppoe-out pool
import type { FastifyInstance } from 'fastify';
import { getAutoProxySettings, setAutoProxySettings } from '../services/auto/AutoProxySettings';
import { getDiscoveryList, restartWanWatcherInterval } from '../services/auto/WanWatcherService';
import { autoProvisionOrchestrator } from '../services/auto/AutoProvisionOrchestrator';
import { audit } from '../services/audit';

export default async function settingsRoutes(app: FastifyInstance) {
  app.get('/api/settings/auto-proxy', { preHandler: [app.authenticate] }, async () => {
    return getAutoProxySettings();
  });

  app.patch('/api/settings/auto-proxy', { preHandler: [app.authenticate] }, async (req, reply) => {
    const u = req.user as any;
    if (u.role !== 'admin') return reply.code(403).send({ error: 'admin only' });
    const body = req.body as Record<string, unknown>;
    const next = await setAutoProxySettings(body as any);
    await audit({ userId: u.uid, username: u.username, action: 'settings-auto-proxy', ip: req.ip, details: next });
    if (body.pollIntervalMs !== undefined) await restartWanWatcherInterval();
    return next;
  });

  app.get('/api/wan/discovery', { preHandler: [app.authenticate] }, async () => {
    return getDiscoveryList();
  });

  app.post('/api/wan/:idx/provision/cancel', { preHandler: [app.authenticate] }, async (req, reply) => {
    const idx = parseInt((req.params as any).idx, 10);
    if (isNaN(idx) || idx < 1) return reply.code(400).send({ error: 'idx không hợp lệ' });
    await autoProvisionOrchestrator.cancelProvision(idx);
    return { ok: true };
  });

  app.post('/api/wan/:idx/provision/now', { preHandler: [app.authenticate] }, async (req, reply) => {
    const idx = parseInt((req.params as any).idx, 10);
    if (isNaN(idx) || idx < 1) return reply.code(400).send({ error: 'idx không hợp lệ' });
    try {
      await autoProvisionOrchestrator.provisionNow(idx);
      return { ok: true };
    } catch (e: any) {
      return reply.code(400).send({ error: e.message });
    }
  });
}