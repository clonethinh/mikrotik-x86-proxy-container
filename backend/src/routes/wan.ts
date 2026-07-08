// WAN control routes — bật/tắt pppoe-outX + auto-create proxy
import type { FastifyInstance } from 'fastify';
import { prisma } from '../db/prisma';
import { getMikrotikService } from '../services/mikrotik/MikrotikService';
import { proxyService } from '../services/proxy/ProxyService';
import { audit } from '../services/audit';
import { realtimeHub } from '../realtime/hub';
import { logger } from '../lib/logger';
import { config } from '../lib/config';

export interface WanEnableResult {
  pppoeIdx: number;
  pppoeName: string;
  enabled: boolean;
  publicIp: string | null;
  proxyCreated: boolean;
  proxyId: number | null;
  proxyStatus: string | null;
  error: string | null;
  durationMs: number;
}

const enablingIdx = new Set<number>();

function wanActionPayload(pppoeIdx: number, extra: Record<string, unknown> = {}) {
  return { pppoeIdx, pppoeName: `pppoe-out${pppoeIdx}`, ...extra };
}

/** Chạy enable nền — API trả về ngay, UI theo dõi qua WebSocket wan.action */
function runEnableInBackground(
  pppoeIdx: number,
  userId: number,
  username: string,
  ip: string,
): void {
  if (enablingIdx.has(pppoeIdx)) {
    realtimeHub.broadcast({
      type: 'wan.action',
      payload: wanActionPayload(pppoeIdx, { action: 'enable', status: 'error', error: 'Đang bật — chờ hoàn tất' }),
    });
    return;
  }
  enablingIdx.add(pppoeIdx);
  void enablePppoeAndApply(pppoeIdx, userId, username, ip)
    .finally(() => { enablingIdx.delete(pppoeIdx); });
}

async function enablePppoeAndApply(
  pppoeIdx: number,
  userId: number,
  username: string,
  ip: string,
): Promise<WanEnableResult> {
  const t0 = Date.now();
  const pppoeName = `pppoe-out${pppoeIdx}`;
  const mik = getMikrotikService();
  const result: WanEnableResult = {
    pppoeIdx,
    pppoeName,
    enabled: true,
    publicIp: null,
    proxyCreated: false,
    proxyId: null,
    proxyStatus: null,
    error: null,
    durationMs: 0,
  };

  try {
    realtimeHub.broadcast({ type: 'wan.action', payload: wanActionPayload(pppoeIdx, { action: 'enable', status: 'starting' }) });

    // 1. Bật PPPoE
    await mik.setPppoeEnabled(pppoeName, true);
    result.enabled = true;

    // 2. Peek IP ngắn (0ms = không chờ) — proxy apply ngay, IP finalize qua WanWatcher
    const peekMs = config.hub.fastIpPeekMs;
    const newIp = peekMs > 0
      ? await mik.waitPppoeRunning(pppoeName, peekMs)
      : await mik.peekPppoeIp(pppoeName);
    result.publicIp = newIp;
    if (newIp) {
      realtimeHub.broadcast({
        type: 'wan.action',
        payload: wanActionPayload(pppoeIdx, { action: 'enable', status: 'pppoe-up', publicIp: newIp }),
      });
    }

    // 3. Kiểm tra proxy đã tồn tại chưa
    const existing = await prisma.proxyUser.findUnique({ where: { pppoeIdx } });

    if (existing) {
      result.proxyId = existing.id;
      result.proxyCreated = false;
      if (existing.status !== 'running') {
        realtimeHub.broadcast({
          type: 'wan.action',
          payload: wanActionPayload(pppoeIdx, { action: 'enable', status: 'applying-proxy', proxyId: existing.id }),
        });
        const fresh = await proxyService.ensureApplied(existing.id);
        result.proxyStatus = fresh.status;
        result.publicIp = fresh.publicIp || newIp;
      } else if (newIp) {
        await prisma.proxyUser.update({
          where: { id: existing.id },
          data: { publicIp: newIp, status: 'running' },
        });
        result.proxyStatus = 'running';
      } else {
        result.proxyStatus = existing.status;
      }
    } else {
      realtimeHub.broadcast({
        type: 'wan.action',
        payload: wanActionPayload(pppoeIdx, { action: 'enable', status: 'creating-proxy' }),
      });
      const created = await proxyService.createAndApply({ pppoeIdx, proxyType: 'both' });
      result.proxyId = created.id;
      result.proxyCreated = true;
      result.proxyStatus = created.status;
    }

    realtimeHub.broadcast({
      type: 'wan.action',
      payload: wanActionPayload(pppoeIdx, {
        action: 'enable',
        status: 'done',
        publicIp: newIp,
        proxyId: result.proxyId,
        proxyCreated: result.proxyCreated,
        durationMs: Date.now() - t0,
      }),
    });
    realtimeHub.broadcast({ type: 'wan.sync', payload: { ts: Date.now(), reason: 'enable-done' } });
    await audit({ userId, username, action: 'wan-enable', resource: 'wan', resourceId: pppoeIdx, ip, proxyId: result.proxyId ?? undefined, details: { publicIp: newIp, proxyCreated: result.proxyCreated } });
  } catch (e: any) {
    result.error = e.message?.slice(0, 200);
    result.enabled = false;
    realtimeHub.broadcast({
      type: 'wan.action',
      payload: wanActionPayload(pppoeIdx, { action: 'enable', status: 'error', error: result.error }),
    });
    realtimeHub.broadcast({ type: 'wan.sync', payload: { ts: Date.now(), reason: 'enable-error' } });
    logger.warn({ err: e.message, pppoeIdx }, 'enablePppoeAndApply failed');
  }

  result.durationMs = Date.now() - t0;
  return result;
}

