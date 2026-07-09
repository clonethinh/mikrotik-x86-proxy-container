// WAN enable/disable — dùng chung cho routes và create queue
import { prisma } from '../../db/prisma';
import { getMikrotikService } from '../mikrotik/MikrotikService';
import { proxyService } from '../proxy/ProxyService';
import { audit } from '../audit';
import { realtimeHub } from '../../realtime/hub';
import { logger } from '../../lib/logger';
import { config } from '../../lib/config';
import { isHubMode } from '../../lib/hubUtils';
import { reallocateProxiesOnWanDisable } from '../proxy/PoolAllocator';

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
export function runEnableInBackground(
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

export async function enablePppoeAndApply(
  pppoeIdx: number,
  userId: number,
  username: string,
  ip: string,
  opts?: { justCreated?: boolean },
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

    const enabledState = await mik.setPppoeEnabled(pppoeName, true, { skipIsolation: opts?.justCreated });
    result.enabled = enabledState.enabled;

    let newIp = enabledState.publicIp;
    if (!newIp && config.hub.fastIpPeekMs > 0) {
      newIp = await mik.waitPppoeRunning(pppoeName, config.hub.fastIpPeekMs);
    }
    result.publicIp = newIp;
    if (newIp) {
      realtimeHub.broadcast({
        type: 'wan.action',
        payload: wanActionPayload(pppoeIdx, { action: 'enable', status: 'pppoe-up', publicIp: newIp }),
      });
    }

    const existing = await prisma.proxyUser.findUnique({ where: { pppoeIdx } });

    if (existing) {
      result.proxyId = existing.id;
      result.proxyCreated = false;
      if (existing.status !== 'running' || !existing.enabled) {
        realtimeHub.broadcast({
          type: 'wan.action',
          payload: wanActionPayload(pppoeIdx, {
            action: 'enable',
            status: 'applying-proxy',
            proxyId: existing.id,
            reEnable: !existing.enabled,
          }),
        });
        if (!existing.enabled) {
          const started = await proxyService.start(existing.id);
          result.proxyStatus = started.status;
          result.publicIp = started.publicIp || newIp;
        } else {
          const fresh = await proxyService.ensureApplied(existing.id, { wanIp: newIp });
          result.proxyStatus = fresh.status;
          result.publicIp = fresh.publicIp || newIp;
        }
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
      const created = await proxyService.createAndApply({ pppoeIdx, proxyType: 'both', wanIp: newIp });
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
    await audit({
      userId, username, action: 'wan-enable', resource: 'wan', resourceId: pppoeIdx, ip,
      proxyId: result.proxyId ?? undefined,
      details: { publicIp: newIp, proxyCreated: result.proxyCreated },
    });
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

export async function disablePppoeOnly(
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

    const proxy = await prisma.proxyUser.findUnique({ where: { pppoeIdx } });
    if (proxy) {
      try { await proxyService.stop(proxy.id); } catch { /* ignore */ }
    }

    await mik.setPppoeEnabled(pppoeName, false);

    if (isHubMode()) {
      const { reallocated, pending } = await reallocateProxiesOnWanDisable(pppoeName);
      if (reallocated > 0 || pending > 0) {
        realtimeHub.broadcast({
          type: 'wan.action',
          payload: { pppoeIdx, action: 'disable', status: 'egress-realloc', reallocated, pending },
        });
      }
    }

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