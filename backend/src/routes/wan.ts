// WAN control routes — bật/tắt pppoe-outX + auto-create proxy
import type { FastifyInstance } from 'fastify';
import { getMikrotikService } from '../services/mikrotik/MikrotikService';
import { audit } from '../services/audit';
import { realtimeHub } from '../realtime/hub';
import { config } from '../lib/config';
import {
  enablePppoeAndApply,
  disablePppoeOnly,
  runEnableInBackground,
  type WanEnableResult,
} from '../services/wan/WanEnableService';
import { wanCreateQueue } from '../services/wan/WanCreateQueue';

function maxWanIdx(): number {
  return config.hub.maxPppoeOut;
}

export default async function wanRoutes(app: FastifyInstance) {
  // Trạng thái hàng đợi tạo PPPoE
  app.get('/api/wan/create-queue', { preHandler: [app.authenticate] }, async () => {
    return wanCreateQueue.getStatus();
  });

  // Tạo pppoe-out tiếp theo (clone template) — enqueue, xử lý tuần tự
  app.post('/api/wan/create-next', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { enable = false, createProxy = false } = (req.body as { enable?: boolean; createProxy?: boolean }) || {};
    const u = req.user as any;

    try {
      return wanCreateQueue.enqueue({
        enable: enable || createProxy,
        createProxy,
        userId: u.uid,
        username: u.username,
        ip: req.ip,
      });
    } catch (e: any) {
      return reply.code(400).send({ error: e.message?.slice(0, 200) });
    }
  });

  // Tạo pppoe-out chỉ định (nếu chưa có) — enqueue
  app.post('/api/wan/create', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { idx, enable = false } = req.body as { idx?: number; enable?: boolean };
    const u = req.user as any;
    const mik = getMikrotikService();
    const maxIdx = maxWanIdx();

    try {
      const targetIdx = idx ?? await mik.findNextPppoeOutIndex(maxIdx);
      return wanCreateQueue.enqueue({
        enable,
        createProxy: false,
        preferredIdx: targetIdx,
        userId: u.uid,
        username: u.username,
        ip: req.ip,
      });
    } catch (e: any) {
      return reply.code(400).send({ error: e.message?.slice(0, 200) });
    }
  });

  // Enable 1 PPPoE + tự tạo/apply proxy (nền — UI theo dõi WebSocket)
  app.post('/api/wan/:idx/enable', { preHandler: [app.authenticate] }, async (req, reply) => {
    const idx = parseInt((req.params as any).idx, 10);
    if (isNaN(idx) || idx < 1 || idx > maxWanIdx()) return reply.code(400).send({ error: 'idx không hợp lệ' });
    const u = req.user as any;
    runEnableInBackground(idx, u.uid, u.username, req.ip);
    return {
      accepted: true,
      pppoeIdx: idx,
      pppoeName: `pppoe-out${idx}`,
      enabling: true,
    };
  });

  // Disable 1 PPPoE (không xoá proxy)
  app.post('/api/wan/:idx/disable', { preHandler: [app.authenticate] }, async (req, reply) => {
    const idx = parseInt((req.params as any).idx, 10);
    if (isNaN(idx) || idx < 1 || idx > maxWanIdx()) return reply.code(400).send({ error: 'idx không hợp lệ' });
    const u = req.user as any;
    const result = await disablePppoeOnly(idx, u.uid, u.username, req.ip);
    if (result.error) return reply.code(400).send(result);
    return result;
  });

  // Bulk enable: bật N PPPoE cùng lúc + auto proxy
  app.post('/api/wan/bulk-enable', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { indices } = req.body as { indices: number[] };
    if (!Array.isArray(indices) || indices.length === 0) {
      return reply.code(400).send({ error: 'indices phải là mảng không rỗng' });
    }
    if (indices.length > 50) {
      return reply.code(400).send({ error: 'Tối đa 50 PPPoE mỗi lần' });
    }
    const valid = indices.filter(i => Number.isInteger(i) && i >= 1 && i <= maxWanIdx());
    if (valid.length === 0) return reply.code(400).send({ error: 'Không có index hợp lệ (>=1)' });

    const u = req.user as any;
    const t0 = Date.now();
    realtimeHub.broadcast({ type: 'wan.bulk', payload: { action: 'enable', total: valid.length, status: 'starting' } });

    const results: WanEnableResult[] = [];
    const CONCURRENT = 3;
    for (let i = 0; i < valid.length; i += CONCURRENT) {
      const batch = valid.slice(i, i + CONCURRENT);
      const batchResults = await Promise.all(
        batch.map(idx => enablePppoeAndApply(idx, u.uid, u.username, req.ip)),
      );
      results.push(...batchResults);
      realtimeHub.broadcast({
        type: 'wan.bulk',
        payload: {
          action: 'enable',
          total: valid.length,
          done: Math.min(i + CONCURRENT, valid.length),
          succeeded: results.filter(r => !r.error).length,
          failed: results.filter(r => r.error).length,
        },
      });
    }

    const succeeded = results.filter(r => !r.error).length;
    const failed = results.length - succeeded;
    await audit({
      userId: u.uid, username: u.username, action: 'wan-bulk-enable', ip: req.ip,
      details: { total: results.length, succeeded, failed, durationMs: Date.now() - t0 },
    });
    realtimeHub.broadcast({
      type: 'wan.bulk',
      payload: { action: 'enable', total: valid.length, done: valid.length, succeeded, failed, status: 'done' },
    });

    return { results, summary: { total: results.length, succeeded, failed, durationMs: Date.now() - t0 } };
  });

  // Bulk disable
  app.post('/api/wan/bulk-disable', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { indices } = req.body as { indices: number[] };
    if (!Array.isArray(indices) || indices.length === 0) {
      return reply.code(400).send({ error: 'indices phải là mảng không rỗng' });
    }
    if (indices.length > 50) {
      return reply.code(400).send({ error: 'Tối đa 50 PPPoE mỗi lần' });
    }
    const valid = indices.filter(i => Number.isInteger(i) && i >= 1 && i <= maxWanIdx());
    if (valid.length === 0) return reply.code(400).send({ error: 'Không có index hợp lệ (>=1)' });

    const u = req.user as any;
    const t0 = Date.now();
    const results = await Promise.all(valid.map(idx => disablePppoeOnly(idx, u.uid, u.username, req.ip)));

    const succeeded = results.filter(r => !r.error).length;
    await audit({
      userId: u.uid, username: u.username, action: 'wan-bulk-disable', ip: req.ip,
      details: { total: results.length, succeeded, failed: results.length - succeeded, durationMs: Date.now() - t0 },
    });

    return { results, summary: { total: results.length, succeeded, failed: results.length - succeeded, durationMs: Date.now() - t0 } };
  });
}