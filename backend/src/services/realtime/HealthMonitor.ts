// Health monitor - periodically check all proxies (staggered)
import { prisma } from '../../db/prisma';
import { proxyService } from '../proxy/ProxyService';
import { realtimeHub } from '../../realtime/hub';
import { getMikrotikService } from '../mikrotik/MikrotikService';
import { config } from '../../lib/config';
import { logger } from '../../lib/logger';
import { resolveProxyEgress } from '../../lib/proxyEgressUtils';
import { isHubMode } from '../../lib/hubUtils';
import { isUsableWanIp } from '../../lib/ipQualityUtils';

let timer: NodeJS.Timeout | null = null;
let running = false;
let staggeredIndex = 0;

async function tickOne(): Promise<void> {
  // Lấy 1 proxy theo round-robin để tránh burst SSH + Mikrotik load
  const proxies = await prisma.proxyUser.findMany({
    where: { enabled: true },
    orderBy: { pppoeIdx: 'asc' },
  });
  if (proxies.length === 0) return;
  const proxy = proxies[staggeredIndex % proxies.length];
  staggeredIndex++;
  try {
    await proxyService.healthCheck(proxy.id);
  } catch (e: any) {
    logger.warn({ err: e.message, pppoeIdx: proxy.pppoeIdx }, 'health check failed');
  }
}

async function syncWan(): Promise<void> {
  try {
    const mik = getMikrotikService();
    const pppoes = await mik.getPppoeInterfaces();
    for (const p of pppoes) {
      await prisma.wanStatus.upsert({
        where: { pppoeName: p.name },
        create: {
          pppoeName: p.name, pppoeIdx: p.index,
          isUp: p.running, publicIp: p.publicIp,
        },
        update: { isUp: p.running, publicIp: p.publicIp, updatedAt: new Date() },
      });
      if (!p.publicIp) continue;
      const proxies = await prisma.proxyUser.findMany({ where: { enabled: true } });
      for (const proxy of proxies) {
        if (resolveProxyEgress(proxy) !== p.name) continue;
        if (!isUsableWanIp(p.publicIp)) continue;
        if (proxy.publicIp === p.publicIp) continue;
        await prisma.ipHistory.create({
          data: { proxyId: proxy.id, oldIp: proxy.publicIp, newIp: p.publicIp, source: 'sync' },
        }).catch(() => {});
        await prisma.proxyUser.update({
          where: { id: proxy.id },
          data: { publicIp: p.publicIp },
        });
        try {
          if (isHubMode()) {
            await proxyService.updateSrcnatIp(proxy.pppoeIdx, p.publicIp, p.name);
          } else {
            await proxyService.updateSrcnatIp(proxy.pppoeIdx, p.publicIp);
            await proxyService.updateDstnatIp(proxy.pppoeIdx, p.publicIp);
          }
          logger.info({ pppoeIdx: proxy.pppoeIdx, egress: p.name, oldIp: proxy.publicIp, newIp: p.publicIp }, 'srcnat auto-updated after IP change');
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          logger.warn({ err: msg, pppoeIdx: proxy.pppoeIdx, egress: p.name }, 'srcnat auto-update failed');
        }
        realtimeHub.broadcast({
          type: 'proxy.ip-changed',
          payload: { id: proxy.id, pppoeIdx: proxy.pppoeIdx, newIp: p.publicIp, oldIp: proxy.publicIp, egress: p.name },
        });
      }
    }
    realtimeHub.broadcast({ type: 'wan.sync', payload: pppoes });
  } catch (e: any) {
    logger.warn({ err: e.message }, 'WAN sync failed');
  }
}

async function tick() {
  if (running) return;
  running = true;
  try {
    // Stagger: chỉ check 1 proxy mỗi tick (interval/numProxies là khoảng)
    await tickOne();
    // WanWatcher đã sync WAN trên router — tránh REST /pppoe trùng
    const skipWan = config.deployTarget === 'router' && config.health.skipWanSyncOnRouter;
    if (!skipWan && staggeredIndex % 5 === 0) await syncWan();
  } finally {
    running = false;
  }
}

export function startHealthMonitor() {
  if (timer) return;
  logger.info({ intervalMs: config.health.intervalMs }, 'health monitor starting (staggered)');
  // First tick after 5s, then every interval
  setTimeout(() => { tick(); }, 5_000);
  timer = setInterval(tick, config.health.intervalMs);
}

export function stopHealthMonitor() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}