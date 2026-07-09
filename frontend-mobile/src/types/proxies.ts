export interface TrafficHistoryPoint {
  ts: string;
  rxBps: number;
  txBps: number;
  clients?: number;
}

export interface LiveMetrics {
  clients: number;
  rxBps: number;
  txBps: number;
  rxBytes: string;
  txBytes: string;
  usedBytes?: string;
  quotaPct: number | null;
  sampledAt?: string;
  source?: 'admin' | 'logs' | 'interface';
}

export interface ProxyRequestLogRow {
  id: number;
  ts: string;
  clientIp: string;
  destHost: string | null;
  destPort: number | null;
  rxBytes: string;
  txBytes: string;
  errorCode: number;
  durationMs: number | null;
  service: string | null;
}

export interface ProxyDomainStatRow {
  domain: string;
  hits: number;
  rxBytes: string;
  txBytes: string;
  totalBytes: string;
}

export interface ProxyLimitConfig {
  enabled: boolean;
  quotaDailyMb?: number | null;
  quotaWeeklyMb?: number | null;
  quotaMonthlyMb?: number | null;
  speedDownKbps?: number | null;
  speedUpKbps?: number | null;
  maxConnections?: number | null;
  allowedHours?: { weekdays?: string; periods?: string[] } | null;
  expiresAt?: string | null;
}

export type AnalyticsTab = 'overview' | 'limits' | 'logs';
export type HistoryPeriod = 'hour' | 'day' | 'week' | 'month';

export interface ProxyStats {
  total: number;
  running: number;
  stopped: number;
  error: number;
}

export const PROXY_LIST_RELOAD = new Set([
  'proxy.created', 'proxy.updated', 'proxy.deleted',
  'proxy.status', 'proxy.applied', 'proxy.reloading',
]);

