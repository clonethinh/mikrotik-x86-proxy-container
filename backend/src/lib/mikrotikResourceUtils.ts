/** Parse MikroTik /system/resource fields (REST + CLI text). */

const SIZE_UNITS: Record<string, number> = {
  B: 1,
  KB: 1e3,
  KIB: 1024,
  MB: 1e6,
  MIB: 1024 ** 2,
  GB: 1e9,
  GIB: 1024 ** 3,
  TB: 1e12,
  TIB: 1024 ** 4,
};

export function parseMikrotikSize(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.round(raw);
  const s = String(raw).trim();
  const m = s.match(/^([\d.]+)\s*([KMGT]?i?B)?$/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  const unit = (m[2] || 'B').toUpperCase();
  const mul = SIZE_UNITS[unit] ?? 1;
  return Math.round(n * mul);
}

export function parseCpuLoadPct(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.min(100, Math.max(0, Math.round(raw)));
  const s = String(raw).trim().replace('%', '');
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return null;
  return Math.min(100, Math.max(0, Math.round(n)));
}

export function parseUptimeSeconds(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.round(raw);
  const s = String(raw).trim().toLowerCase();
  let total = 0;
  const weeks = s.match(/(\d+)w/);
  const days = s.match(/(\d+)d/);
  const hours = s.match(/(\d+)h/);
  const mins = s.match(/(\d+)m(?!s)/);
  const secs = s.match(/(\d+)s/);
  if (weeks) total += parseInt(weeks[1], 10) * 604800;
  if (days) total += parseInt(days[1], 10) * 86400;
  if (hours) total += parseInt(hours[1], 10) * 3600;
  if (mins) total += parseInt(mins[1], 10) * 60;
  if (secs) total += parseInt(secs[1], 10);
  return total > 0 ? total : null;
}

export function parseFrequencyMhz(raw: unknown): number | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  const m = s.match(/^([\d.]+)\s*MHz$/i);
  if (m) return Math.round(parseFloat(m[1]));
  const n = parseFloat(s);
  return Number.isFinite(n) ? Math.round(n) : null;
}

export interface NormalizedRouterResource {
  version: string | null;
  uptimeSec: number | null;
  uptimeLabel: string | null;
  cpu: string | null;
  cpuCount: number | null;
  cpuFrequencyMhz: number | null;
  cpuLoadPct: number | null;
  freeMemoryBytes: number | null;
  totalMemoryBytes: number | null;
  memoryUsedPct: number | null;
  freeHddBytes: number | null;
  totalHddBytes: number | null;
  hddUsedPct: number | null;
  boardName: string | null;
  architecture: string | null;
  platform: string | null;
}

export function normalizeRouterResource(raw: Record<string, unknown>): NormalizedRouterResource {
  const freeMem = parseMikrotikSize(raw['free-memory']);
  const totalMem = parseMikrotikSize(raw['total-memory']);
  const freeHdd = parseMikrotikSize(raw['free-hdd-space']);
  const totalHdd = parseMikrotikSize(raw['total-hdd-space']);
  const memUsedPct = freeMem != null && totalMem != null && totalMem > 0
    ? Math.round(((totalMem - freeMem) / totalMem) * 100)
    : null;
  const hddUsedPct = freeHdd != null && totalHdd != null && totalHdd > 0
    ? Math.round(((totalHdd - freeHdd) / totalHdd) * 100)
    : null;

  return {
    version: raw.version != null ? String(raw.version) : null,
    uptimeSec: parseUptimeSeconds(raw.uptime),
    uptimeLabel: raw.uptime != null ? String(raw.uptime) : null,
    cpu: raw.cpu != null ? String(raw.cpu) : null,
    cpuCount: raw['cpu-count'] != null ? parseInt(String(raw['cpu-count']), 10) || null : null,
    cpuFrequencyMhz: parseFrequencyMhz(raw['cpu-frequency']),
    cpuLoadPct: parseCpuLoadPct(raw['cpu-load']),
    freeMemoryBytes: freeMem,
    totalMemoryBytes: totalMem,
    memoryUsedPct: memUsedPct,
    freeHddBytes: freeHdd,
    totalHddBytes: totalHdd,
    hddUsedPct: hddUsedPct,
    boardName: raw['board-name'] != null ? String(raw['board-name']) : null,
    architecture: raw['architecture-name'] != null ? String(raw['architecture-name']) : null,
    platform: raw.platform != null ? String(raw.platform) : null,
  };
}

export function formatBytesShort(bytes: number | null): string {
  if (bytes == null || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

export function formatUptimeShort(sec: number | null): string {
  if (sec == null || sec <= 0) return '—';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}