/** Delay ms cho stagger animation (cap ở 12 item) */
export function staggerDelay(index: number, step = 45, max = 540): number {
  return Math.min(index * step, max);
}