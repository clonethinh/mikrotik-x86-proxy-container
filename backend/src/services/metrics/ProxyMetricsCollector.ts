// Live proxy metrics from request logs + optional 3proxy admin (disabled on hub 0.9)
import { prisma } from '../../db/prisma';
import { config } from '../../lib/config';
import { hubShardId } from '../../lib/hubUtils';
import { logger } from '../../lib/logger';
import { realtimeHub } from '../../realtime/hub';
import { counterNumbers } from '../../lib/hubLimitUtils';
import { threeProxyAdminClient } from './ThreeProxyAdminClient';
import { deriveLogMetrics, type LogDerivedMetrics } from './LogMetricsDeriver';

const POLL_MS = config.metrics.pollIntervalMs;
const FLUSH_MS = parseInt(process.env.METRICS_FLUSH_MS || '30000', 10);
const SAMPLE_RETENTION_MS = 48 * 60 * 60 * 1000;
/** 3proxy 0.9 hub admin returns HTML — skip unless explicitly enabled. */
const ADMIN_ENABLED = process.env.METRICS_ADMIN_ENABLED === 'true';

interface ByteSnapshot {
  rx: bigint;
  tx: bigint;
  ts: number;
}

let timer: ReturnType<typeof setInterval> | null = null;
let flushTimer: ReturnType<typeof setInterval> | null = null;
let metricsPollPending: ReturnType<typeof setTimeout> | null = null;
const prevBytes = new Map<string, ByteSnapshot>();
const lastLive = new Map<number, {
  clients: number;
  rxBps: number;
  txBps: number;
  rxBytes: string;
  txBytes: string;
  usedBytes: string;
  quotaPct: number | null;
  sampledAt: string;
  source: 'admin' | 'logs';
}>();
const pendingSamples: Array<{
  proxyId: number;
  ts: Date;
  rxBytes: bigint;
  txBytes: bigint;
  rxBps: number;
  txBps: number;
  clients: number;
}> = [];

function usernameKey(shardId: number, username: string): string {
  return `${shardId}:${username}`;
}

type ProxyRow = {
  id: number;
  username: string;
  pppoeIdx: number;
  limit: {
    enabled: boolean;
    quotaDailyMb: number | null;
    quotaWeeklyMb: number | null;
    quotaMonthlyMb: number | null;
  } | null;
};

function buildLogEvent(
  proxy: ProxyRow,
  log: LogDerivedMetrics | undefined,
  quotaPct: number | null,
  now: number,
): {
  proxyId: number;
  clients: number;
  rxBps: number;
  txBps: number;
  rxBytes: string;
  txBytes: string;
  usedBytes: string;
  quotaPct: number | null;
  source: 'logs';
  sampledAt: string;
} {
  const usedBytes = log?.usedBytes ?? 0n;
  return {
    proxyId: proxy.id,
    clients: log?.clients ?? 0,
    rxBps: log?.rxBps ?? 0,
    txBps: log?.txBps ?? 0,
    rxBytes: '0',
    txBytes: '0',
    usedBytes: usedBytes.toString(),
    quotaPct,
    source: 'logs',
    sampledAt: new Date(now).toISOString(),
  };
}

async function publishFromLogs(proxyIds?: number[]): Promise<void> {
  const proxies = await prisma.proxyUser.findMany({
    where: { enabled: true, ...(proxyIds?.length ? { id: { in: proxyIds } } : {}) },
    select: {
      id: true,
      username: true,
      pppoeIdx: true,
      limit: {
        select: {
          enabled: true,
          quotaDailyMb: true,
          quotaWeeklyMb: true,
          quotaMonthlyMb: true,
        },
      },
    },
  });
  if (!proxies.length) return;

  const now = Date.now();
  const ids = proxies.map(p => p.id);
  const logMetrics = await deriveLogMetrics(ids);

  for (const proxy of proxies) {
    const log = logMetrics.get(proxy.id);
    const ev = buildLogEvent(proxy, log, null, now);

    pendingSamples.push({
      proxyId: proxy.id,
      ts: new Date(now),
      rxBytes: log?.usedBytes ?? 0n,
      txBytes: 0n,
      rxBps: ev.rxBps,
      txBps: ev.txBps,
      clients: ev.clients,
    });

    lastLive.set(proxy.id, ev);
    realtimeHub.broadcast({ type: 'proxy.metrics', payload: ev });
  }
}

