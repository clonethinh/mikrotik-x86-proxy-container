/** bytes/sec từ MikroTik / metrics collector */
export type SpeedUnit = 'KB/s' | 'MB/s' | 'Mbps';

const KB = 1024;
const MB = 1024 * 1024;

export function speedToUnit(bytesPerSec: number, unit: SpeedUnit): number {
  const v = Math.max(0, bytesPerSec);
  if (unit === 'MB/s') return v / MB;
  if (unit === 'Mbps') return (v * 8) / 1_000_000;
  return v / KB;
}

export function formatSpeed(bytesPerSec: number, unit: SpeedUnit): string {
  const v = speedToUnit(bytesPerSec, unit);
  if (unit === 'Mbps') {
    if (v >= 1000) return `${v.toFixed(0)} Mbps`;
    if (v >= 100) return `${v.toFixed(1)} Mbps`;
    if (v >= 10) return `${v.toFixed(2)} Mbps`;
    if (v >= 1) return `${v.toFixed(2)} Mbps`;
    return `${v.toFixed(3)} Mbps`;
  }
  if (unit === 'MB/s') {
    if (v >= 100) return `${v.toFixed(0)} MB/s`;
    if (v >= 10) return `${v.toFixed(1)} MB/s`;
    if (v >= 1) return `${v.toFixed(2)} MB/s`;
    return `${v.toFixed(3)} MB/s`;
  }
  if (v >= 1000) return `${v.toFixed(0)} KB/s`;
  if (v >= 100) return `${v.toFixed(1)} KB/s`;
  if (v >= 10) return `${v.toFixed(2)} KB/s`;
  return `${v.toFixed(2)} KB/s`;
}

export function formatBps(bps: number): string {
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(1)} Mbps`;
  if (bps >= 1_000) return `${(bps / 1_000).toFixed(0)} Kbps`;
  return `${bps} bps`;
}

export function formatBytes(n: string | number): string {
  const v = typeof n === 'string' ? Number(n) : n;
  if (!v || Number.isNaN(v)) return '0 B';
  if (v >= 1_073_741_824) return `${(v / 1_073_741_824).toFixed(2)} GB`;
  if (v >= 1_048_576) return `${(v / 1_048_576).toFixed(1)} MB`;
  if (v >= 1024) return `${(v / 1024).toFixed(0)} KB`;
  return `${v} B`;
}