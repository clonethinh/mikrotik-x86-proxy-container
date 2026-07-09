// WanWatcher — poll PPPoE diff for infinite pool rotation (pppoe-outX appears/disappears)
import { prisma } from '../../db/prisma';
import { getMikrotikService, type PppoeInterface } from '../mikrotik/MikrotikService';
import { realtimeHub } from '../../realtime/hub';
import { logger } from '../../lib/logger';
import { config } from '../../lib/config';
import { isManagedPppoeName, parsePppoeIdx } from '../../lib/pppoeUtils';
import { getAutoProxySettings } from './AutoProxySettings';
import { autoProvisionOrchestrator } from './AutoProvisionOrchestrator';
import { hubProxyService } from '../proxy/HubProxyService';
import { isHubMode } from '../../lib/hubUtils';
import { clearWanProbeCache, probeWanInternet } from '../wan/WanInternetProbe';
import { resolveProxyEgress } from '../../lib/proxyEgressUtils';
import { isBadWanIp, isUsableWanIp } from '../../lib/ipQualityUtils';
import { reallocateProxiesOnWanDisable } from '../proxy/PoolAllocator';

type Snapshot = Map<string, { running: boolean; publicIp: string | null; idx: number }>;

/** WAN egress nhận IP xấu (169.254 / CGNAT / mất IP) — đánh dấu pending rồi thử đổi egress pool. */
async function handleBadEgressIp(egressName: string, badIp: string | null): Promise<void> {
  if (!isHubMode()) return;
  const proxies = await prisma.proxyUser.findMany({ where: { enabled: true } });
  for (const proxy of proxies) {
    if (resolveProxyEgress(proxy) !== egressName) continue;
    await prisma.proxyUser.update({
      where: { id: proxy.id },
      data: {
        status: 'pending',
        statusMessage: `${egressName} IP xấu (${badIp || 'none'}) — chờ IP public hoặc đổi egress`,
      },
    });
    realtimeHub.broadcast({
      type: 'proxy.status',
      payload: { id: proxy.id, status: 'pending', pppoeIdx: proxy.pppoeIdx },
    });
  }
  const { reallocated, pending } = await reallocateProxiesOnWanDisable(egressName);
  if (reallocated > 0) {
    logger.info({ egressName, badIp, reallocated, pending }, 'bad egress — reallocated proxies');
  }
}

/** Tất cả proxy dùng egressName làm WAN ra — gọi khi IP của interface đó đổi. */
async function tryFinalizeEgressIpChange(egressName: string, publicIp: string): Promise<void> {
  if (!isHubMode() || !isUsableWanIp(publicIp)) return;
  const proxies = await prisma.proxyUser.findMany({ where: { enabled: true } });
  for (const proxy of proxies) {
    if (resolveProxyEgress(proxy) !== egressName) continue;
    await tryFinalizeSlotProxy(proxy.pppoeIdx, egressName, publicIp);
  }
}

/** Khi IP egress WAN lên — patch NAT slot (chỉ khi proxy slot dùng đúng egress). */
async function tryFinalizeSlotProxy(pppoeIdx: number, egressName: string, publicIp: string) {
  if (!isHubMode() || !isUsableWanIp(publicIp)) return;
  const proxy = await prisma.proxyUser.findUnique({ where: { pppoeIdx } });
  if (!proxy?.enabled) return;

  const egress = resolveProxyEgress(proxy);
  if (egress !== egressName) return;

  const needsFinalize = proxy.status === 'pending'
    || !proxy.publicIp
    || isBadWanIp(proxy.publicIp)
    || proxy.publicIp !== publicIp;

  if (!needsFinalize) return;
  try {
    const probe = await probeWanInternet(egress, publicIp);
    if (!probe.ok && !probe.skipped) {
      await prisma.proxyUser.update({
        where: { id: proxy.id },
        data: {
          publicIp,
          status: 'pending',
          statusMessage: `${egress} · ${publicIp} · chờ internet (ping ${config.wan.pingTarget})`,
        },
      });
      realtimeHub.broadcast({
        type: 'wan.internet-pending',
        payload: { pppoeIdx, pppoeName: egress, publicIp, received: probe.received },
      });
      return;
    }
    if (!probe.ok && probe.skipped) {
      return;
    }

    await hubProxyService.finalizeHubSlotIp(pppoeIdx, egress, publicIp);
    const rttPart = probe.avgRttMs != null ? ` · ping ${probe.avgRttMs}ms` : '';
    await prisma.proxyUser.update({
      where: { id: proxy.id },
      data: {
        publicIp,
        status: 'running',
        statusMessage: `hub slot ${pppoeIdx} · ${egress} · ${publicIp}${rttPart}`,
        lastLatencyMs: probe.avgRttMs ?? proxy.lastLatencyMs,
        lastCheckAt: probe.avgRttMs != null ? new Date() : proxy.lastCheckAt,
      },
    });
    realtimeHub.broadcast({
      type: 'proxy.applied',
      payload: { id: proxy.id, mode: 'hub', publicIp, pingMs: probe.avgRttMs },
    });
    realtimeHub.broadcast({
      type: 'wan.internet-up',
      payload: { pppoeIdx, pppoeName: egress, publicIp, pingMs: probe.avgRttMs, received: probe.received },
    });
    realtimeHub.broadcast({ type: 'wan.sync', payload: { ts: Date.now(), reason: 'ip-finalized' } });
    logger.info({ pppoeIdx, publicIp, pingMs: probe.avgRttMs }, 'pending proxy IP finalized');
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn({ err: msg.slice(0, 120), pppoeIdx }, 'finalize pending proxy failed');
  }
}

