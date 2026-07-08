// Derive live proxy metrics from ProxyRequestLog (3proxy 0.9.6 admin /S not available)
import { prisma } from '../../db/prisma';
import { getLiveBps } from './LiveBpsTracker';

const CLIENT_WINDOW_MS = parseInt(process.env.METRICS_LOG_CLIENT_MS || '300000', 10);
const BPS_WINDOW_MS = parseInt(process.env.METRICS_LOG_BPS_MS || '30000', 10);

function isValidClientIp(ip: string | null | undefined): boolean {
  if (!ip) return false;
  const v = ip.trim();
  return v.length > 0 && v !== '-' && v !== '0.0.0.0' && v !== '::';
}

export interface LogDerivedMetrics {
  clients: number;
  rxBps: number;
  txBps: number;
  usedBytes: bigint;
  recentHits: number;
}

function startOfTodayUtc(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** Batch metrics for all proxies from request logs. */
export async function deriveLogMetrics(proxyIds: number[]): Promise<Map<number, LogDerivedMetrics>> {
  const out = new Map<number, LogDerivedMetrics>();
  if (!proxyIds.length) return out;

  const now = Date.now();
  const clientSince = new Date(now - CLIENT_WINDOW_MS);
  const bpsSince = new Date(now - BPS_WINDOW_MS);
  const dayStart = startOfTodayUtc();

  const [recentLogs, bpsLogs, dayUsed] = await Promise.all([
    prisma.proxyRequestLog.findMany({
      where: { proxyId: { in: proxyIds }, ts: { gte: clientSince } },
      select: { proxyId: true, clientIp: true },
    }),
    prisma.proxyRequestLog.findMany({
      where: { proxyId: { in: proxyIds }, ts: { gte: bpsSince } },
      select: { proxyId: true, rxBytes: true, txBytes: true },
    }),
    prisma.proxyRequestLog.groupBy({
      by: ['proxyId'],
      where: { proxyId: { in: proxyIds }, ts: { gte: dayStart } },
      _sum: { rxBytes: true, txBytes: true },
      _count: { id: true },
    }),
  ]);

  const clientsByProxy = new Map<number, Set<string>>();
  for (const row of recentLogs) {
    if (!isValidClientIp(row.clientIp)) continue;
    const set = clientsByProxy.get(row.proxyId) || new Set<string>();
    set.add(row.clientIp);
    clientsByProxy.set(row.proxyId, set);
  }

  const bpsByProxy = new Map<number, { rx: bigint; tx: bigint }>();
  for (const row of bpsLogs) {
    const prev = bpsByProxy.get(row.proxyId) || { rx: 0n, tx: 0n };
    prev.rx += row.rxBytes;
    prev.tx += row.txBytes;
    bpsByProxy.set(row.proxyId, prev);
  }

  const usedByProxy = new Map<number, { used: bigint; hits: number }>();
  for (const row of dayUsed) {
    const used = (row._sum.rxBytes ?? 0n) + (row._sum.txBytes ?? 0n);
    usedByProxy.set(row.proxyId, { used, hits: row._count.id });
  }

  const bpsDiv = BPS_WINDOW_MS / 1000;
  for (const proxyId of proxyIds) {
    const bps = bpsByProxy.get(proxyId) || { rx: 0n, tx: 0n };
    const used = usedByProxy.get(proxyId);
    const dbRx = Math.round(Number(bps.rx) / bpsDiv);
    const dbTx = Math.round(Number(bps.tx) / bpsDiv);
    const live = getLiveBps(proxyId);
    out.set(proxyId, {
      clients: clientsByProxy.get(proxyId)?.size ?? 0,
      rxBps: Math.max(dbRx, live.rxBps),
      txBps: Math.max(dbTx, live.txBps),
      usedBytes: used?.used ?? 0n,
      recentHits: used?.hits ?? 0,
    });
  }
  return out;
}