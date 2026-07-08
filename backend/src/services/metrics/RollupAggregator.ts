// Aggregate ProxyTrafficSample → ProxyTrafficRollup (hour → day/week/month)
import { prisma } from '../../db/prisma';
import { config } from '../../lib/config';
import { logger } from '../../lib/logger';
import {
  integrateSamples,
  parentBucket,
  type RollupPeriod,
} from '../../lib/metricsBucketUtils';

const ROLLUP_MS = parseInt(process.env.METRICS_ROLLUP_MS || '300000', 10);
const WATERMARK_KEY = 'metrics.rollup.watermark';
const SAMPLE_LOOKBACK_MS = 6 * 60 * 60 * 1000;

const RETENTION: Record<RollupPeriod, { count: number; ms?: number }> = {
  hour: { count: 48 },
  day: { count: 30 },
  week: { count: 12 },
  month: { count: 12 },
};

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

async function getWatermark(): Promise<Date> {
  const row = await prisma.setting.findUnique({ where: { key: WATERMARK_KEY } });
  if (row?.value) {
    const d = new Date(row.value);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date(Date.now() - SAMPLE_LOOKBACK_MS);
}

async function setWatermark(ts: Date): Promise<void> {
  await prisma.setting.upsert({
    where: { key: WATERMARK_KEY },
    create: { key: WATERMARK_KEY, value: ts.toISOString() },
    update: { value: ts.toISOString() },
  });
}

async function upsertRollup(
  proxyId: number,
  period: RollupPeriod,
  bucket: string,
  rx: bigint,
  tx: bigint,
): Promise<void> {
  if (rx === 0n && tx === 0n) return;
  const existing = await prisma.proxyTrafficRollup.findUnique({
    where: { proxyId_period_bucket: { proxyId, period, bucket } },
  });
  if (existing) {
    await prisma.proxyTrafficRollup.update({
      where: { id: existing.id },
      data: {
        rxBytes: existing.rxBytes + rx,
        txBytes: existing.txBytes + tx,
      },
    });
  } else {
    await prisma.proxyTrafficRollup.create({
      data: { proxyId, period, bucket, rxBytes: rx, txBytes: tx },
    });
  }
}

async function rollupHoursFromSamples(since: Date, until: Date): Promise<number> {
  const samples = await prisma.proxyTrafficSample.findMany({
    where: { ts: { gt: since, lte: until } },
    orderBy: [{ proxyId: 'asc' }, { ts: 'asc' }],
    select: { proxyId: true, ts: true, rxBps: true, txBps: true },
  });
  if (!samples.length) return 0;

  const proxyIds = [...new Set(samples.map(s => s.proxyId))];
  const anchors = await Promise.all(
    proxyIds.map(async proxyId => {
      const row = await prisma.proxyTrafficSample.findFirst({
        where: { proxyId, ts: { lte: since } },
        orderBy: { ts: 'desc' },
        select: { proxyId: true, ts: true, rxBps: true, txBps: true },
      });
      return row;
    }),
  );

  const byProxy = new Map<number, Array<{ ts: Date; rxBps: number; txBps: number }>>();
  for (const a of anchors) {
    if (!a) continue;
    byProxy.set(a.proxyId, [{ ts: a.ts, rxBps: a.rxBps, txBps: a.txBps }]);
  }
  for (const s of samples) {
    const arr = byProxy.get(s.proxyId) || [];
    arr.push({ ts: s.ts, rxBps: s.rxBps, txBps: s.txBps });
    byProxy.set(s.proxyId, arr);
  }

  let buckets = 0;
  for (const [proxyId, pts] of byProxy) {
    const { byHour } = integrateSamples(pts);
    for (const [bucket, v] of byHour) {
      await upsertRollup(proxyId, 'hour', bucket, v.rx, v.tx);
      buckets++;
    }
  }
  return buckets;
}

async function rollupCoarser(from: RollupPeriod, to: RollupPeriod): Promise<number> {
  const src = await prisma.proxyTrafficRollup.findMany({ where: { period: from } });
  if (!src.length) return 0;

  const grouped = new Map<string, { proxyId: number; bucket: string; rx: bigint; tx: bigint }>();
  for (const r of src) {
    const parent = parentBucket(from, r.bucket);
    if (!parent) continue;
    const key = `${r.proxyId}:${parent}`;
    const prev = grouped.get(key) || { proxyId: r.proxyId, bucket: parent, rx: 0n, tx: 0n };
    prev.rx += r.rxBytes;
    prev.tx += r.txBytes;
    grouped.set(key, prev);
  }

  let n = 0;
  for (const g of grouped.values()) {
    const existing = await prisma.proxyTrafficRollup.findUnique({
      where: { proxyId_period_bucket: { proxyId: g.proxyId, period: to, bucket: g.bucket } },
    });
    if (existing) {
      if (existing.rxBytes === g.rx && existing.txBytes === g.tx) continue;
      await prisma.proxyTrafficRollup.update({
        where: { id: existing.id },
        data: { rxBytes: g.rx, txBytes: g.tx },
      });
    } else {
      await prisma.proxyTrafficRollup.create({
        data: { proxyId: g.proxyId, period: to, bucket: g.bucket, rxBytes: g.rx, txBytes: g.tx },
      });
    }
    n++;
  }
  return n;
}

async function retentionJob(): Promise<void> {
  const now = Date.now();
  for (const period of ['hour', 'day', 'week', 'month'] as RollupPeriod[]) {
    const cfg = RETENTION[period];
    const rows = await prisma.proxyTrafficRollup.findMany({
      where: { period },
      orderBy: { bucket: 'desc' },
      select: { id: true, bucket: true },
    });
    const toDelete: number[] = [];
    if (period === 'hour') {
      const cutoff = new Date(now - cfg.count * 60 * 60 * 1000).toISOString();
      for (const r of rows) {
        if (r.bucket < cutoff) toDelete.push(r.id);
      }
    } else {
      const keep = new Set(rows.slice(0, cfg.count).map(r => r.id));
      for (const r of rows) {
        if (!keep.has(r.id)) toDelete.push(r.id);
      }
    }
    if (toDelete.length) {
      await prisma.proxyTrafficRollup.deleteMany({ where: { id: { in: toDelete } } });
      logger.info({ period, deleted: toDelete.length }, 'rollup retention');
    }
  }
}

export async function runRollupOnce(): Promise<{
  hourBuckets: number;
  dayBuckets: number;
  weekBuckets: number;
  monthBuckets: number;
  watermark: string;
}> {
  if (running) {
    return { hourBuckets: 0, dayBuckets: 0, weekBuckets: 0, monthBuckets: 0, watermark: '' };
  }
  running = true;
  try {
    const since = await getWatermark();
    const until = new Date(Date.now() - 60_000);

    const hourBuckets = await rollupHoursFromSamples(since, until);
    const dayBuckets = await rollupCoarser('hour', 'day');
    const weekBuckets = await rollupCoarser('day', 'week');
    const monthBuckets = await rollupCoarser('week', 'month');

    if (until > since) await setWatermark(until);

    return {
      hourBuckets,
      dayBuckets,
      weekBuckets,
      monthBuckets,
      watermark: until.toISOString(),
    };
  } finally {
    running = false;
  }
}

export function startRollupAggregator(): void {
  if (config.deployTarget !== 'router') return;
  if (!config.metrics.enabled) {
    logger.info('RollupAggregator disabled (METRICS_ENABLED=false / LOW_CPU_MODE)');
    return;
  }
  if (timer) return;

  timer = setInterval(() => {
    runRollupOnce()
      .then(r => {
        if (r.hourBuckets > 0) {
          logger.info(r, 'rollup completed');
        }
      })
      .catch(e => logger.warn({ err: e.message }, 'rollup error'));
  }, ROLLUP_MS);

  setInterval(() => {
    retentionJob().catch(() => {});
  }, 60 * 60 * 1000);

  setTimeout(() => runRollupOnce().catch(() => {}), 30_000);
  logger.info({ rollupMs: ROLLUP_MS }, 'RollupAggregator started');
}

export function stopRollupAggregator(): void {
  if (timer) clearInterval(timer);
  timer = null;
}