let timer: NodeJS.Timeout | null = null;
let lastSnapshot: Snapshot = new Map();
let goneMissCounts = new Map<string, number>();
let ticking = false;
let bootstrapped = false;

function buildSnapshot(pppoes: PppoeInterface[]): Snapshot {
  const snap = new Map<string, { running: boolean; publicIp: string | null; idx: number }>();
  for (const p of pppoes) {
    if (!isManagedPppoeName(p.name)) continue;
    snap.set(p.name, { running: p.running, publicIp: p.publicIp, idx: p.index });
  }
  return snap;
}

async function upsertWanStatus(p: PppoeInterface) {
  await prisma.wanStatus.upsert({
    where: { pppoeName: p.name },
    create: {
      pppoeName: p.name,
      pppoeIdx: p.index,
      isUp: p.running,
      publicIp: p.publicIp,
    },
    update: { isUp: p.running, publicIp: p.publicIp, updatedAt: new Date() },
  });
}

async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const settings = await getAutoProxySettings();
    const mik = getMikrotikService();
    const all = await mik.getPppoeInterfaces().catch(() => []);
    const managed = all.filter(p => isManagedPppoeName(p.name));

    for (const p of all.filter(x => x.name.startsWith('pppoe-out'))) {
      const prev = lastSnapshot.get(p.name);
      const changed = !prev
        || prev.running !== p.running
        || prev.publicIp !== p.publicIp;
      if (changed || !bootstrapped) {
        await upsertWanStatus(p).catch(() => {});
      }
    }

    const snap = buildSnapshot(managed);
    const now = new Date();

    // First poll: seed snapshot only — không trigger discovery cho PPPoE đã có sẵn
    if (!bootstrapped) {
      bootstrapped = true;
      lastSnapshot = snap;
      for (const [name, cur] of snap) {
        const proxy = await prisma.proxyUser.findUnique({ where: { pppoeIdx: cur.idx } });
        const disc = await prisma.wanDiscovery.upsert({
          where: { pppoeName: name },
          create: {
            pppoeName: name,
            pppoeIdx: cur.idx,
            workflowState: proxy?.status === 'running' ? 'active' : 'discovered',
            publicIp: cur.publicIp,
            proxyId: proxy?.id ?? null,
            lastSeenAt: now,
          },
          update: {
            publicIp: cur.publicIp,
            lastSeenAt: now,
            ...(proxy?.status === 'running' ? { workflowState: 'active', proxyId: proxy.id } : {}),
          },
        });
        // Sau restart WebUI: retry auto-provision cho WAN đang up nhưng chưa có proxy chạy
        if (settings.mode !== 'off' && cur.running && proxy?.status !== 'running') {
          const wf = disc.workflowState;
          if (['discovered', 'error', 'queued'].includes(wf)) {
            void autoProvisionOrchestrator.onDiscovered(disc.id, cur.idx, name);
          }
        }
      }
      realtimeHub.broadcast({ type: 'wan.poll', payload: { count: managed.length, ts: Date.now(), bootstrap: true } });
      return;
    }

    // --- Discovered / IP changed / still alive ---
    for (const [name, cur] of snap) {
      const prev = lastSnapshot.get(name);
      goneMissCounts.delete(name);

      if (!prev) {
        // New interface on router
        const disc = await prisma.wanDiscovery.upsert({
          where: { pppoeName: name },
          create: {
            pppoeName: name,
            pppoeIdx: cur.idx,
            workflowState: cur.running ? 'discovered' : 'discovered',
            publicIp: cur.publicIp,
            lastSeenAt: now,
          },
          update: {
            pppoeIdx: cur.idx,
            publicIp: cur.publicIp,
            lastSeenAt: now,
            goneAt: null,
            workflowState: cur.running ? 'discovered' : 'discovered',
          },
        });

        realtimeHub.broadcast({
          type: 'wan.discovered',
          payload: { pppoeName: name, pppoeIdx: cur.idx, publicIp: cur.publicIp, running: cur.running },
        });
        logger.info({ name, idx: cur.idx, ip: cur.publicIp }, 'wan discovered');

        if (cur.running && settings.mode !== 'off') {
          void autoProvisionOrchestrator.onDiscovered(disc.id, cur.idx, name);
        }
      } else {
        // Existing — update last seen
        await prisma.wanDiscovery.updateMany({
          where: { pppoeName: name },
          data: { lastSeenAt: now, publicIp: cur.publicIp, pppoeIdx: cur.idx },
        });

        if (cur.publicIp && prev.publicIp && cur.publicIp !== prev.publicIp) {
          clearWanProbeCache(name);
          realtimeHub.broadcast({
            type: 'wan.ip-changed',
            payload: { pppoeName: name, pppoeIdx: cur.idx, oldIp: prev.publicIp, newIp: cur.publicIp },
          });
          if (isUsableWanIp(cur.publicIp)) {
            void tryFinalizeEgressIpChange(name, cur.publicIp);
          } else if (isBadWanIp(cur.publicIp)) {
            void handleBadEgressIp(name, cur.publicIp);
          }
        } else if (isBadWanIp(cur.publicIp) && cur.running) {
          void handleBadEgressIp(name, cur.publicIp);
        } else if (isUsableWanIp(cur.publicIp) && (!prev.publicIp || isBadWanIp(prev.publicIp))) {
          clearWanProbeCache(name);
          void tryFinalizeEgressIpChange(name, cur.publicIp);
        } else if (isUsableWanIp(cur.publicIp) && cur.running) {
          const proxy = await prisma.proxyUser.findUnique({ where: { pppoeIdx: cur.idx } });
          if (proxy?.status === 'pending') {
            void tryFinalizeEgressIpChange(name, cur.publicIp);
          } else if (!proxy && settings.mode !== 'off') {
            const disc = await prisma.wanDiscovery.findUnique({ where: { pppoeName: name } });
            if (disc && ['queued', 'error', 'discovered'].includes(disc.workflowState)) {
              void autoProvisionOrchestrator.onDiscovered(disc.id, cur.idx, name);
            }
          }
        }

        // Came back from gone → re-discover if no active proxy
        if (!prev.running && cur.running) {
          const disc = await prisma.wanDiscovery.findUnique({ where: { pppoeName: name } });
          const proxy = await prisma.proxyUser.findUnique({ where: { pppoeIdx: cur.idx } });
          if (disc && ['gone', 'stale'].includes(disc.workflowState) && (!proxy || proxy.status !== 'running')) {
            await prisma.wanDiscovery.update({
              where: { id: disc.id },
              data: { workflowState: 'discovered', goneAt: null, staleAt: null, error: null },
            });
            realtimeHub.broadcast({
              type: 'wan.discovered',
              payload: { pppoeName: name, pppoeIdx: cur.idx, publicIp: cur.publicIp, reappeared: true },
            });
            if (settings.mode !== 'off') {
              void autoProvisionOrchestrator.onDiscovered(disc.id, cur.idx, name);
            }
          }
        }
      }
    }

    // --- Gone detection (debounced) → purge ngay sau debounce ---
    const debounce = settings.goneDebouncePolls;
    for (const [name, prev] of lastSnapshot) {
      if (snap.has(name)) continue;
      const misses = (goneMissCounts.get(name) || 0) + 1;
      goneMissCounts.set(name, misses);
      if (misses < debounce) continue;

      goneMissCounts.delete(name);
      clearWanProbeCache(name);
      const idx = prev.idx;
      const disc = await prisma.wanDiscovery.findUnique({ where: { pppoeName: name } });
      if (disc && disc.workflowState !== 'gone') {
        await prisma.wanDiscovery.update({
          where: { id: disc.id },
          data: { workflowState: 'gone', goneAt: now, staleAt: now },
        });
        realtimeHub.broadcast({
          type: 'wan.gone',
          payload: { pppoeName: name, pppoeIdx: idx, purging: true },
        });
        logger.info({ name, idx }, 'wan gone — auto purge');
        void autoProvisionOrchestrator.onGone(idx, name);
        void autoProvisionOrchestrator.onStaleExpired(idx, name);
      }
    }

    // Safety net: stale rows còn sót (restart giữa chừng) — purge sau TTL ngắn
    const staleCutoff = new Date(now.getTime() - settings.staleTtlMs);
    const staleRows = await prisma.wanDiscovery.findMany({
      where: { workflowState: 'stale', staleAt: { lte: staleCutoff } },
    });
    for (const row of staleRows) {
      await prisma.wanDiscovery.update({
        where: { id: row.id },
        data: { workflowState: 'gone' },
      });
      void autoProvisionOrchestrator.onStaleExpired(row.pppoeIdx, row.pppoeName);
    }

    lastSnapshot = snap;
    void autoProvisionOrchestrator.retryQueued();
    realtimeHub.broadcast({ type: 'wan.poll', payload: { count: managed.length, ts: Date.now() } });
  } catch (e: any) {
    logger.warn({ err: e.message }, 'WanWatcher tick failed');
  } finally {
    ticking = false;
  }
}

export function startWanWatcher() {
  if (timer) return;
  void getAutoProxySettings().then(s => {
    logger.info({ pollMs: s.pollIntervalMs, mode: s.mode }, 'WanWatcher starting');
    setTimeout(() => { void tick(); }, 3_000);
    timer = setInterval(() => { void tick(); }, s.pollIntervalMs);
  });
}

export function stopWanWatcher() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

/** Re-read poll interval after settings change */
export async function restartWanWatcherInterval() {
  stopWanWatcher();
  startWanWatcher();
}

export async function getDiscoveryList() {
  return prisma.wanDiscovery.findMany({ orderBy: { lastSeenAt: 'desc' }, take: 100 });
}