import type { ProxyUser, WanInfo } from '../services/api';

const STALE_MS = 30 * 60_000;

export function effectiveLatencyMs(proxy: ProxyUser, wan?: WanInfo | null): number | null {
  const wanMs = wan?.lastLatencyMs;
  const proxyMs = proxy.lastLatencyMs;
  if (wanMs != null && proxyMs != null) return Math.min(wanMs, proxyMs);
  return wanMs ?? proxyMs ?? null;
}

export function isLatencyStale(proxy: ProxyUser): boolean {
  if (!proxy.lastCheckAt) return true;
  return Date.now() - Date.parse(proxy.lastCheckAt) > STALE_MS;
}