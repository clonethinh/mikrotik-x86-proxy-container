// ISO bucket helpers for ProxyTrafficRollup (hour|day|week|month)

export type RollupPeriod = 'hour' | 'day' | 'week' | 'month';

/** Hour bucket: YYYY-MM-DDTHH:00:00.000Z (UTC). */
export function hourBucket(ts: Date): string {
  const d = new Date(ts);
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString();
}

/** Day bucket: YYYY-MM-DD (UTC). */
export function dayBucket(ts: Date): string {
  const d = new Date(ts);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Week bucket: Monday of ISO week, YYYY-MM-DD (UTC). */
export function weekBucket(ts: Date): string {
  const d = new Date(ts);
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return dayBucket(d);
}

/** Month bucket: YYYY-MM-01 (UTC). */
export function monthBucket(ts: Date): string {
  const d = new Date(ts);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}-01`;
}

export function bucketForPeriod(period: RollupPeriod, ts: Date): string {
  switch (period) {
    case 'hour': return hourBucket(ts);
    case 'day': return dayBucket(ts);
    case 'week': return weekBucket(ts);
    case 'month': return monthBucket(ts);
  }
}

/** Parent bucket a finer-grained bucket rolls up into. */
export function parentBucket(period: RollupPeriod, bucket: string): string | null {
  if (period === 'hour') return dayBucket(new Date(bucket));
  if (period === 'day') {
    const d = new Date(`${bucket}T12:00:00.000Z`);
    return weekBucket(d);
  }
  if (period === 'week') {
    const d = new Date(`${bucket}T12:00:00.000Z`);
    return monthBucket(d);
  }
  return null;
}

/** Integrate bps samples into byte deltas between consecutive points. */
export function integrateSamples(
  samples: Array<{ ts: Date; rxBps: number; txBps: number }>,
): { rxBytes: bigint; txBytes: bigint; byHour: Map<string, { rx: bigint; tx: bigint }> } {
  const byHour = new Map<string, { rx: bigint; tx: bigint }>();
  let rxTotal = 0n;
  let txTotal = 0n;

  for (let i = 0; i < samples.length - 1; i++) {
    const a = samples[i];
    const b = samples[i + 1];
    const dtMs = b.ts.getTime() - a.ts.getTime();
    if (dtMs <= 0 || dtMs > 120_000) continue;

    const dtSec = dtMs / 1000;
    const rxDelta = BigInt(Math.round(a.rxBps * dtSec));
    const txDelta = BigInt(Math.round(a.txBps * dtSec));
    if (rxDelta === 0n && txDelta === 0n) continue;

    rxTotal += rxDelta;
    txTotal += txDelta;

    const bucket = hourBucket(a.ts);
    const prev = byHour.get(bucket) || { rx: 0n, tx: 0n };
    prev.rx += rxDelta;
    prev.tx += txDelta;
    byHour.set(bucket, prev);
  }

  return { rxBytes: rxTotal, txBytes: txTotal, byHour };
}