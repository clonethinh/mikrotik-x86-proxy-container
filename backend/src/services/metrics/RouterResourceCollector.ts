import { prisma } from '../../db/prisma';
import { config } from '../../lib/config';
import { isContainerRunning } from '../../lib/containerUtils';
import { logger } from '../../lib/logger';
import { normalizeRouterResource } from '../../lib/mikrotikResourceUtils';
import { getMikrotikService } from '../mikrotik/MikrotikService';

const POLL_MS = parseInt(
  process.env.ROUTER_METRICS_POLL_MS || (config.lowCpu ? '60000' : '30000'),
  10,
);
const RETENTION_MS = parseInt(process.env.ROUTER_METRICS_RETENTION_MS || String(24 * 60 * 60 * 1000), 10);
const PRUNE_EVERY = 20;

let timer: ReturnType<typeof setInterval> | null = null;
let tickCount = 0;

export async function sampleRouterResourceOnce(): Promise<void> {
  const mik = getMikrotikService();
  const [resourceRaw, containers] = await Promise.all([
    mik.getSystemResource().catch(() => ({})),
    mik.getContainers().catch(() => []),
  ]);
  const r = normalizeRouterResource(resourceRaw as Record<string, unknown>);
  const containerTotal = containers.length;
  const containerRunning = containers.filter(c => isContainerRunning(c.status)).length;

  await prisma.routerResourceSample.create({
    data: {
      cpuLoadPct: r.cpuLoadPct,
      memoryUsedPct: r.memoryUsedPct,
      freeMemoryBytes: r.freeMemoryBytes != null ? BigInt(r.freeMemoryBytes) : null,
      totalMemoryBytes: r.totalMemoryBytes != null ? BigInt(r.totalMemoryBytes) : null,
      hddUsedPct: r.hddUsedPct,
      uptimeSec: r.uptimeSec,
      containerTotal,
      containerRunning,
    },
  });

  tickCount++;
  if (tickCount % PRUNE_EVERY === 0) {
    const cutoff = new Date(Date.now() - RETENTION_MS);
    await prisma.routerResourceSample.deleteMany({ where: { ts: { lt: cutoff } } }).catch(() => {});
  }
}

async function tick(): Promise<void> {
  try {
    await sampleRouterResourceOnce();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn({ err: msg.slice(0, 120) }, 'RouterResourceCollector tick failed');
  }
}

export function startRouterResourceCollector(): void {
  if (timer) return;
  if (config.deployTarget !== 'router') {
    logger.info('RouterResourceCollector skipped (deployTarget !== router)');
    return;
  }
  timer = setInterval(() => { void tick(); }, POLL_MS);
  void tick();
  logger.info({ pollMs: POLL_MS, retentionMs: RETENTION_MS }, 'RouterResourceCollector started');
}

export function stopRouterResourceCollector(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}