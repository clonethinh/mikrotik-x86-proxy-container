import { config, managementUrl } from '../../lib/config';
import { isContainerRunning } from '../../lib/containerUtils';
import { normalizeRouterResource } from '../../lib/mikrotikResourceUtils';
import { realtimeHub } from '../../realtime/hub';
import { deviceRoutingService } from '../device/DeviceRoutingService';
import { getMikrotikService } from '../mikrotik/MikrotikService';
import { getLanTrafficForIp } from './LanDeviceTrafficService';
import { getRouterMonitor } from './RouterMonitorService';
import { getWanTrafficSnapshot } from './RouterTrafficService';

function isProxyFleetContainer(name: string): boolean {
  return name.startsWith('proxy3p-') && name !== 'webuiproxymikrotik';
}

function containerIsError(status: string, healthy?: boolean): boolean {
  const s = (status || '').toLowerCase();
  if (healthy === false) return true;
  return s.includes('error') || s.includes('exited') || s.includes('unhealthy') || s.includes('bad');
}

export async function buildDashboardSnapshot() {
  const mik = getMikrotikService();
  const fresh = { fresh: true as const };

  const [wan, containers, resource, routerMonitor, dhcpRaw, deviceRoutes] = await Promise.all([
    mik.getPppoeInterfaces(fresh).catch(() => []),
    mik.getContainers(fresh).catch(() => []),
    mik.getSystemResource().catch(() => ({})),
    getRouterMonitor(4, fresh).catch(() => null),
    mik.getDhcpLeases().catch(() => []),
    deviceRoutingService.list().catch(() => []),
  ]);

  const proxyContainers = containers.filter(c => isProxyFleetContainer(c.name));
  const healthyContainers = proxyContainers.filter(c => isContainerRunning(c.status));
  const errorContainers = proxyContainers.filter(c => containerIsError(c.status, c.healthy));
  const stoppedContainers = proxyContainers.filter(c =>
    !isContainerRunning(c.status) && !containerIsError(c.status, c.healthy),
  );
  const webui = containers.find(c => c.name === 'webuiproxymikrotik');
  const normalized = normalizeRouterResource(resource as Record<string, unknown>);
  const wanTraffic = getWanTrafficSnapshot();
  const ts = Date.now();

  const dhcpLeases = dhcpRaw.map(lease => ({
    ...lease,
    ...getLanTrafficForIp(lease.address),
  }));

  return {
    totalProxies: proxyContainers.length,
    runningProxies: healthyContainers.length,
    stoppedProxies: stoppedContainers.length,
    errorProxies: errorContainers.length,
    totalWan: wan.length,
    wanUp: wan.filter(w => w.running).length,
    wanDown: wan.filter(w => !w.running).length,
    containerProxies: proxyContainers.length,
    containerHealthy: healthyContainers.length,
    webuiRunning: !!webui && isContainerRunning(webui.status),
    realtimeClients: realtimeHub.size(),
    mikrotik: {
      host: config.mikrotik.host,
      wanHost: config.mikrotik.wanHost || null,
      managementUrl: managementUrl() || null,
      version: normalized.version,
      cpuLoad: normalized.cpuLoadPct != null ? `${normalized.cpuLoadPct}%` : null,
      freeMemory: normalized.freeMemoryBytes != null
        ? `${Math.round(normalized.freeMemoryBytes / (1024 ** 3) * 10) / 10}GiB`
        : null,
      cpu: normalized.cpu,
      cpuCount: normalized.cpuCount,
      uptime: normalized.uptimeLabel,
      boardName: normalized.boardName,
      architecture: normalized.architecture,
    },
    routerMonitor,
    wanTraffic,
    dhcpLeases,
    deviceRoutes,
    live: true,
    source: 'mikrotik' as const,
    timestamp: ts,
  };
}