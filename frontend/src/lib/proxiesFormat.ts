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