async function pollOnce(): Promise<void> {
  if (!ADMIN_ENABLED) {
    await publishFromLogs();
    return;
  }

  const proxies = await prisma.proxyUser.findMany({
    where: { enabled: true },
    select: {
      id: true,
      username: true,
      pppoeIdx: true,
      limit: {
        select: {
          enabled: true,
          quotaDailyMb: true,
          quotaWeeklyMb: true,
          quotaMonthlyMb: true,
        },
      },
    },
  });

  const shardIds = [...new Set(
    proxies.map(p => {
      try { return hubShardId(p.pppoeIdx); } catch { return 0; }
    }),
  )];

  const now = Date.now();
  const liveEvents: Array<{
    proxyId: number;
    clients: number;
    rxBps: number;
    txBps: number;
    rxBytes: string;
    txBytes: string;
    usedBytes: string;
    quotaPct: number | null;
    source: 'admin' | 'logs';
  }> = [];

  const proxyIds = proxies.map(p => p.id);
  const logMetrics = await deriveLogMetrics(proxyIds);

  const counterByShard = new Map<number, Map<number, number>>();
  for (const shardId of shardIds) {
    const counters = await threeProxyAdminClient.pollShardCounters(shardId);
    counterByShard.set(shardId, new Map(counters.map(c => [c.counterId, c.bytesMb])));
  }

  function quotaPctFor(proxy: ProxyRow, shardId: number): number | null {
    const lim = proxy.limit;
    if (!lim?.enabled) return null;
    const quotas = [
      { mb: lim.quotaDailyMb, num: counterNumbers(proxy.pppoeIdx).daily },
      { mb: lim.quotaWeeklyMb, num: counterNumbers(proxy.pppoeIdx).weekly },
      { mb: lim.quotaMonthlyMb, num: counterNumbers(proxy.pppoeIdx).monthly },
    ].filter(q => q.mb && q.mb > 0);
    if (!quotas.length) return null;
    const cmap = counterByShard.get(shardId);
    let maxPct = 0;
    for (const q of quotas) {
      const used = cmap?.get(q.num) ?? 0;
      maxPct = Math.max(maxPct, Math.round((used / (q.mb as number)) * 1000) / 10);
    }
    return maxPct;
  }

  const proxiesByShard = new Map<number, ProxyRow[]>();
  for (const p of proxies) {
    let sid = 0;
    try { sid = hubShardId(p.pppoeIdx); } catch { continue; }
    const arr = proxiesByShard.get(sid) || [];
    arr.push(p);
    proxiesByShard.set(sid, arr);
  }

  for (const shardId of shardIds) {
    const stats = await threeProxyAdminClient.pollShard(shardId);
    const statsByUser = new Map(stats.map(s => [s.username, s]));
    const shardProxies = proxiesByShard.get(shardId) || [];

    for (const proxy of shardProxies) {
      const s = statsByUser.get(proxy.username);
      const log = logMetrics.get(proxy.id);
      const hasAdmin = !!(s && (s.rxBytes > 0n || s.txBytes > 0n || s.activeClients > 0));

      let rxBytes = s?.rxBytes ?? 0n;
      let txBytes = s?.txBytes ?? 0n;
      let clients = s?.activeClients ?? 0;
      let rxBps = 0;
      let txBps = 0;
      let source: 'admin' | 'logs' = hasAdmin ? 'admin' : 'logs';

      if (hasAdmin) {
        const key = usernameKey(shardId, proxy.username);
        const prev = prevBytes.get(key);
        if (prev && now > prev.ts) {
          const dt = (now - prev.ts) / 1000;
          if (dt > 0) {
            const drx = rxBytes >= prev.rx ? rxBytes - prev.rx : rxBytes;
            const dtx = txBytes >= prev.tx ? txBytes - prev.tx : txBytes;
            rxBps = Math.round(Number(drx) / dt);
            txBps = Math.round(Number(dtx) / dt);
          }
        }
        prevBytes.set(key, { rx: rxBytes, tx: txBytes, ts: now });
      } else if (log) {
        clients = log.clients;
        rxBps = log.rxBps;
        txBps = log.txBps;
      }

      const usedBytes = log?.usedBytes ?? 0n;

      pendingSamples.push({
        proxyId: proxy.id,
        ts: new Date(now),
        rxBytes: hasAdmin ? rxBytes : usedBytes,
        txBytes: hasAdmin ? txBytes : 0n,
        rxBps,
        txBps,
        clients,
      });

      const ev = {
        proxyId: proxy.id,
        clients,
        rxBps,
        txBps,
        rxBytes: hasAdmin ? rxBytes.toString() : '0',
        txBytes: hasAdmin ? txBytes.toString() : '0',
        usedBytes: usedBytes.toString(),
        quotaPct: quotaPctFor(proxy, shardId),
        source,
        sampledAt: new Date(now).toISOString(),
      };
      lastLive.set(proxy.id, ev);
      liveEvents.push(ev);
    }
  }

  for (const ev of liveEvents) {
    realtimeHub.broadcast({ type: 'proxy.metrics', payload: ev });
  }
}

