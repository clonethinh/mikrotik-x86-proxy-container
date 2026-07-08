import type { ProxyUser, WanInfo } from '../services/api';

export const HTTP_PORT_BASE = 30055;
export const SOCKS_PORT_BASE = 31055;

export function extHttpPort(pppoeIdx: number): number {
  return HTTP_PORT_BASE + pppoeIdx;
}

export function extSocksPort(pppoeIdx: number): number {
  return SOCKS_PORT_BASE + pppoeIdx;
}

export function connectIp(row: { publicIp?: string | null }): string {
  return row.publicIp || '—';
}

export type ProxyFormat =
  | 'ipportuserpass'
  | 'userpassipport'
  | 'httpurl'
  | 'socks5url'
  | 'ipport';

export interface ProxyEndpointRow {
  publicIp?: string | null;
  pppoeIdx?: number;
  index?: number;
  username?: string | null;
  password?: string;
  extHttpPort?: number;
  extSocksPort?: number;
  proxyType?: string | null;
}

function resolveIdx(row: ProxyEndpointRow): number {
  return row.pppoeIdx ?? row.index ?? 0;
}

export function formatProxy(
  row: ProxyEndpointRow,
  kind: 'http' | 'socks5',
  format: ProxyFormat = 'httpurl',
): string {
  const ip = row.publicIp;
  if (!ip) return '';
  const idx = resolveIdx(row);
  const port = kind === 'http'
    ? (row.extHttpPort ?? extHttpPort(idx))
    : (row.extSocksPort ?? extSocksPort(idx));
  const user = row.username || '';
  const pass = row.password || '';
  const scheme = kind === 'http' ? 'http' : 'socks5';

  switch (format) {
    case 'ipportuserpass':
      return `${ip}:${port}:${user}:${pass}`;
    case 'userpassipport':
      return `${user}:${pass}@${ip}:${port}`;
    case 'ipport':
      return `${ip}:${port}`;
    case 'httpurl':
    case 'socks5url':
    default:
      return user ? `${scheme}://${user}:${pass}@${ip}:${port}` : `${scheme}://${ip}:${port}`;
  }
}

export function containerStatusColor(status: string | null | undefined): string {
  if (!status) return 'default';
  const s = status.toLowerCase();
  if (s === 'running' || s === 'r' || s === 'healthy' || s === 'h' || s.includes('good')) return 'success';
  if (s === 'stopped' || s === 's') return 'default';
  if (s.includes('error') || s === 'e' || s === 'u') return 'error';
  return 'processing';
}

export function containerStatusLabel(status: string | null | undefined): string {
  if (!status) return '—';
  const s = status.toLowerCase();
  if (s.includes('good') || s === 'h' || s === 'healthy') return 'Healthy';
  if (s === 'running' || s === 'r') return 'Running';
  if (s === 'stopped' || s === 's') return 'Stopped';
  return status;
}