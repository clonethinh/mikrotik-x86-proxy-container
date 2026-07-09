export function normalizeSeries(values: number[], min = 0.08): number[] {
  if (values.length === 0) return [];
  const max = Math.max(...values, 1);
  const minVal = Math.min(...values);
  const range = max - minVal || 1;
  return values.map((v) => min + ((v - minVal) / range) * (1 - min));
}

export function seriesFromHistory<T>(
  rows: T[],
  pick: (row: T) => number,
): number[] {
  return rows.map(pick);
}

export function buildAreaPath(
  normalized: number[],
  width: number,
  height: number,
  padding = 4,
): string {
  if (normalized.length === 0) return '';
  const innerW = width - padding * 2;
  const innerH = height - padding * 2;
  const step = normalized.length > 1 ? innerW / (normalized.length - 1) : innerW;

  const points = normalized.map((n, i) => {
    const x = padding + i * step;
    const y = padding + innerH * (1 - n);
    return `${x},${y}`;
  });

  const baseline = `${padding + innerW},${padding + innerH} ${padding},${padding + innerH}`;
  return `M ${points[0]} L ${points.slice(1).join(' L ')} L ${baseline} Z`;
}

export function buildLinePath(
  normalized: number[],
  width: number,
  height: number,
  padding = 4,
): string {
  if (normalized.length === 0) return '';
  const innerW = width - padding * 2;
  const innerH = height - padding * 2;
  const step = normalized.length > 1 ? innerW / (normalized.length - 1) : innerW;

  return normalized
    .map((n, i) => {
      const x = padding + i * step;
      const y = padding + innerH * (1 - n);
      return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
    })
    .join(' ');
}