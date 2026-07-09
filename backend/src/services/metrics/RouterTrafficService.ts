import { config } from '../../lib/config';
import { formatBytesShort } from '../../lib/mikrotikResourceUtils';
import { logger } from '../../lib/logger';
import { getMikrotikService } from '../mikrotik/MikrotikService';

const POLL_MS = parseInt(
  process.env.ROUTER_TRAFFIC_POLL_MS
    || (process.env.LOW_CPU_MODE === 'true' && process.env.METRICS_PPPOE_IFACE !== 'false' ? '3000' : '5000'),
  10,
);
const HISTORY_MAX = parseInt(process.env.ROUTER_TRAFFIC_HISTORY_MAX || '360', 10);
const EMA_ALPHA = 0.45;

export interface WanTrafficHistoryPoint {
  ts: string;
  rxBps: number;
  txBps: number;
}

export interface WanTrafficSnapshot {
  rxBytes: string;
  txBytes: string;
  rxLabel: string;
  txLabel: string;
  rxBps: number;
  txBps: number;
  wanUp: number;
  wanTotal: number;
  sampleAgeMs: number;
  live: boolean;
  history: WanTrafficHistoryPoint[];
}

interface IfaceTrafficState {
  rxBytes: bigint;
  txBytes: bigint;
  rxBps: number;
  txBps: number;
  emaRx: number;
  emaTx: number;
  lastAt: number;
}

interface TrafficState {
  rxBytes: bigint;
  txBytes: bigint;
  rxBps: number;
  txBps: number;
  emaRx: number;
  emaTx: number;
  wanUp: number;
  wanTotal: number;
  lastAt: number;
  history: WanTrafficHistoryPoint[];
}

let state: TrafficState | null = null;
let prevCounters: { rx: bigint; tx: bigint; at: number } | null = null;
const sampleHooks: Array<() => void | Promise<void>> = [];
const prevByIface = new Map<string, { rx: bigint; tx: bigint; at: number }>();
const ifaceState = new Map<string, IfaceTrafficState>();
let timer: ReturnType<typeof setInterval> | null = null;

function emptySnapshot(): WanTrafficSnapshot {
  return {
    rxBytes: '0',
    txBytes: '0',
    rxLabel: '—',
    txLabel: '—',
    rxBps: 0,
    txBps: 0,
    wanUp: 0,
    wanTotal: 0,
    sampleAgeMs: 0,
    live: false,
    history: [],
  };
}

function computeBps(delta: bigint, dtSec: number): number {
  if (dtSec <= 0 || delta <= 0n) return 0;
  return Math.round(Number(delta) / dtSec);
}

export async function sampleWanTrafficOnce(): Promise<void> {
  const mik = getMikrotikService();
  const counters = await mik.getPppoeTrafficCounters().catch(() => []);

  let rxTotal = 0n;
  let txTotal = 0n;
  let wanUp = 0;
  const now = Date.now();
  for (const c of counters) {
    rxTotal += c.rxBytes;
    txTotal += c.txBytes;
    if (c.running) wanUp++;

    const prevIf = prevByIface.get(c.name);
    let ifRxBps = 0;
    let ifTxBps = 0;
    if (prevIf) {
      const dtSec = (now - prevIf.at) / 1000;
      if (dtSec >= 0.8) {
        let rxDelta = c.rxBytes - prevIf.rx;
        let txDelta = c.txBytes - prevIf.tx;
        if (rxDelta < 0n) rxDelta = 0n;
        if (txDelta < 0n) txDelta = 0n;
        ifRxBps = computeBps(rxDelta, dtSec);
        ifTxBps = computeBps(txDelta, dtSec);
      }
    }
    prevByIface.set(c.name, { rx: c.rxBytes, tx: c.txBytes, at: now });

    const prevSt = ifaceState.get(c.name);
    const emaRx = prevSt?.emaRx
      ? Math.round(prevSt.emaRx * (1 - EMA_ALPHA) + ifRxBps * EMA_ALPHA)
      : ifRxBps;
    const emaTx = prevSt?.emaTx
      ? Math.round(prevSt.emaTx * (1 - EMA_ALPHA) + ifTxBps * EMA_ALPHA)
      : ifTxBps;
    ifaceState.set(c.name, {
      rxBytes: c.rxBytes,
      txBytes: c.txBytes,
      rxBps: emaRx,
      txBps: emaTx,
      emaRx,
      emaTx,
      lastAt: now,
    });
  }
  let rxBps = 0;
  let txBps = 0;

  if (prevCounters) {
    const dtSec = (now - prevCounters.at) / 1000;
    if (dtSec >= 0.8) {
      let rxDelta = rxTotal - prevCounters.rx;
      let txDelta = txTotal - prevCounters.tx;
      if (rxDelta < 0n) rxDelta = 0n;
      if (txDelta < 0n) txDelta = 0n;
      rxBps = computeBps(rxDelta, dtSec);
      txBps = computeBps(txDelta, dtSec);
    }
  }

  prevCounters = { rx: rxTotal, tx: txTotal, at: now };

  const emaRx = state?.emaRx
    ? Math.round(state.emaRx * (1 - EMA_ALPHA) + rxBps * EMA_ALPHA)
    : rxBps;
  const emaTx = state?.emaTx
    ? Math.round(state.emaTx * (1 - EMA_ALPHA) + txBps * EMA_ALPHA)
    : txBps;

  const point: WanTrafficHistoryPoint = {
    ts: new Date(now).toISOString(),
    rxBps: emaRx,
    txBps: emaTx,
  };

  const history = [...(state?.history ?? []), point];
  while (history.length > HISTORY_MAX) history.shift();

  state = {
    rxBytes: rxTotal,
    txBytes: txTotal,
    rxBps: emaRx,
    txBps: emaTx,
    emaRx,
    emaTx,
    wanUp,
    wanTotal: counters.length,
    lastAt: now,
    history,
  };
}

