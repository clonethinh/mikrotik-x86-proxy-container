import { isManagementPppoe } from './pppoeUtils';

/** Trạng thái PPPoE theo script quayip (comment OK / DEAD). */
export type QuayipPppoeStatus =
  | 'protected'
  | 'ok'
  | 'dead'
  | 'disabled'
  | 'rotating'
  | 'unknown';

export function deriveQuayipStatus(
  name: string,
  opts: { disabled: boolean; running: boolean; comment?: string | null },
): QuayipPppoeStatus {
  if (isManagementPppoe(name)) return 'protected';
  const c = (opts.comment || '').trim();
  if (opts.disabled) return c === 'DEAD' ? 'dead' : 'disabled';
  if (c === 'OK' && opts.running) return 'ok';
  if (!opts.running) return 'rotating';
  return 'unknown';
}

export const QUAYIP_STATUS_LABELS: Record<QuayipPppoeStatus, string> = {
  protected: 'WAN chính',
  ok: 'IP OK',
  dead: 'DEAD (quayip tắt)',
  disabled: 'Tắt',
  rotating: 'Đang quay IP',
  unknown: 'Chưa kiểm tra',
};