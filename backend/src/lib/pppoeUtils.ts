// PPPoE name helpers — supports dynamic pppoe-outX from infinite pool rotation
import { maxPppoeIdx } from './networkUtils';

const PPPOE_OUT_RE = /^pppoe-out(\d+)$/;

/** Main WAN: DuckDNS, no quayip, never disable. */
export const MANAGEMENT_PPPOE = 'pppoe-wan';

/** Parse index from pppoe-outN; returns null if not a standard out interface. */
export function parsePppoeIdx(name: string): number | null {
  const m = name.match(PPPOE_OUT_RE);
  if (!m) return null;
  const idx = parseInt(m[1], 10);
  return Number.isFinite(idx) && idx >= 1 && idx <= maxPppoeIdx() ? idx : null;
}

export function isManagementPppoe(name: string): boolean {
  return name === MANAGEMENT_PPPOE;
}

/** Management path — never auto-disable, never stale-stop, excluded from quayip pool. */
export function isExcludedPppoe(name: string, _idx: number): boolean {
  return isManagementPppoe(name);
}

/** Proxy/auto-provision pool: all pppoe-outX (starts at out1). */
export function isManagedPppoeName(name: string): boolean {
  const idx = parsePppoeIdx(name);
  return idx !== null && !isExcludedPppoe(name, idx);
}

/** Alias — proxy chỉ trên pppoe-out1..X, không bao gồm pppoe-wan. */
export function isProxyPoolPppoe(name: string): boolean {
  return isManagedPppoeName(name);
}

/** Throw nếu cố gắng dùng pppoe-wan hoặc tên không thuộc pool proxy. */
export function assertProxyPoolPppoe(name: string, idx?: number): void {
  if (isManagementPppoe(name)) {
    throw new Error('pppoe-wan chỉ dùng quản trị — proxy bắt đầu từ pppoe-out1');
  }
  const parsedIdx = idx ?? parsePppoeIdx(name);
  if (parsedIdx === null || !isManagedPppoeName(name)) {
    throw new Error(`Proxy chỉ bắt đầu từ pppoe-out1 (nhận: ${name})`);
  }
}