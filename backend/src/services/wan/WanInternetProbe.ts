// Ping nhẹ qua PPPoE khi có IP — xác nhận internet trước finalize proxy
import { config } from '../../lib/config';
import { getMikrotikService } from '../mikrotik/MikrotikService';
import { logger } from '../../lib/logger';

export interface WanProbeResult {
  ok: boolean;
  received: number;
  avgRttMs: number | null;
  cached: boolean;
  skipped: boolean;
}

/** IP đã ping OK gần đây — tránh ping lặp */
const okIpByIface = new Map<string, string>();
const lastAttemptAt = new Map<string, number>();

export function clearWanProbeCache(pppoeName: string): void {
  okIpByIface.delete(pppoeName);
  lastAttemptAt.delete(pppoeName);
}

/**
 * Ping qua interface WAN khi có IP hợp lệ.
 * Cooldown giữa các lần fail — giảm CPU khi ISP chưa route.
 */
export async function probeWanInternet(
  pppoeName: string,
  publicIp: string,
): Promise<WanProbeResult> {
  if (!config.wan.pingEnabled) {
    return { ok: true, received: 0, avgRttMs: null, cached: false, skipped: true };
  }

  if (okIpByIface.get(pppoeName) === publicIp) {
    return { ok: true, received: config.wan.pingCount, avgRttMs: null, cached: true, skipped: false };
  }

  const last = lastAttemptAt.get(pppoeName) || 0;
  if (Date.now() - last < config.wan.pingRetryMs) {
    return { ok: false, received: 0, avgRttMs: null, cached: false, skipped: true };
  }

  lastAttemptAt.set(pppoeName, Date.now());
  const mik = getMikrotikService();
  const result = await mik.pingViaInterface(
    pppoeName,
    config.wan.pingTarget,
    config.wan.pingCount,
  );

  if (result.ok) {
    okIpByIface.set(pppoeName, publicIp);
    logger.info({ pppoeName, publicIp, rttMs: result.avgRttMs, received: result.received }, 'WAN internet OK');
  } else {
    logger.info({ pppoeName, publicIp, received: result.received }, 'WAN internet pending (ping fail)');
  }

  return { ok: result.ok, received: result.received, avgRttMs: result.avgRttMs, cached: false, skipped: false };
}