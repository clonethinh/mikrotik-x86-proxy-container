/** Phân loại IP WAN — cùng tiêu chí script quayip trên MikroTik. */

export type IpQuality =
  | 'public'
  | 'cgnat'
  | 'link_local'
  | 'private'
  | 'missing'
  | 'invalid';

export interface IpQualityInfo {
  quality: IpQuality;
  /** Client internet có thể kết nối proxy qua IP này */
  usable: boolean;
  label: string;
  hint: string;
}

function parseFirstTwoOctets(ip: string): { o1: number; o2: number } | null {
  const parts = ip.trim().split('.');
  if (parts.length < 2) return null;
  const o1 = parseInt(parts[0], 10);
  const o2 = parseInt(parts[1], 10);
  if (!Number.isFinite(o1) || !Number.isFinite(o2)) return null;
  return { o1, o2 };
}

/** true = IP xấu theo quayip (CGNAT, link-local, optional RFC1918). */
export function isBadWanIp(ip: string | null | undefined, rejectPrivate = false): boolean {
  const info = classifyPublicIp(ip, rejectPrivate);
  return !info.usable;
}

export function classifyPublicIp(
  ip: string | null | undefined,
  rejectPrivate = false,
): IpQualityInfo {
  if (!ip || !ip.trim()) {
    return {
      quality: 'missing',
      usable: false,
      label: 'Chưa có IP',
      hint: 'PPPoE chưa nhận IP — proxy ở trạng thái pending',
    };
  }

  const trimmed = ip.trim();
  const oct = parseFirstTwoOctets(trimmed);
  if (!oct) {
    return {
      quality: 'invalid',
      usable: false,
      label: 'IP không hợp lệ',
      hint: trimmed,
    };
  }

  const { o1, o2 } = oct;

  if (o1 === 169 && o2 === 254) {
    return {
      quality: 'link_local',
      usable: false,
      label: 'Link-local',
      hint: '169.254.x.x — PPPoE lỗi hoặc chưa dial xong',
    };
  }

  if (o1 === 100 && o2 >= 64 && o2 <= 127) {
    return {
      quality: 'cgnat',
      usable: false,
      label: 'CGNAT',
      hint: '100.64.0.0/10 — IP carrier-grade NAT, client ngoài internet không vào được',
    };
  }

  if (rejectPrivate) {
    if (o1 === 10) {
      return { quality: 'private', usable: false, label: 'Private', hint: '10.0.0.0/8 — không public' };
    }
    if (o1 === 192 && o2 === 168) {
      return { quality: 'private', usable: false, label: 'Private', hint: '192.168.0.0/16 — không public' };
    }
    if (o1 === 172 && o2 >= 16 && o2 <= 31) {
      return { quality: 'private', usable: false, label: 'Private', hint: '172.16.0.0/12 — không public' };
    }
  }

  return {
    quality: 'public',
    usable: true,
    label: 'Public',
    hint: 'IP routable — dùng được cho proxy client',
  };
}

export const IP_QUALITY_COLORS: Record<IpQuality, string> = {
  public: 'success',
  cgnat: 'error',
  link_local: 'warning',
  private: 'default',
  missing: 'default',
  invalid: 'error',
};