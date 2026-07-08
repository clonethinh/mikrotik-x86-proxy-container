import { prisma } from '../../db/prisma';
import { isContainerRunning } from '../../lib/containerUtils';
import { formatBytesShort, formatUptimeShort, normalizeRouterResource } from '../../lib/mikrotikResourceUtils';
import { getMikrotikService } from '../mikrotik/MikrotikService';

export interface RouterMonitorHistoryPoint {
  ts: string;
  cpuLoadPct: number | null;
  memoryUsedPct: number | null;
  hddUsedPct: number | null;
  containerRunning: number;
}

export interface RouterMonitorSnapshot {
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

export async function getRouterMonitor(hours = 4): Promise<RouterMonitorSnapshot> {
  const mik = getMikrotikService();
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  const [resourceRaw, containers, historyRows] = await Promise.all([
    mik.getSystemResource().catch(() => ({})),
    mik.getContainers().catch(() => []),
    prisma.routerResourceSample.findMany({
      where: { ts: { gte: since } },
      orderBy: { ts: 'asc' },
      take: 500,
    }).catch(() => []),
  ]);

  const r = normalizeRouterResource(resourceRaw as Record<string, unknown>);
  const containerTotal = containers.length;
  const containerRunning = containers.filter(c => isContainerRunning(c.status)).length;

  const history: RouterMonitorHistoryPoint[] = historyRows.map(row => ({
    ts: row.ts.toISOString(),
    cpuLoadPct: row.cpuLoadPct,
    memoryUsedPct: row.memoryUsedPct,
    hddUsedPct: row.hddUsedPct,
    containerRunning: row.containerRunning,
  }));

  return {
    cpuLoadPct: r.cpuLoadPct,
    memoryUsedPct: r.memoryUsedPct,
    hddUsedPct: r.hddUsedPct,
    freeMemoryBytes: r.freeMemoryBytes,
    totalMemoryBytes: r.totalMemoryBytes,
    freeMemoryLabel: formatBytesShort(r.freeMemoryBytes),
    totalMemoryLabel: formatBytesShort(r.totalMemoryBytes),
    freeHddBytes: r.freeHddBytes,
    totalHddBytes: r.totalHddBytes,
    freeHddLabel: formatBytesShort(r.freeHddBytes),
    totalHddLabel: formatBytesShort(r.totalHddBytes),
    uptimeSec: r.uptimeSec,
    uptimeLabel: r.uptimeLabel || formatUptimeShort(r.uptimeSec),
    cpu: r.cpu,
    cpuCount: r.cpuCount,
    cpuFrequencyMhz: r.cpuFrequencyMhz,
    boardName: r.boardName,
    architecture: r.architecture,
    version: r.version,
    containerTotal,
    containerRunning,
    history,
  };
}