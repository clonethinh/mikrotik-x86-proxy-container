// API client
import { isUiPreview } from '../lib/env';
import { previewHttp } from '../mocks/previewApi';

const TOKEN_KEY = 'wp_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(t: string | null) {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

async function http<T>(method: string, path: string, body?: any): Promise<T> {
  if (isUiPreview) {
    return previewHttp<T>(method, path, body);
  }
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  let payload: string | undefined;
  if (body !== undefined && body !== null) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(path, {
    method, headers,
    body: payload,
  });
  if (res.status === 401) {
    setToken(null);
    if (!path.includes('/auth/login')) {
      window.location.href = '/login';
      throw new Error('Unauthorized');
    }
  }
  if (!res.ok) {
    const txt = await res.text();
    let err: any;
    try { err = JSON.parse(txt); } catch { err = { error: txt }; }
    throw new Error(err.error || err.message || `HTTP ${res.status}`);
  }
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return res.text() as any;
}

export interface ExportClipboardResult {
  text: string;
  count: number;
}

async function authHeaders(json = false): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

function parseFilename(cd: string | null, fallback: string): string {
  const m = cd?.match(/filename="([^"]+)"/);
  return m?.[1] || fallback;
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export const api = {
  get: <T = any>(p: string) => http<T>('GET', p),
  post: <T = any>(p: string, b?: any) => http<T>('POST', p, b),
  patch: <T = any>(p: string, b?: any) => http<T>('PATCH', p, b),
  del: <T = any>(p: string) => http<T>('DELETE', p),
  /** Export: clipboard JSON or trigger file download when fileFormat is set */
  async postExport(body: Record<string, unknown>): Promise<ExportClipboardResult | { downloaded: true; filename: string }> {
    if (isUiPreview) {
      return {
        text: 'http://113.22.235.51:30056:user1:preview-pass\nhttp://113.22.235.52:30057:user2:preview-pass',
        count: 2,
      };
    }
    const res = await fetch('/api/proxies/export', {
      method: 'POST',
      headers: await authHeaders(true),
      body: JSON.stringify(body),
    });
    if (res.status === 401) {
      setToken(null);
      window.location.href = '/login';
      throw new Error('Unauthorized');
    }
    if (!res.ok) {
      const txt = await res.text();
      let err: { error?: string; message?: string };
      try { err = JSON.parse(txt); } catch { err = { error: txt }; }
      throw new Error(err.error || err.message || `HTTP ${res.status}`);
    }
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      return res.json() as Promise<ExportClipboardResult>;
    }
    const blob = await res.blob();
    const ext = String(body.fileFormat || 'txt');
    const filename = parseFilename(res.headers.get('content-disposition'), `proxies-${Date.now()}.${ext}`);
    triggerDownload(blob, filename);
    return { downloaded: true, filename };
  },
};

export interface ProxyUser {
  id: number;
  pppoeIdx: number;
  pppoeName: string;
  egressPppoeName?: string | null;
  vethName: string;
  vethIp: string;
  proxyType: 'http' | 'socks5' | 'both';
  httpPort: number;
  socksPort?: number;
  extHttpPort: number;
  extSocksPort?: number;
  containerName: string;
  username: string;
  password?: string;
  enabled: boolean;
  status: 'pending' | 'running' | 'stopped' | 'error';
  publicIp: string | null;
  lastCheckAt: string | null;
  lastLatencyMs: number | null;
  createdAt: string;
  updatedAt: string;
  ipHistory?: any[];
  healthChecks?: any[];
  ipQuality?: 'public' | 'cgnat' | 'link_local' | 'private' | 'missing' | 'invalid';
  ipQualityLabel?: string;
  ipUsable?: boolean;
  ipQualityHint?: string;
}

export interface WanInfo {
  name: string;
  index: number;
  disabled: boolean;
  running: boolean;
  uptime: string;
  publicIp: string | null;
  user: string;
  extHttpPort?: number;
  extSocksPort?: number;
  containerName?: string | null;
  hasContainer?: boolean;
  containerStatus?: string | null;
  hasProxy?: boolean;
  proxyId?: number | null;
  proxyStatus?: string | null;
  proxyEnabled?: boolean;
  username?: string | null;
  proxyType?: string | null;
  lastLatencyMs?: number | null;
  lastCheckAt?: string | null;
  vethName?: string;
  egressPppoeName?: string | null;
  hubSlot?: number | null;
  containerIp?: string | null;
  workflowState?: string | null;
  countdownEnds?: string | null;
  discoveryError?: string | null;
  comment?: string;
  quayipStatus?: 'protected' | 'ok' | 'dead' | 'disabled' | 'rotating' | 'unknown';
  quayipLabel?: string;
  ipQuality?: 'public' | 'cgnat' | 'link_local' | 'private' | 'missing' | 'invalid';
  ipQualityLabel?: string;
  ipUsable?: boolean;
  ipQualityHint?: string;
}

export interface RouterScriptStatus {
  name: string;
  label: string;
  description: string;
  installed: boolean;
  runCount: number;
  lastStarted: string | null;
  scheduler: {
    name: string;
    interval: string | null;
    nextRun: string | null;
    disabled: boolean;
  } | null;
}

