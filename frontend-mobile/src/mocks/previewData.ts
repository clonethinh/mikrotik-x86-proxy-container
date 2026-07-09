import type {
  AuditItem,
  AutoProxySettings,
  DashboardData,
  DeviceRoute,
  DhcpLease,
  ProxyUser,
  RouterMonitorSnapshot,
  RouterScriptStatus,
  WanInfo,
} from '../services/api';

export const PREVIEW_USER = { id: 1, username: 'preview', role: 'admin' };

function buildMockRouterHistory(): RouterMonitorSnapshot['history'] {
  const now = Date.now();
  return Array.from({ length: 48 }, (_, i) => {
    const t = now - (47 - i) * 5 * 60_000;
    const wave = Math.sin(i / 4) * 8;
    return {
      ts: new Date(t).toISOString(),
      cpuLoadPct: Math.round(12 + wave + (i % 3)),
      memoryUsedPct: Math.round(42 + wave * 0.5 + (i % 5)),
      hddUsedPct: Math.round(8 + i * 0.02),
      containerRunning: 7 + (i % 2),
    };
  });
}

export const mockRouterMonitor: RouterMonitorSnapshot = {
  cpuLoadPct: 14,
  memoryUsedPct: 45,
  hddUsedPct: 9,
  freeMemoryBytes: 7_000_000_000,
  totalMemoryBytes: 8_370_000_000,
  freeMemoryLabel: '6.5 GB',
  totalMemoryLabel: '7.8 GB',
  freeHddBytes: 61_000_000_000,
  totalHddBytes: 63_500_000_000,
  freeHddLabel: '56.8 GB',
  totalHddLabel: '59.1 GB',
  uptimeSec: 67467,
  uptimeLabel: '18h44m27s',
  cpu: 'Intel(R)',
  cpuCount: 2,
  cpuFrequencyMhz: 1780,
  boardName: 'x86 Default',
  architecture: 'x86_64',
  version: '7.23.1 (stable)',
  containerTotal: 9,
  containerRunning: 8,
  history: buildMockRouterHistory(),
};

function mockWanRow(i: number, running: boolean): WanInfo {
  const ip = running ? `113.22.235.${50 + i}` : null;
  return {
    name: i === 0 ? 'pppoe-wan' : `pppoe-out${i}`,
    index: i,
    disabled: i > 8,
    running,
    uptime: running ? '2d05h12m' : '—',
    publicIp: ip,
    user: 'isp@vnpt',
    extHttpPort: i > 0 ? 30055 + i : undefined,
    extSocksPort: i > 0 ? 31055 + i : undefined,
    containerName: i > 0 && running ? `proxy3p-hub-1-slot-${i}` : null,
    hasContainer: i > 0 && running,
    containerStatus: i > 0 && running ? 'running' : null,
    hasProxy: i > 0 && i <= 10,
    proxyId: i > 0 && i <= 10 ? i : null,
    proxyStatus: i > 0 && i <= 8 ? 'running' : i === 9 ? 'stopped' : i === 10 ? 'error' : null,
    proxyEnabled: i > 0 && i <= 8,
    username: i > 0 ? `user${i}` : null,
    proxyType: i > 0 ? 'both' : null,
    lastLatencyMs: i > 0 && running ? 42 + i : null,
    lastCheckAt: new Date().toISOString(),
    workflowState: i === 11 ? 'countdown' : i > 0 && i <= 8 ? 'active' : i === 12 ? 'discovered' : null,
    countdownEnds: i === 11 ? new Date(Date.now() + 8000).toISOString() : null,
    quayipStatus: i > 0 ? 'ok' : undefined,
    quayipLabel: i > 0 ? 'OK' : undefined,
    comment: i === 0 ? 'WAN quản lý — không proxy' : undefined,
  };
}

export const mockWans: WanInfo[] = [
  mockWanRow(0, true),
  ...Array.from({ length: 12 }, (_, k) => mockWanRow(k + 1, k < 8)),
];

export const mockProxies: ProxyUser[] = Array.from({ length: 10 }, (_, k) => {
  const i = k + 1;
  const running = i <= 8;
  return {
    id: i,
    pppoeIdx: i,
    pppoeName: `pppoe-out${i}`,
    vethName: `veth-3p-${i}`,
    vethIp: `172.18.${i}.2`,
    proxyType: 'both',
    httpPort: 20000 + i,
    socksPort: 21000 + i,
    extHttpPort: 30055 + i,
    extSocksPort: 31055 + i,
    containerName: `proxy3p-hub-1-slot-${i}`,
    username: `user${i}`,
    password: 'preview-pass',
    enabled: running,
    status: running ? 'running' : i === 9 ? 'stopped' : 'error',
    publicIp: running ? `113.22.235.${50 + i}` : null,
    lastCheckAt: new Date().toISOString(),
    lastLatencyMs: running ? 40 + i : null,
    createdAt: new Date(Date.now() - 86400000 * 3).toISOString(),
    updatedAt: new Date().toISOString(),
  };
});

