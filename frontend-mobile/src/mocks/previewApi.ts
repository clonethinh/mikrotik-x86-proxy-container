import {
  mockAudit,
  mockAutoProxy,
  mockDashboard,
  mockDeployInfo,
  mockDevices,
  mockDhcpLeases,
  mockDomainStats,
  mockProxies,
  mockRequestLogs,
  mockRouterScripts,
  mockWans,
  PREVIEW_USER,
} from './previewData';

function ok<T>(data: T): T {
  return data;
}

function pathNum(path: string, seg: string): number | null {
  const m = path.match(new RegExp(`/${seg}/(\\d+)`));
  return m ? parseInt(m[1], 10) : null;
}

function historyPoints(period: string) {
  const len = period === 'hour' ? 24 : period === 'day' ? 48 : period === 'week' ? 56 : 30;
  const step = period === 'hour' ? 3600000 : period === 'day' ? 1800000 : 86400000;
  const now = Date.now();
  return Array.from({ length: len }, (_, i) => ({
    ts: new Date(now - (len - 1 - i) * step).toISOString(),
    rxBps: 8000 + Math.round(Math.sin(i / 3) * 4000),
    txBps: 5000 + Math.round(Math.cos(i / 4) * 2000),
    clients: 1 + (i % 4),
  }));
}