async function flushSamples(): Promise<void> {
  if (!pendingSamples.length) return;
  const batch = pendingSamples.splice(0, pendingSamples.length);
  try {
    await prisma.proxyTrafficSample.createMany({ data: batch });
  } catch (e: any) {
    logger.warn({ err: e.message?.slice(0, 120), n: batch.length }, 'metrics flush failed');
    pendingSamples.unshift(...batch);
  }
}

async function retentionJob(): Promise<void> {
  const cutoff = new Date(Date.now() - SAMPLE_RETENTION_MS);
  try {
    await prisma.proxyTrafficSample.deleteMany({ where: { ts: { lt: cutoff } } });
  } catch (e: any) {
    logger.warn({ err: e.message?.slice(0, 80) }, 'sample retention failed');
  }
}

export function startProxyMetricsCollector(): void {
  if (config.deployTarget !== 'router') return;
  if (!config.metrics.enabled) {
    logger.info('ProxyMetricsCollector disabled (METRICS_ENABLED=false / LOW_CPU_MODE)');
    return;
  }
  if (timer) return;

  timer = setInterval(() => {
    pollOnce().catch(e => logger.warn({ err: e.message }, 'metrics poll error'));
  }, POLL_MS);

  flushTimer = setInterval(() => {
    flushSamples().catch(() => {});
  }, FLUSH_MS);

  setInterval(() => {
    retentionJob().catch(() => {});
  }, 60 * 60 * 1000);

  setTimeout(() => pollOnce().catch(() => {}), 2000);
  logger.info({ pollMs: POLL_MS, flushMs: FLUSH_MS, adminEnabled: ADMIN_ENABLED }, 'ProxyMetricsCollector started');
}

export function stopProxyMetricsCollector(): void {
  if (timer) clearInterval(timer);
  if (flushTimer) clearInterval(flushTimer);
  timer = null;
  flushTimer = null;
}

type LiveMetricsRow = {
  proxyId: number;
  clients: number;
  rxBps: number;
  txBps: number;
  rxBytes: string;
  txBytes: string;
  usedBytes: string;
  quotaPct: number | null;
  source: 'admin' | 'logs';
  sampledAt: string;
};