export interface FirewallReconcileStatus {
  enabled: boolean;
  intervalMs: number;
  maxSlotsPerPass: number;
  running: boolean;
  repairOffset: number;
  lastError: string | null;
  lastResult: FirewallReconcileResult | null;
}

export interface FirewallReconcileResult {
  dryRun: boolean;
  repair: boolean;
  durationMs: number;
  at: string;
  removed: { filter: number; nat: number; mangle: number; addressList: number };
  repaired: { attempted: number; ok: number; failed: number };
  audit: {
    totals: { filter: number; nat: number; mangle: number };
    hubRules: { filter: number; nat: number; mangle: number };
    duplicates: { chain: string; comment: string; count: number }[];
    orphans: { chain: string; comment: string; slot: number }[];
    missing: { pppoeIdx: number; egress: string; comments: string[] }[];
    staleHubWan: { pppoe: string; address: string; id: string }[];
  };
}

export interface AutoProxySettings {
  mode: 'off' | 'semi' | 'full';
  pollIntervalMs: number;
  countdownMs: number;
  ipWaitTimeoutMs: number;
  maxConcurrent: number;
  warnConcurrent: number;
  staleTtlMs: number;
  goneDebouncePolls: number;
}

export interface WanDiscovery {
  id: number;
  pppoeName: string;
  pppoeIdx: number;
  workflowState: string;
  publicIp: string | null;
  discoveredAt: string;
  lastSeenAt: string;
  goneAt: string | null;
  staleAt: string | null;
  countdownEnds: string | null;
  proxyId: number | null;
  error: string | null;
}

export interface RouterMonitorHistoryPoint {
  ts: string;
  cpuLoadPct: number | null;
  memoryUsedPct: number | null;
  hddUsedPct: number | null;
  containerRunning: number;
}

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

export interface RouterMonitorSnapshot {
  live?: boolean;
  sampleAgeMs?: number;
  cpuLoadPct: number | null;
  memoryUsedPct: number | null;
  hddUsedPct: number | null;
  freeMemoryBytes: number | null;
  totalMemoryBytes: number | null;
  freeMemoryLabel: string;
  totalMemoryLabel: string;
  freeHddBytes: number | null;
  totalHddBytes: number | null;
  freeHddLabel: string;
  totalHddLabel: string;
  uptimeSec: number | null;
  uptimeLabel: string;
  cpu: string | null;
  cpuCount: number | null;
  cpuFrequencyMhz: number | null;
  boardName: string | null;
  architecture: string | null;
  version: string | null;
  containerTotal: number;
  containerRunning: number;
  history: RouterMonitorHistoryPoint[];
}

export interface DashboardData {
  totalProxies: number;
  runningProxies: number;
  stoppedProxies: number;
  errorProxies: number;
  totalWan: number;
  wanUp: number;
  wanDown: number;
  realtimeClients: number;
  live?: boolean;
  source?: 'mikrotik';
  mikrotik: {
    host: string;
    wanHost?: string | null;
    managementUrl?: string | null;
    version?: string | null;
    cpuLoad?: string | null;
    freeMemory?: string | null;
    cpu?: string | null;
    cpuCount?: number | null;
    uptime?: string | null;
    boardName?: string | null;
    architecture?: string | null;
  };
  routerMonitor?: RouterMonitorSnapshot | null;
  wanTraffic?: WanTrafficSnapshot | null;
  containerProxies?: number;
  containerHealthy?: number;
  webuiRunning?: boolean;
  dhcpLeases?: DhcpLease[];
  deviceRoutes?: DeviceRoute[];
  timestamp: number;
}

export interface DeviceRoute {
  id: number;
  name: string;
  matchType: 'ip' | 'mac' | 'dhcp';
  ipAddress: string | null;
  macAddress: string | null;
  dhcpHostName: string | null;
  pppoeIdx: number;
  pppoeName: string;
  enabled: boolean;
  applied: boolean;
  statusMessage: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DhcpLease {
  id: string;
  address: string;
  macAddress: string;
  hostName: string;
  status: string;
  server: string;
  /** Download bytes (to device) — cumulative MikroTik mangle counter */
  rxBytes?: string;
  /** Upload bytes (from device) */
  txBytes?: string;
  rxLabel?: string;
  txLabel?: string;
  rxBps?: number;
  txBps?: number;
  trafficLive?: boolean;
}

export interface AuditItem {
  id: number;
  username: string;
  action: string;
  resource: string | null;
  resourceId: number | null;
  details: string | null;
  ip: string | null;
  proxyId: number | null;
  createdAt: string;
}
export interface AuditResponse {
  items: AuditItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface MikrotikTestResult {
  rest: boolean;
  ssh: boolean;
  restLatencyMs?: number;
  sshLatencyMs?: number;
  restError?: string;
  sshError?: string;
}

export interface ClockSyncResult {
  ok: boolean;
  source: string;
  syncedAt: string;
  timezone?: string;
  router?: { date: string; time: string };
  containers: string[];
  ntpEnabled: boolean;
  skipped?: boolean;
  error?: string;
}