export async function previewHttp<T>(method: string, path: string, body?: unknown): Promise<T> {
  await new Promise((r) => setTimeout(r, 60 + Math.random() * 100));

  const [basePath] = path.split('?');
  const qs = path.includes('?') ? new URLSearchParams(path.split('?')[1]) : null;

  if (basePath === '/api/health') {
    return ok({ ok: true, uptime: 86400, deployTarget: 'preview-mock', realtimeClients: 3 }) as T;
  }
  if (basePath === '/api/auth/me') return ok(PREVIEW_USER) as T;
  if (basePath === '/api/auth/login') {
    return ok({ token: 'preview-mock-token', user: PREVIEW_USER }) as T;
  }
  if (basePath === '/api/auth/logout') return ok({ ok: true }) as T;
  if (basePath === '/api/auth/change-password') return ok({ ok: true }) as T;
  if (basePath === '/api/dashboard') return ok(mockDashboard) as T;
  if (basePath === '/api/wan') return ok(mockWans) as T;
  if (basePath === '/api/wan/create-queue') return ok({ pending: 0, processing: false, current: null, queueSize: 0 }) as T;
  if (basePath === '/api/wan/create-next') {
    return ok({ accepted: true, queued: true, jobId: 'mock', position: 1, queueSize: 1 }) as T;
  }
  if (basePath === '/api/wan/bulk-enable') {
    const indices = (body as { indices?: number[] })?.indices ?? [];
    return ok({
      summary: { total: indices.length, succeeded: indices.length, failed: 0, durationMs: 3200 },
      results: indices.map((idx) => ({ pppoeIdx: idx, ok: true })),
    }) as T;
  }
  if (basePath === '/api/wan/bulk-disable') {
    const indices = (body as { indices?: number[] })?.indices ?? [];
    return ok({
      summary: { total: indices.length, succeeded: indices.length, failed: 0, durationMs: 1800 },
      results: indices.map((idx) => ({ pppoeIdx: idx, ok: true })),
    }) as T;
  }
  if (basePath === '/api/proxies') {
    if (method === 'POST') return ok({ id: 99, pppoeIdx: (body as { pppoeIdx?: number })?.pppoeIdx ?? 2 }) as T;
    return ok(mockProxies) as T;
  }
  if (basePath === '/api/proxies/bulk') {
    const ids = (body as { ids?: number[] })?.ids ?? [];
    return ok({ results: ids.map((id) => ({ id, ok: true })) }) as T;
  }
  if (basePath === '/api/proxies/import') {
    return ok({ created: 2, skipped: 0, errors: [] }) as T;
  }
  if (basePath === '/api/proxies/regenerate-credentials') {
    return ok({ ok: true, updated: mockProxies.length }) as T;
  }
  if (basePath === '/api/proxies/bulk-update-credentials') {
    return ok({ updated: (body as { ids?: number[] })?.ids?.length ?? 3, errors: [] }) as T;
  }
  if (basePath === '/api/devices') {
    if (method === 'POST') return ok({ id: 99, ...(body as object) }) as T;
    return ok(mockDevices) as T;
  }
  if (basePath === '/api/devices/dhcp-leases') return ok(mockDhcpLeases) as T;
  if (basePath === '/api/deploy-info') return ok(mockDeployInfo) as T;
  if (basePath === '/api/settings/auto-proxy') {
    return method === 'PATCH' ? ok({ ...mockAutoProxy, ...(body as object) }) as T : ok(mockAutoProxy) as T;
  }
  if (basePath === '/api/system/router-scripts') return ok({ scripts: mockRouterScripts }) as T;
  if (basePath === '/api/system/router-scripts/ensure') return ok({ ok: true, scripts: mockRouterScripts }) as T;
  if (basePath.startsWith('/api/system/router-scripts/') && basePath.endsWith('/run')) {
    return ok({ ok: true, scripts: mockRouterScripts }) as T;
  }
  if (basePath === '/api/audit') {
    const limit = parseInt(qs?.get('limit') || '50', 10);
    const offset = parseInt(qs?.get('offset') || '0', 10);
    const action = qs?.get('action');
    let items = mockAudit;
    if (action) items = items.filter((i) => i.action.includes(action));
    return ok({ items: items.slice(offset, offset + limit), total: items.length, limit, offset }) as T;
  }
  if (basePath === '/api/proxies/metrics/live-all') {
    return ok(
      mockProxies.filter((p) => p.status === 'running').map((p) => ({
        proxyId: p.id,
        clients: 2 + p.id,
        rxBps: 12000 + p.id * 1000,
        txBps: 8000 + p.id * 500,
        rxBytes: '1048576',
        txBytes: '524288',
        quotaPct: 12 + p.id,
        sampledAt: new Date().toISOString(),
        source: 'admin' as const,
      })),
    ) as T;
  }
  if (basePath === '/api/mikrotik/test') {
    return ok({ rest: true, ssh: true, restLatencyMs: 45, sshLatencyMs: 120 }) as T;
  }
  if (basePath === '/api/mikrotik/sync-time') {
    return ok({
      ok: true,
      source: 'ntp.vn',
      syncedAt: new Date().toISOString(),
      timezone: 'Asia/Ho_Chi_Minh',
      ntpEnabled: true,
      containers: ['webuiproxymikrotik', 'proxy3p-hub-1'],
    }) as T;
  }

  const proxyId = pathNum(basePath, 'proxies');
  if (proxyId != null) {
    const proxy = mockProxies.find((p) => p.id === proxyId);
    if (basePath.endsWith('/password')) return ok({ password: proxy?.password || 'preview-pass' }) as T;
    if (basePath.endsWith('/metrics/live')) {
      return ok({
        proxyId,
        clients: 3,
        rxBps: 15000,
        txBps: 9000,
        rxBytes: '2097152',
        txBytes: '1048576',
        quotaPct: 18,
        sampledAt: new Date().toISOString(),
        source: 'admin',
      }) as T;
    }
    if (basePath.endsWith('/uptime')) return ok({ uptimePct: 99.2, samples: 144 }) as T;
    if (basePath.endsWith('/limits')) {
      return (method === 'PATCH'
        ? ok({ enabled: true, quotaDailyMb: 10240, speedDownKbps: 50000, maxConnections: 100 })
        : ok({ enabled: false, quotaDailyMb: null, speedDownKbps: null, maxConnections: null })) as T;
    }
    if (basePath.includes('/metrics/history')) {
      const period = qs?.get('period') || 'hour';
      return ok(historyPoints(period)) as T;
    }
    if (basePath.includes('/logs/requests')) return ok(mockRequestLogs) as T;
    if (basePath.includes('/logs/domains')) return ok(mockDomainStats) as T;
    if (basePath.includes('/logs/tail')) {
      return ok({
        lines: [
          `[preview] proxy ${proxyId} — mock log`,
          `[preview] CONNECT 203.0.113.10 → api.telegram.org:443 OK`,
          `[preview] traffic rx=1.2MB tx=0.8MB`,
        ],
      }) as T;
    }
    if (method === 'POST' || method === 'PATCH' || method === 'DELETE') {
      return ok({ ok: true, id: proxyId }) as T;
    }
  }

  const deviceId = pathNum(basePath, 'devices');
  if (deviceId != null) {
    if (basePath.endsWith('/apply') && method === 'POST') return ok({ ok: true, id: deviceId }) as T;
    if (method === 'PATCH' || method === 'DELETE') return ok({ ok: true, id: deviceId }) as T;
  }

  const wanIdx = pathNum(basePath, 'wan');
  if (wanIdx != null || basePath.startsWith('/api/wan/')) {
    if (basePath.endsWith('/provision/cancel') && method === 'POST') {
      return ok({ ok: true, pppoeIdx: wanIdx }) as T;
    }
    if (method === 'POST') {
      return ok({ ok: true, publicIp: `113.22.235.${60 + (wanIdx || 0)}`, proxyCreated: true, accepted: true }) as T;
    }
  }

  if (method === 'POST' || method === 'PATCH') return ok({ ok: true }) as T;

  console.warn('[preview-mobile] unmocked API:', method, path);
  return ok({}) as T;
}

export function previewExport(body: Record<string, unknown>): { text: string; count: number } {
  const ids = (body.ids as number[] | undefined) ?? mockProxies.filter((p) => p.publicIp).map((p) => p.id);
  const rows = mockProxies.filter((p) => ids.includes(p.id) && p.publicIp);
  const format = String(body.format || 'ipportuserpass');
  const text = rows.map((p) => {
    if (format === 'httpurl') return `http://${p.username}:${p.password}@${p.publicIp}:${p.extHttpPort}`;
    if (format === 'socks5url') return `socks5://${p.username}:${p.password}@${p.publicIp}:${p.extSocksPort}`;
    return `${p.publicIp}:${p.extHttpPort}:${p.username}:${p.password}`;
  }).join('\n');
  return { text, count: rows.length };
}