async function disablePppoeOnly(
  pppoeIdx: number,
  userId: number,
  username: string,
  ip: string,
): Promise<{ pppoeIdx: number; pppoeName: string; disabled: boolean; error: string | null; durationMs: number }> {
  const t0 = Date.now();
  const pppoeName = `pppoe-out${pppoeIdx}`;
  const mik = getMikrotikService();
  const result = {
    pppoeIdx,
    pppoeName,
    disabled: true,
    error: null as string | null,
    durationMs: 0,
  };

  try {
    realtimeHub.broadcast({ type: 'wan.action', payload: { pppoeIdx, action: 'disable', status: 'starting' } });

    // Stop container trước (nếu có)
    const proxy = await prisma.proxyUser.findUnique({ where: { pppoeIdx } });
    if (proxy) {
      try { await proxyService.stop(proxy.id); } catch { /* ignore */ }
    }

    // Tắt PPPoE
    await mik.setPppoeEnabled(pppoeName, false);

    realtimeHub.broadcast({ type: 'wan.action', payload: { pppoeIdx, action: 'disable', status: 'done' } });
    await audit({ userId, username, action: 'wan-disable', resource: 'wan', resourceId: pppoeIdx, ip, proxyId: proxy?.id });
  } catch (e: any) {
    result.error = e.message?.slice(0, 200);
    result.disabled = false;
    realtimeHub.broadcast({ type: 'wan.action', payload: { pppoeIdx, action: 'disable', status: 'error', error: result.error } });
  }

  result.durationMs = Date.now() - t0;
  return result;
}

function maxWanIdx(): number {
  return config.hub.maxPppoeOut;
}

export default async function wanRoutes(app: FastifyInstance) {
  // Tạo pppoe-out tiếp theo (clone template) — optional bật + proxy
  app.post('/api/wan/create-next', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { enable = false, createProxy = false } = (req.body as { enable?: boolean; createProxy?: boolean }) || {};
    const u = req.user as any;
    const mik = getMikrotikService();
    const maxIdx = maxWanIdx();

    try {
      const created = await mik.createPppoeOut(undefined, maxIdx);
      realtimeHub.broadcast({
        type: 'wan.created',
        payload: { pppoeIdx: created.index, name: created.name, created: created.created },
      });

      if (!enable && !createProxy) {
        await audit({
          userId: u.uid, username: u.username, action: 'wan-create', resource: 'wan',
          resourceId: created.index, ip: req.ip, details: created,
        });
        return created;
      }

      runEnableInBackground(created.index, u.uid, u.username, req.ip);
      return { ...created, accepted: true, enabling: true };
    } catch (e: any) {
      return reply.code(400).send({ error: e.message?.slice(0, 200) });
    }
  });

  // Tạo pppoe-out chỉ định (nếu chưa có)
  app.post('/api/wan/create', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { idx, enable = false } = req.body as { idx?: number; enable?: boolean };
    const u = req.user as any;
    const mik = getMikrotikService();
    const maxIdx = maxWanIdx();

    try {
      const targetIdx = idx ?? await mik.findNextPppoeOutIndex(maxIdx);
      const created = await mik.createPppoeOut(targetIdx, maxIdx);
      realtimeHub.broadcast({
        type: 'wan.created',
        payload: { pppoeIdx: created.index, name: created.name, created: created.created },
      });

      if (!enable) {
        await audit({
          userId: u.uid, username: u.username, action: 'wan-create', resource: 'wan',
          resourceId: created.index, ip: req.ip, details: created,
        });
        return created;
      }

      runEnableInBackground(created.index, u.uid, u.username, req.ip);
      return { ...created, accepted: true, enabling: true };
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

    // Chạy tuần tự (queue đã serialize rồi, nhưng enable mỗi cái mất ~30-60s)
    // → parallel nhẹ: 3 cùng lúc để không nghẽn queue
    const results: WanEnableResult[] = [];
    const CONCURRENT = 3;
    for (let i = 0; i < valid.length; i += CONCURRENT) {
      const batch = valid.slice(i, i + CONCURRENT);
      const batchResults = await Promise.all(
        batch.map(idx => enablePppoeAndApply(idx, u.uid, u.username, req.ip))
      );
      results.push(...batchResults);
      // Realtime progress
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
    await audit({ userId: u.uid, username: u.username, action: 'wan-bulk-enable', ip: req.ip, details: { total: results.length, succeeded, failed, durationMs: Date.now() - t0 } });
    realtimeHub.broadcast({ type: 'wan.bulk', payload: { action: 'enable', total: valid.length, done: valid.length, succeeded, failed, status: 'done' } });

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
    await audit({ userId: u.uid, username: u.username, action: 'wan-bulk-disable', ip: req.ip, details: { total: results.length, succeeded, failed: results.length - succeeded, durationMs: Date.now() - t0 } });

    return { results, summary: { total: results.length, succeeded, failed: results.length - succeeded, durationMs: Date.now() - t0 } };
  });
}