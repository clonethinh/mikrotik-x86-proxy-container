import { config } from '../../lib/config';
import { isValidLanIpv4 } from '../../lib/lanTrafficUtils';
import { formatBytesShort } from '../../lib/mikrotikResourceUtils';
import { logger } from '../../lib/logger';
import { getMikrotikService } from '../mikrotik/MikrotikService';

const POLL_MS = parseInt(process.env.LAN_TRAFFIC_POLL_MS || '5000', 10);
const SYNC_MS = parseInt(process.env.LAN_TRAFFIC_SYNC_MS || '60000', 10);
const EMA_ALPHA = 0.45;

export interface LanDeviceTrafficFields {
  rxBytes: string;
  txBytes: string;
  rxLabel: string;
  txLabel: string;
  rxBps: number;
  txBps: number;
  trafficLive: boolean;
}

interface IpTrafficState {
  rxBytes: bigint;
  txBytes: bigint;
  rxBps: number;
  txBps: number;
  emaRx: number;
  emaTx: number;
  lastAt: number;
}

const stateByIp = new Map<string, IpTrafficState>();
const prevCounters = new Map<string, { rx: bigint; tx: bigint; at: number }>();
let pollTimer: ReturnType<typeof setInterval> | null = null;
let lastSyncAt = 0;

function emptyTraffic(): LanDeviceTrafficFields {
  return {
    rxBytes: '0',
    txBytes: '0',
    rxLabel: '—',
    txLabel: '—',
    rxBps: 0,
    txBps: 0,
    trafficLive: false,
  };
}

function computeBps(delta: bigint, dtSec: number): number {
  if (dtSec <= 0 || delta <= 0n) return 0;
  return Math.round(Number(delta) / dtSec);
}

export function getLanTrafficForIp(ip: string): LanDeviceTrafficFields {
  const st = stateByIp.get(ip);
  if (!st) return emptyTraffic();

  const ageMs = Date.now() - st.lastAt;
  const live = ageMs < POLL_MS * 3;
  const decay = live ? 1 : Math.max(0, 1 - (ageMs - POLL_MS * 3) / (POLL_MS * 12));

  return {
    rxBytes: st.rxBytes.toString(),
    txBytes: st.txBytes.toString(),
    rxLabel: formatBytesShort(Number(st.rxBytes)),
    txLabel: formatBytesShort(Number(st.txBytes)),
    rxBps: live ? Math.round(st.rxBps * decay) : 0,
    txBps: live ? Math.round(st.txBps * decay) : 0,
    trafficLive: live,
  };
}

export async function syncLanTrafficRulesOnce(): Promise<void> {
  const mik = getMikrotikService();
  const leases = await mik.getDhcpLeases().catch(() => []);
  const ips = leases
    .filter(l => l.status === 'bound' && isValidLanIpv4(l.address))
    .map(l => l.address);
  await mik.syncLanStatsMangleRules(ips);
  lastSyncAt = Date.now();
}

export async function sampleLanTrafficOnce(): Promise<void> {
  const mik = getMikrotikService();
  const counters = await mik.getLanMangleTrafficCounters().catch(() => new Map());
  const now = Date.now();

  for (const [ip, c] of counters) {
    const prev = prevCounters.get(ip);
    let rxBps = 0;
    let txBps = 0;

    if (prev) {
      const dtSec = (now - prev.at) / 1000;
      if (dtSec >= 0.8) {
        let rxDelta = c.rxBytes - prev.rx;
        let txDelta = c.txBytes - prev.tx;
        if (rxDelta < 0n) rxDelta = 0n;
        if (txDelta < 0n) txDelta = 0n;
        rxBps = computeBps(rxDelta, dtSec);
        txBps = computeBps(txDelta, dtSec);
      }
    }

    prevCounters.set(ip, { rx: c.rxBytes, tx: c.txBytes, at: now });

    const old = stateByIp.get(ip);
    const emaRx = old?.emaRx
      ? Math.round(old.emaRx * (1 - EMA_ALPHA) + rxBps * EMA_ALPHA)
      : rxBps;
    const emaTx = old?.emaTx
      ? Math.round(old.emaTx * (1 - EMA_ALPHA) + txBps * EMA_ALPHA)
      : txBps;

    stateByIp.set(ip, {
      rxBytes: c.rxBytes,
      txBytes: c.txBytes,
      rxBps: emaRx,
      txBps: emaTx,
      emaRx,
      emaTx,
      lastAt: now,
    });
  }

  // Drop stale IPs no longer in counters (lease expired)
  for (const ip of stateByIp.keys()) {
    if (!counters.has(ip)) {
      stateByIp.delete(ip);
      prevCounters.delete(ip);
    }
  }
}

async function pollTick(): Promise<void> {
  try {
    if (Date.now() - lastSyncAt >= SYNC_MS) {
      await syncLanTrafficRulesOnce();
    }
    await sampleLanTrafficOnce();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn({ err: msg.slice(0, 120) }, 'LanDeviceTrafficCollector tick failed');
  }
}

export function startLanDeviceTrafficCollector(): void {
  if (pollTimer) return;
  if (config.deployTarget !== 'router') {
    logger.info('LanDeviceTrafficCollector skipped (deployTarget !== router)');
    return;
  }
  pollTimer = setInterval(() => { void pollTick(); }, POLL_MS);
  void pollTick();
  logger.info({ pollMs: POLL_MS, syncMs: SYNC_MS }, 'LanDeviceTrafficCollector started');
}

export function stopLanDeviceTrafficCollector(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}