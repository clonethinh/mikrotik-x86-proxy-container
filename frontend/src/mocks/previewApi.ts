import {
  mockAudit,
  mockAutoProxy,
  mockDashboard,
  mockDeployInfo,
  mockDevices,
  mockDhcpLeases,
  mockProxies,
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

export async function previewHttp<T>(method: string, path: string, body?: unknown): Promise<T> {
  await new Promise(r => setTimeout(r, 80 + Math.random() * 120));

  const [basePath] = path.split('?');
  const qs = path.includes('?') ? new URLSearchParams(path.split('?')[1]) : null;

  if (basePath === '/api/health') {
    return ok({ ok: true, uptime: 86400, deployTarget: 'preview-mock' }) as T;
  }
  if (basePath === '/api/auth/me') return ok(PREVIEW_USER) as T;
  if (basePath === '/api/auth/login') {
    return ok({ token: 'preview-mock-token', user: PREVIEW_USER }) as T;
  }
  if (basePath === '/api/auth/logout') return ok({ ok: true }) as T;
  if (basePath === '/api/dashboard') return ok(mockDashboard) as T;
  if (basePath === '/api/dashboard/router-monitor') return ok(mockDashboard.routerMonitor) as T;
  if (basePath === '/api/wan') return ok(mockWans) as T;
  if (basePath === '/api/proxies') return ok(mockProxies) as T;
  if (basePath === '/api/devices') return ok(mockDevices) as T;
  if (basePath === '/api/devices/dhcp-leases') return ok(mockDhcpLeases) as T;
  if (basePath === '/api/deploy-info') return ok(mockDeployInfo) as T;
  if (basePath === '/api/settings/auto-proxy') {
    return method === 'PATCH' ? ok({ ...mockAutoProxy, ...(body as object) }) as T : ok(mockAutoProxy) as T;
  }
  if (basePath === '/api/system/router-scripts') {
    return ok({ scripts: mockRouterScripts }) as T;
  }
  if (basePath === '/api/system/router-scripts/ensure') {
    return ok({ ok: true, scripts: mockRouterScripts }) as T;
  }
  if (basePath.startsWith('/api/system/router-scripts/') && basePath.endsWith('/run')) {
    return ok({ ok: true, scripts: mockRouterScripts }) as T;
  }
  if (basePath === '/api/audit') {
    const limit = parseInt(qs?.get('limit') || '50', 10);
    const offset = parseInt(qs?.get('offset') || '0', 10);
    return ok({ items: mockAudit, total: mockAudit.length, limit, offset }) as T;
  }
  if (basePath === '/api/proxies/metrics/live-all') {
    return ok(
      mockProxies.filter(p => p.status === 'running').map(p => ({
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

  const proxyId = pathNum(basePath, 'proxies');
  if (proxyId != null) {
    const proxy = mockProxies.find(p => p.id === proxyId);
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
        ? ok({ enabled: true, maxBytes: '10G', maxConnections: 100 })
        : ok({ enabled: false })) as T;
    }
    if (basePath.includes('/logs/requests')) return ok([]) as T;
    if (basePath.includes('/logs/domains')) return ok([]) as T;
    if (basePath.includes('/logs/tail')) {
      return ok({
        lines: [
          `[preview] proxy ${proxyId} — mock log line 1`,
          `[preview] CONNECT client 192.168.88.10 → 8.8.8.8:443 OK`,
          `[preview] traffic rx=1.2MB tx=0.8MB`,
        ],
      }) as T;
    }
    if (basePath.includes('/traffic/history')) {
      const now = Date.now();
      return ok(
        Array.from({ length: 24 }, (_, i) => ({
          ts: new Date(now - (23 - i) * 3600000).toISOString(),
          rxBytes: String(500000 + i * 12000),
          txBytes: String(300000 + i * 8000),
        })),
      ) as T;
    }
    if (method === 'POST' || method === 'PATCH' || method === 'DELETE') {
      return ok({ ok: true, id: proxyId }) as T;
    }
  }

  const wanIdx = pathNum(basePath, 'wan');
  if (wanIdx != null || basePath.startsWith('/api/wan/')) {
    if (basePath === '/api/wan/create-queue') return ok({ pending: 0, processing: false, current: null, queueSize: 0 }) as T;
    if (basePath === '/api/wan/create-next') return ok({ accepted: true, queued: true, jobId: 'mock', position: 1, queueSize: 1 }) as T;
    if (basePath === '/api/wan/bulk-enable') {
      return ok({ summary: { succeeded: (body as { indices?: number[] })?.indices?.length || 0, total: 0, failed: 0 } }) as T;
    }
    if (basePath === '/api/wan/bulk-disable') {
      return ok({ summary: { succeeded: (body as { indices?: number[] })?.indices?.length || 0, total: 0, failed: 0 } }) as T;
    }
    if (method === 'POST') {
      return ok({ ok: true, publicIp: `113.22.235.${60 + (wanIdx || 0)}`, proxyCreated: true }) as T;
    }
  }

  if (basePath.startsWith('/api/devices/')) {
    if (method === 'POST' && basePath.endsWith('/apply')) return ok({ ok: true }) as T;
    if (method === 'PATCH' || method === 'POST' || method === 'DELETE') return ok({ ok: true }) as T;
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
    }) as T;
  }
  if (basePath === '/api/auth/change-password') return ok({ ok: true }) as T;
  if (basePath === '/api/proxies/regenerate-credentials') return ok({ ok: true, updated: 10 }) as T;
  if (method === 'POST' || method === 'PATCH') return ok({ ok: true }) as T;

  console.warn('[preview] unmocked API:', method, path);
  return ok({}) as T;
}