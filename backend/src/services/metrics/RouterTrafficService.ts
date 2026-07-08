import { config } from '../../lib/config';
import { formatBytesShort } from '../../lib/mikrotikResourceUtils';
import { logger } from '../../lib/logger';
import { getMikrotikService } from '../mikrotik/MikrotikService';

const POLL_MS = parseInt(process.env.ROUTER_TRAFFIC_POLL_MS || '5000', 10);
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
  for (const c of counters) {
    rxTotal += c.rxBytes;
    txTotal += c.txBytes;
    if (c.running) wanUp++;
  }

  const now = Date.now();
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