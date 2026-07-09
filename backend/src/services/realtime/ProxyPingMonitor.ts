// Auto ping proxy egress qua PPPoE — batch round-robin, nhẹ hơn full health check
import { prisma } from '../../db/prisma';
import { config } from '../../lib/config';
import { logger } from '../../lib/logger';
import { proxyService } from '../proxy/ProxyService';

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;
let staggeredIndex = 0;

async function tick(): Promise<void> {
  if (running) return;
  if (!config.health.pingEnabled || !config.wan.pingEnabled) return;
  running = true;
  try {
    const proxies = await prisma.proxyUser.findMany({
      where: { enabled: true },
      orderBy: { pppoeIdx: 'asc' },
      select: { id: true, pppoeIdx: true },
    });
    if (!proxies.length) return;

    const batch = Math.max(1, config.health.pingBatchSize);
    for (let i = 0; i < batch; i++) {
      const proxy = proxies[(staggeredIndex + i) % proxies.length];
      try {
        await proxyService.pingEgress(proxy.id);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.warn({ err: msg, proxyId: proxy.id, pppoeIdx: proxy.pppoeIdx }, 'auto proxy ping failed');
      }
    }
    staggeredIndex = (staggeredIndex + batch) % proxies.length;
  } finally {
    running = false;
  }
}

export function startProxyPingMonitor(): void {
  if (timer) return;
  if (!config.health.pingEnabled) {
    logger.info('ProxyPingMonitor disabled (PROXY_PING_ENABLED=false)');
    return;
  }
  if (config.deployTarget !== 'router') return;

  const ms = config.health.pingIntervalMs;
  logger.info({ intervalMs: ms, batch: config.health.pingBatchSize }, 'ProxyPingMonitor starting');
  setTimeout(() => { void tick(); }, 8_000);
  timer = setInterval(() => { void tick(); }, ms);
}

export function stopProxyPingMonitor(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}