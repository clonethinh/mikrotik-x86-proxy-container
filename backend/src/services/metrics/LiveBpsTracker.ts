// In-memory snappy bps from completed request logs (3proxy logs on request end)
const WINDOW_MS = parseInt(process.env.METRICS_LIVE_BPS_MS || '20000', 10);
const EMA_ALPHA = 0.55;

interface Sample {
  ts: number;
  rxBps: number;
  txBps: number;
}

interface State {
  samples: Sample[];
  emaRx: number;
  emaTx: number;
  lastTs: number;
}

const byProxy = new Map<number, State>();

function stateFor(proxyId: number): State {
  let s = byProxy.get(proxyId);
  if (!s) {
    s = { samples: [], emaRx: 0, emaTx: 0, lastTs: 0 };
    byProxy.set(proxyId, s);
  }
  return s;
}

function prune(s: State, now: number): void {
  while (s.samples.length && s.samples[0].ts < now - WINDOW_MS) s.samples.shift();
}

/** Record one completed proxy request — returns instant + EMA bps. */
export function recordProxyTraffic(
  proxyId: number,
  rxBytes: bigint | number,
  txBytes: bigint | number,
  durationMs: number,
): { rxBps: number; txBps: number } {
  const now = Date.now();
  const dur = Math.max(200, durationMs || 1000);
  const rxBps = Math.round(Number(rxBytes) * 1000 / dur);
  const txBps = Math.round(Number(txBytes) * 1000 / dur);
  const s = stateFor(proxyId);

  s.samples.push({ ts: now, rxBps, txBps });
  prune(s, now);

  s.emaRx = s.emaRx > 0
    ? Math.round(s.emaRx * (1 - EMA_ALPHA) + rxBps * EMA_ALPHA)
    : rxBps;
  s.emaTx = s.emaTx > 0
    ? Math.round(s.emaTx * (1 - EMA_ALPHA) + txBps * EMA_ALPHA)
    : txBps;
  s.lastTs = now;

  const peakRx = Math.max(rxBps, ...s.samples.map(x => x.rxBps));
  const peakTx = Math.max(txBps, ...s.samples.map(x => x.txBps));
  return {
    rxBps: Math.max(s.emaRx, peakRx),
    txBps: Math.max(s.emaTx, peakTx),
  };
}

/** Current live bps for one proxy (decays to 0 when idle). */
export function getLiveBps(proxyId: number): { rxBps: number; txBps: number } {
  const s = byProxy.get(proxyId);
  if (!s) return { rxBps: 0, txBps: 0 };
  const now = Date.now();
  prune(s, now);
  if (!s.samples.length) return { rxBps: 0, txBps: 0 };

  const ageMs = now - s.lastTs;
  if (ageMs > WINDOW_MS) return { rxBps: 0, txBps: 0 };

  const decay = Math.max(0.15, 1 - ageMs / WINDOW_MS);
  const peakRx = Math.max(...s.samples.map(x => x.rxBps));
  const peakTx = Math.max(...s.samples.map(x => x.txBps));
  return {
    rxBps: Math.round(Math.max(s.emaRx, peakRx) * decay),
    txBps: Math.round(Math.max(s.emaTx, peakTx) * decay),
  };
}

export function getLiveBpsBatch(proxyIds: number[]): Map<number, { rxBps: number; txBps: number }> {
  const out = new Map<number, { rxBps: number; txBps: number }>();
  for (const id of proxyIds) out.set(id, getLiveBps(id));
  return out;
}