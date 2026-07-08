import type { FastifyInstance } from 'fastify';
import { deviceRoutingService } from '../services/device/DeviceRoutingService';
import { audit } from '../services/audit';

export default async function deviceRoutes(app: FastifyInstance) {
  app.get('/api/devices', { preHandler: [app.authenticate] }, async () => {
    return deviceRoutingService.list();
  });

  app.get('/api/devices/dhcp-leases', { preHandler: [app.authenticate] }, async () => {
    return deviceRoutingService.listDhcpLeases();
  });

  app.get('/api/devices/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const id = parseInt((req.params as any).id, 10);
    const row = await deviceRoutingService.getById(id);
    if (!row) return reply.code(404).send({ error: 'Not found' });
    return row;
  });

  app.post('/api/devices', { preHandler: [app.authenticate] }, async (req, reply) => {
    try {
      const u = req.user as any;
      const created = await deviceRoutingService.create(req.body as any);
      await audit({
        userId: u.uid,
        username: u.username,
        action: 'create',
        resource: 'device-route',
        resourceId: created.id,
        ip: req.ip,
        details: { pppoeIdx: created.pppoeIdx, matchType: created.matchType },
      });
      return reply.code(201).send(created);
    } catch (e: any) {
      return reply.code(400).send({ error: e.message });
    }
  });

  app.patch('/api/devices/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    try {
      const id = parseInt((req.params as any).id, 10);
      const u = req.user as any;
      const updated = await deviceRoutingService.update(id, req.body as any);
      await audit({
        userId: u.uid,
        username: u.username,
        action: 'update',
        resource: 'device-route',
        resourceId: id,
        ip: req.ip,
      });
      return updated;
    } catch (e: any) {
      return reply.code(400).send({ error: e.message });
    }
  });

  app.delete('/api/devices/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    try {
      const id = parseInt((req.params as any).id, 10);
      const u = req.user as any;
      await deviceRoutingService.delete(id);
      await audit({
        userId: u.uid,
        username: u.username,
        action: 'delete',
        resource: 'device-route',
        resourceId: id,
        ip: req.ip,
      });
      return { ok: true };
    } catch (e: any) {
      return reply.code(400).send({ error: e.message });
    }
  });

  app.post('/api/devices/:id/apply', { preHandler: [app.authenticate] }, async (req, reply) => {
    try {
      const id = parseInt((req.params as any).id, 10);
      await deviceRoutingService.apply(id);
      return { ok: true };
    } catch (e: any) {
      return reply.code(400).send({ error: e.message });
    }
  });
}