export const mockDevices: DeviceRoute[] = [
  {
    id: 1,
    name: 'PC Kế toán',
    matchType: 'ip',
    ipAddress: '192.168.88.50',
    macAddress: null,
    dhcpHostName: null,
    pppoeIdx: 2,
    pppoeName: 'pppoe-out2',
    enabled: true,
    applied: true,
    statusMessage: 'OK',
    note: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 2,
    name: 'Camera NVR',
    matchType: 'mac',
    ipAddress: null,
    macAddress: 'AA:BB:CC:DD:EE:01',
    dhcpHostName: null,
    pppoeIdx: 3,
    pppoeName: 'pppoe-out3',
    enabled: true,
    applied: false,
    statusMessage: 'Chờ apply',
    note: 'Test route',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 3,
    name: 'Smart TV',
    matchType: 'dhcp',
    ipAddress: '192.168.88.60',
    macAddress: '11:22:33:44:55:66',
    dhcpHostName: 'smart-tv',
    pppoeIdx: 4,
    pppoeName: 'pppoe-out4',
    enabled: false,
    applied: false,
    statusMessage: null,
    note: 'Tắt tạm',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

export const mockDhcpLeases: DhcpLease[] = [
  {
    id: '1', address: '192.168.88.50', macAddress: 'AA:BB:CC:11:22:33', hostName: 'pc-ke-toan', status: 'bound', server: 'dhcp-lan',
    rxBytes: '2147483648', txBytes: '536870912', rxLabel: '2.0 GiB', txLabel: '512 MiB', rxBps: 1_250_000, txBps: 320_000, trafficLive: true,
  },
  {
    id: '2', address: '192.168.88.51', macAddress: 'AA:BB:CC:DD:EE:01', hostName: 'nvr-cam', status: 'bound', server: 'dhcp-lan',
    rxBytes: '8589934592', txBytes: '1073741824', rxLabel: '8.0 GiB', txLabel: '1.0 GiB', rxBps: 4_500_000, txBps: 890_000, trafficLive: true,
  },
  {
    id: '3', address: '192.168.88.10', macAddress: 'DE:AD:BE:EF:00:01', hostName: 'admin-pc', status: 'bound', server: 'dhcp-lan',
    rxBytes: '104857600', txBytes: '52428800', rxLabel: '100 MiB', txLabel: '50 MiB', rxBps: 45_000, txBps: 12_000, trafficLive: true,
  },
  {
    id: '4', address: '192.168.88.99', macAddress: '11:22:33:44:55:66', hostName: 'phone-guest', status: 'waiting', server: 'dhcp-lan',
    rxBytes: '0', txBytes: '0', rxLabel: '—', txLabel: '—', rxBps: 0, txBps: 0, trafficLive: false,
  },
];

export const mockDashboard: DashboardData = {
  totalProxies: 10,
  runningProxies: 8,
  stoppedProxies: 1,
  errorProxies: 1,
  totalWan: 13,
  wanUp: 9,
  wanDown: 4,
  realtimeClients: 3,
  containerProxies: 8,
  containerHealthy: 7,
  webuiRunning: true,
  mikrotik: {
    host: '192.168.88.1',
    wanHost: 'myproxy.duckdns.org',
    managementUrl: 'http://myproxy.duckdns.org:8088',
    version: '7.23.1 (stable)',
    cpuLoad: '14%',
    freeMemory: '6.5GiB',
    cpu: 'Intel(R)',
    cpuCount: 2,
    uptime: '18h44m27s',
    boardName: 'x86 Default',
    architecture: 'x86_64',
  },
  routerMonitor: { ...mockRouterMonitor, live: true, sampleAgeMs: 0 },
  wanTraffic: {
    rxBytes: '12884901888',
    txBytes: '5368709120',
    rxLabel: '12.0 GB',
    txLabel: '5.0 GB',
    rxBps: 4_200_000,
    txBps: 1_100_000,
    wanUp: 9,
    wanTotal: 13,
    sampleAgeMs: 1200,
    live: true,
    history: Array.from({ length: 24 }, (_, i) => ({
      ts: new Date(Date.now() - (23 - i) * 5000).toISOString(),
      rxBps: 2_000_000 + Math.round(Math.sin(i / 3) * 800_000),
      txBps: 800_000 + Math.round(Math.cos(i / 4) * 300_000),
    })),
  },
  live: true,
  source: 'mikrotik',
  dhcpLeases: mockDhcpLeases,
  deviceRoutes: mockDevices,
  timestamp: Date.now(),
};

export const mockAudit: AuditItem[] = [
  { id: 1, username: 'admin', action: 'login', resource: null, resourceId: null, details: null, ip: '192.168.88.10', proxyId: null, createdAt: new Date().toISOString() },
  { id: 2, username: 'admin', action: 'wan-enable', resource: 'wan', resourceId: 5, details: 'pppoe-out5 enabled', ip: '192.168.88.10', proxyId: null, createdAt: new Date(Date.now() - 3600000).toISOString() },
  { id: 3, username: 'admin', action: 'proxy-create', resource: 'proxy', resourceId: 5, details: 'pppoe-out5 · user5', ip: '192.168.88.10', proxyId: 5, createdAt: new Date(Date.now() - 7200000).toISOString() },
  { id: 4, username: 'preview', action: 'proxy-start', resource: 'proxy', resourceId: 3, details: null, ip: '192.168.88.10', proxyId: 3, createdAt: new Date(Date.now() - 10800000).toISOString() },
  { id: 5, username: 'admin', action: 'device-create', resource: 'device', resourceId: 2, details: 'Camera NVR → pppoe-out3', ip: '192.168.88.10', proxyId: null, createdAt: new Date(Date.now() - 14400000).toISOString() },
  { id: 6, username: 'admin', action: 'proxy-delete', resource: 'proxy', resourceId: 10, details: 'cleanup error proxy', ip: '192.168.88.10', proxyId: 10, createdAt: new Date(Date.now() - 18000000).toISOString() },
];

export const mockRouterScripts: RouterScriptStatus[] = [
  {
    name: 'quayip',
    label: 'Quay IP',
    description: 'Quay IP pool PPPoE',
    installed: true,
    runCount: 56,
    lastStarted: new Date(Date.now() - 3600000).toISOString(),
    scheduler: { name: 'quayip', interval: 'manual', nextRun: null, disabled: false },
  },
  {
    name: 'duckdns-update',
    label: 'DuckDNS',
    description: 'Cập nhật IP WAN',
    installed: true,
    runCount: 142,
    lastStarted: new Date().toISOString(),
    scheduler: { name: 'duckdns', interval: '5m', nextRun: null, disabled: false },
  },
  {
    name: 'wan-watcher',
    label: 'WanWatcher',
    description: 'Quét PPPoE pool',
    installed: true,
    runCount: 890,
    lastStarted: new Date().toISOString(),
    scheduler: { name: 'wanwatch', interval: '30s', nextRun: null, disabled: false },
  },
];

export const mockAutoProxy: AutoProxySettings = {
  mode: 'semi',
  pollIntervalMs: 20000,
  countdownMs: 8000,
  ipWaitTimeoutMs: 120000,
  maxConcurrent: 16,
  warnConcurrent: 12,
  staleTtlMs: 1800000,
  goneDebouncePolls: 2,
};

export const mockDeployInfo = {
  target: 'preview-mock',
  mikrotik: {
    host: '192.168.88.1',
    wanHost: 'myproxy.duckdns.org',
    managementUrl: 'http://myproxy.duckdns.org:8088',
  },
  threeProxy: {
    image: 'ghcr.io/tarampampam/3proxy:2',
    tarball: '3proxy-hub.tar',
  },
  network: {
    bridgeName: 'containers-veth',
    vethIpFormula: '172.18.N.2/30',
    vethNetworkBase: '172.18',
    maxPppoeIdx: 32,
    portFormula: '30055+N',
    extHttpPortBase: 30055,
    extSocksPortBase: 31055,
  },
};

export const mockRequestLogs = [
  {
    id: 1,
    ts: new Date().toISOString(),
    clientIp: '203.0.113.10',
    destHost: 'api.telegram.org',
    destPort: 443,
    rxBytes: '4096',
    txBytes: '8192',
    errorCode: 0,
    durationMs: 320,
    service: 'http',
  },
  {
    id: 2,
    ts: new Date(Date.now() - 60000).toISOString(),
    clientIp: '198.51.100.5',
    destHost: 'www.google.com',
    destPort: 443,
    rxBytes: '2048',
    txBytes: '1024',
    errorCode: 0,
    durationMs: 180,
    service: 'http',
  },
];

export const mockDomainStats = [
  { domain: 'api.telegram.org', hits: 42, rxBytes: '1048576', txBytes: '524288', totalBytes: '1572864' },
  { domain: 'www.google.com', hits: 28, rxBytes: '524288', txBytes: '262144', totalBytes: '786432' },
  { domain: 'cdn.discordapp.com', hits: 15, rxBytes: '2097152', txBytes: '1048576', totalBytes: '3145728' },
];