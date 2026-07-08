// AutoProvisionOrchestrator — semi countdown + queue for infinite pppoe-out pool
import { prisma } from '../../db/prisma';
import { getMikrotikService } from '../mikrotik/MikrotikService';
import { proxyService } from '../proxy/ProxyService';
import { realtimeHub } from '../../realtime/hub';
import { logger } from '../../lib/logger';
import { getAutoProxySettings } from './AutoProxySettings';

const countdownTimers = new Map<number, NodeJS.Timeout>();
const cancelled = new Set<number>();
const provisioning = new Set<number>();

async function countRunningProxies(): Promise<number> {
  return prisma.proxyUser.count({
    where: { enabled: true, status: { in: ['running', 'pending'] } },
  });
}

class AutoProvisionOrchestrator {
  async onDiscovered(discoveryId: number, pppoeIdx: number, pppoeName: string) {
    const settings = await getAutoProxySettings();
    if (settings.mode === 'off') return;

    const existing = await prisma.proxyUser.findUnique({ where: { pppoeIdx } });
    if (existing?.status === 'running') {
      await prisma.wanDiscovery.update({
        where: { id: discoveryId },
        data: { workflowState: 'active', proxyId: existing.id },
      });
      return;
    }

    // maxConcurrent = số luồng provision song song (CPU), không phải tổng proxy đang chạy
    if (provisioning.size >= settings.maxConcurrent) {
      await prisma.wanDiscovery.update({
        where: { id: discoveryId },
        data: { workflowState: 'queued', error: `provisioning busy (${provisioning.size}/${settings.maxConcurrent})` },
      });
      realtimeHub.broadcast({
        type: 'wan.provision.queued',
        payload: { pppoeIdx, pppoeName, provisioning: provisioning.size, max: settings.maxConcurrent },
      });
      return;
    }

    const running = await countRunningProxies();
    if (running >= settings.warnConcurrent) {
      realtimeHub.broadcast({
        type: 'wan.provision.warn',
        payload: { pppoeIdx, running, warn: settings.warnConcurrent, max: settings.maxConcurrent },
      });
    }

    if (settings.mode === 'full') {
      void this.provision(discoveryId, pppoeIdx, pppoeName);
      return;
    }

    // semi — countdown
    this.cancelCountdown(pppoeIdx);
    const ends = new Date(Date.now() + settings.countdownMs);
    await prisma.wanDiscovery.update({
      where: { id: discoveryId },
      data: { workflowState: 'countdown', countdownEnds: ends, error: null },
    });
    realtimeHub.broadcast({
      type: 'wan.provision.countdown',
      payload: { pppoeIdx, pppoeName, endsAt: ends.getTime(), ms: settings.countdownMs },
    });

    const t = setTimeout(() => {
      countdownTimers.delete(pppoeIdx);
      if (cancelled.has(pppoeIdx)) {
        cancelled.delete(pppoeIdx);
        return;
      }
      void this.provision(discoveryId, pppoeIdx, pppoeName);
    }, settings.countdownMs);
    countdownTimers.set(pppoeIdx, t);
  }

  cancelCountdown(pppoeIdx: number) {
    const t = countdownTimers.get(pppoeIdx);
    if (t) {
      clearTimeout(t);
      countdownTimers.delete(pppoeIdx);
    }
    cancelled.add(pppoeIdx);
  }

  async cancelProvision(pppoeIdx: number) {
    this.cancelCountdown(pppoeIdx);
    await prisma.wanDiscovery.updateMany({
      where: { pppoeIdx, workflowState: 'countdown' },
      data: { workflowState: 'skipped', countdownEnds: null, error: 'cancelled by user' },
    });
    realtimeHub.broadcast({ type: 'wan.provision.cancelled', payload: { pppoeIdx } });
  }

  async provisionNow(pppoeIdx: number) {
    this.cancelCountdown(pppoeIdx);
    const disc = await prisma.wanDiscovery.findFirst({ where: { pppoeIdx } });
    if (!disc) throw new Error('Không tìm thấy discovery record');
    await this.provision(disc.id, pppoeIdx, disc.pppoeName);
  }

