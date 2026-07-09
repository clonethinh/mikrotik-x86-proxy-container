import type { LiveMetrics } from '../types/proxies';

const STALE_MS = 25_000;

/** Merge partial WS/API metrics without zeroing active traffic spikes. */
export function mergeLiveMetrics(
  cur: LiveMetrics | undefined,
  patch: Partial<LiveMetrics>,
): LiveMetrics {
  const now = Date.now();
  const curAt = cur?.sampledAt ? Date.parse(cur.sampledAt) : 0;
  const patchAt = patch.sampledAt ? Date.parse(patch.sampledAt) : now;
  const curFresh = curAt > 0 && now - curAt < STALE_MS;
  const patchFresh = patchAt > 0 && now - patchAt < STALE_MS;

  const patchRx = patch.rxBps ?? 0;
  const patchTx = patch.txBps ?? 0;
  const curRx = cur?.rxBps ?? 0;
  const curTx = cur?.txBps ?? 0;

  let rxBps: number;
  let txBps: number;
  if (patch.source === 'interface' && patchFresh) {
    rxBps = patchRx;
    txBps = patchTx;
  } else if (patchRx > 0 || patchTx > 0) {
    rxBps = Math.max(patchRx, curFresh ? curRx : 0);
    txBps = Math.max(patchTx, curFresh ? curTx : 0);
  } else if (curFresh && (curRx > 0 || curTx > 0)) {
    rxBps = curRx;
    txBps = curTx;
  } else if (patchFresh) {
    rxBps = patchRx;
    txBps = patchTx;
  } else {
    rxBps = Math.max(patchRx, curRx);
    txBps = Math.max(patchTx, curTx);
  }

  let clients: number;
  if (patch.clients !== undefined) {
    if (patch.clients > 0) {
      clients = Math.max(patch.clients, cur?.clients ?? 0);
    } else if (curFresh && (cur?.clients ?? 0) > 0) {
      clients = cur!.clients;
    } else {
      clients = 0;
    }
  } else {
    clients = cur?.clients ?? 0;
  }

  let usedBytes = patch.usedBytes ?? cur?.usedBytes;
  if (patch.rxBytes || patch.txBytes) {
    const add = BigInt(patch.rxBytes || '0') + BigInt(patch.txBytes || '0');
    if (add > 0n) {
      usedBytes = (BigInt(cur?.usedBytes || '0') + add).toString();
    }
  }

  return {
    clients,
    rxBps,
    txBps,
    rxBytes: patch.rxBytes ?? cur?.rxBytes ?? '0',
    txBytes: patch.txBytes ?? cur?.txBytes ?? '0',
    usedBytes,
    quotaPct: patch.quotaPct !== undefined ? patch.quotaPct : (cur?.quotaPct ?? null),
    source: patch.source ?? cur?.source ?? 'logs',
    sampledAt: patch.sampledAt ?? cur?.sampledAt ?? new Date().toISOString(),
  };
}