function mergeLogIntoLive(proxyId: number, cached: Omit<LiveMetricsRow, 'proxyId'> | undefined, log?: LogDerivedMetrics): LiveMetricsRow {
  const now = new Date().toISOString();
  const logClients = log?.clients ?? 0;
  const logRxBps = log?.rxBps ?? 0;
  const logTxBps = log?.txBps ?? 0;
  const logUsed = log?.usedBytes ?? 0n;
  const preferLogs = !cached || cached.source === 'logs' || !ADMIN_ENABLED;

  if (cached && !preferLogs) {
    return {
      proxyId,
      ...cached,
      usedBytes: logUsed > 0n ? logUsed.toString() : cached.usedBytes,
      sampledAt: now,
    };
  }

  if (cached) {
    return {
      proxyId,
      clients: Math.max(cached.clients, logClients),
      rxBps: logRxBps || cached.rxBps,
      txBps: logTxBps || cached.txBps,
      rxBytes: cached.rxBytes,
      txBytes: cached.txBytes,
      usedBytes: logUsed > 0n ? logUsed.toString() : cached.usedBytes,
      quotaPct: cached.quotaPct,
      source: 'logs',
      sampledAt: now,
    };
  }

  if (log && (logClients > 0 || logRxBps > 0 || logTxBps > 0 || logUsed > 0n)) {
    return {
      proxyId,
      clients: logClients,
      rxBps: logRxBps,
      txBps: logTxBps,
      rxBytes: '0',
      txBytes: '0',
      usedBytes: logUsed.toString(),
      quotaPct: null,
      source: 'logs',
      sampledAt: now,
    };
  }

  return {
    proxyId,
    clients: 0,
    rxBps: 0,
    txBps: 0,
    rxBytes: '0',
    txBytes: '0',
    usedBytes: '0',
    quotaPct: null,
    source: 'logs',
    sampledAt: now,
  };
}

/** Latest cached metrics for API — always merges fresh log-derived fields. */
export async function getLiveMetrics(proxyId: number): Promise<LiveMetricsRow> {
  const logMap = await deriveLogMetrics([proxyId]);
  const merged = mergeLogIntoLive(proxyId, lastLive.get(proxyId), logMap.get(proxyId));
  if (merged.clients > 0 || merged.rxBps > 0 || merged.txBps > 0 || BigInt(merged.usedBytes) > 0n) {
    return merged;
  }

  const latest = await prisma.proxyTrafficSample.findFirst({
    where: { proxyId },
    orderBy: { ts: 'desc' },
  });
  if (!latest) return merged;

  return {
    proxyId,
    clients: latest.clients,
    rxBps: latest.rxBps,
    txBps: latest.txBps,
    rxBytes: latest.rxBytes.toString(),
    txBytes: latest.txBytes.toString(),
    usedBytes: (latest.rxBytes + latest.txBytes).toString(),
    quotaPct: null,
    source: 'admin',
    sampledAt: latest.ts.toISOString(),
  };
}

/** All enabled proxies — for Proxies table bulk load. */
export async function getAllLiveMetrics(): Promise<LiveMetricsRow[]> {
  const proxies = await prisma.proxyUser.findMany({
    where: { enabled: true },
    select: { id: true },
  });
  const ids = proxies.map(p => p.id);
  const logMap = await deriveLogMetrics(ids);
  return ids.map(id => mergeLogIntoLive(id, lastLive.get(id), logMap.get(id)));
}

/** Push metrics immediately after new request logs (realtime WS). */
export function scheduleMetricsPoll(proxyIds?: number[]): void {
  if (config.deployTarget !== 'router') return;
  if (metricsPollPending) clearTimeout(metricsPollPending);
  metricsPollPending = setTimeout(() => {
    metricsPollPending = null;
    const run = proxyIds?.length
      ? publishFromLogs(proxyIds)
      : pollOnce();
    run.catch(e => logger.warn({ err: e.message }, 'metrics publish error'));
  }, 150);
}