/** Gọi ngay sau mỗi lần đọc counter MikroTik — đẩy WS proxy.metrics đồng bộ. */
export function registerTrafficSampleHook(fn: () => void | Promise<void>): void {
  sampleHooks.push(fn);
}

export function isRouterTrafficSampleLive(): boolean {
  if (!state) return false;
  return Date.now() - state.lastAt < POLL_MS * 2;
}

/** Live bps trên interface PPPoE cụ thể (pppoe-outN) — khớp counter MikroTik. */
export function getPppoeIfaceBps(pppoeIdx: number): { rxBps: number; txBps: number; live: boolean } {
  const name = `pppoe-out${pppoeIdx}`;
  const st = ifaceState.get(name);
  if (!st) return { rxBps: 0, txBps: 0, live: false };

  const ageMs = Date.now() - st.lastAt;
  const live = ageMs < POLL_MS * 3;
  const decay = live ? 1 : Math.max(0, 1 - (ageMs - POLL_MS * 3) / (POLL_MS * 12));
  return {
    rxBps: live ? Math.round(st.rxBps * decay) : 0,
    txBps: live ? Math.round(st.txBps * decay) : 0,
    live,
  };
}

export function getWanTrafficSnapshot(): WanTrafficSnapshot {
  if (!state) return emptySnapshot();

  const ageMs = Date.now() - state.lastAt;
  const live = ageMs < POLL_MS * 3;
  const decay = live ? 1 : Math.max(0, 1 - (ageMs - POLL_MS * 3) / (POLL_MS * 12));

  return {
    rxBytes: state.rxBytes.toString(),
    txBytes: state.txBytes.toString(),
    rxLabel: formatBytesShort(Number(state.rxBytes)),
    txLabel: formatBytesShort(Number(state.txBytes)),
    rxBps: live ? Math.round(state.rxBps * decay) : 0,
    txBps: live ? Math.round(state.txBps * decay) : 0,
    wanUp: state.wanUp,
    wanTotal: state.wanTotal,
    sampleAgeMs: ageMs,
    live,
    history: state.history,
  };
}

async function tick(): Promise<void> {
  try {
    await sampleWanTrafficOnce();
    await Promise.all(sampleHooks.map((h) => Promise.resolve(h())));
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn({ err: msg.slice(0, 120) }, 'RouterTrafficCollector tick failed');
  }
}

export function startRouterTrafficCollector(): void {
  if (timer) return;
  if (config.deployTarget !== 'router') {
    logger.info('RouterTrafficCollector skipped (deployTarget !== router)');
    return;
  }
  timer = setInterval(() => { void tick(); }, POLL_MS);
  void tick();
  logger.info({ pollMs: POLL_MS, historyMax: HISTORY_MAX }, 'RouterTrafficCollector started');
}

export function stopRouterTrafficCollector(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}