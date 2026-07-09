export type SpeedUnit = 'KB/s' | 'MB/s' | 'Mbps';

export function formatBps(bps: number, unit: SpeedUnit = 'KB/s'): string {
  if (!bps || bps <= 0) return '0';
  if (unit === 'Mbps') return (bps * 8 / 1_000_000).toFixed(2);
  if (unit === 'MB/s') return (bps / 1_000_000).toFixed(2);
  return (bps / 1000).toFixed(1);
}

export function formatBytesLabel(bytes: string | number | bigint | null | undefined): string {
  const n = BigInt(bytes || 0);
  if (n < 1024n) return `${n} B`;
  if (n < 1024n * 1024n) return `${Number(n / 1024n)} KB`;
  if (n < 1024n * 1024n * 1024n) return `${(Number(n) / (1024 * 1024)).toFixed(1)} MB`;
  return `${(Number(n) / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatPct(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '—';
  return `${Math.round(v)}%`;
}

export function formatLatency(ms: number | null | undefined): string {
  if (ms == null) return '—';
  return `${ms}ms`;
}

export function formatDateTime(v: string | null | undefined): string {
  if (!v) return '—';
  return new Date(v).toLocaleString('vi-VN');
}