  private async provision(discoveryId: number, pppoeIdx: number, pppoeName: string) {
    if (provisioning.has(pppoeIdx)) return;
    provisioning.add(pppoeIdx);

    const settings = await getAutoProxySettings();
    await prisma.wanDiscovery.update({
      where: { id: discoveryId },
      data: { workflowState: 'provisioning', countdownEnds: null, error: null },
    });
    realtimeHub.broadcast({
      type: 'wan.provision.start',
      payload: { pppoeIdx, pppoeName },
    });

    try {
      const mik = getMikrotikService();
      const ip = settings.ipWaitTimeoutMs > 0
        ? await mik.waitPppoeRunning(pppoeName, settings.ipWaitTimeoutMs)
        : await mik.peekPppoeIp(pppoeName);

      const existing = await prisma.proxyUser.findUnique({ where: { pppoeIdx } });
      let proxyId: number;
      if (existing) {
        const fresh = await proxyService.ensureApplied(existing.id);
        proxyId = fresh.id;
      } else {
        const created = await proxyService.createAndApply({ pppoeIdx, proxyType: 'both' });
        proxyId = created.id;
      }

      const fresh = await prisma.proxyUser.findUnique({ where: { id: proxyId } });
      const publicIp = fresh?.publicIp || ip;
      await prisma.wanDiscovery.update({
        where: { id: discoveryId },
        data: {
          workflowState: publicIp ? 'active' : 'provisioning',
          proxyId,
          publicIp: publicIp || null,
          error: null,
        },
      });
      realtimeHub.broadcast({
        type: 'wan.provision.done',
        payload: { pppoeIdx, pppoeName, proxyId, publicIp, pendingIp: !publicIp },
      });
      logger.info({ pppoeIdx, proxyId, ip: publicIp, pending: !publicIp }, 'auto-provision OK');

      // Drain queue — try next queued WAN
      void this.drainQueue();
    } catch (e: any) {
      const msg = e.message?.slice(0, 200) || 'provision failed';
      await prisma.wanDiscovery.update({
        where: { id: discoveryId },
        data: { workflowState: 'error', error: msg },
      });
      realtimeHub.broadcast({
        type: 'wan.provision.error',
        payload: { pppoeIdx, pppoeName, error: msg },
      });
      logger.warn({ err: msg, pppoeIdx }, 'auto-provision failed');
    } finally {
      provisioning.delete(pppoeIdx);
    }
  }

  /** Gọi từ WanWatcher — thử drain hàng queued (WAN có IP nhưng chưa có proxy). */
  async retryQueued(): Promise<void> {
    await this.drainQueue();
  }

  private async drainQueue() {
    const settings = await getAutoProxySettings();
    if (settings.mode === 'off') return;
    if (provisioning.size >= settings.maxConcurrent) return;

    const queued = await prisma.wanDiscovery.findFirst({
      where: { workflowState: 'queued' },
      orderBy: { discoveredAt: 'asc' },
    });
    if (!queued) return;
    void this.onDiscovered(queued.id, queued.pppoeIdx, queued.pppoeName);
  }

  async onGone(pppoeIdx: number, pppoeName: string) {
    this.cancelCountdown(pppoeIdx);
    realtimeHub.broadcast({ type: 'wan.stale', payload: { pppoeIdx, pppoeName } });
  }

  async onStaleExpired(pppoeIdx: number, pppoeName: string) {
    try {
      const result = await proxyService.purgeByPppoeIdx(pppoeIdx, pppoeName);
      if (result.purged) {
        logger.info({ pppoeIdx, pppoeName, hadProxy: result.hadProxy }, 'stale TTL: proxy purged');
      }
    } catch (e: any) {
      logger.warn({ err: e.message, pppoeIdx, pppoeName }, 'stale purge failed');
    }
    realtimeHub.broadcast({
      type: 'wan.gone.final',
      payload: { pppoeIdx, pppoeName, purged: true },
    });
    void this.drainQueue();
  }
}

export const autoProvisionOrchestrator = new AutoProvisionOrchestrator();