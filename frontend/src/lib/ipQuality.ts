export type IpQuality =
  | 'public'
  | 'cgnat'
  | 'link_local'
  | 'private'
  | 'missing'
  | 'invalid';

export interface IpQualityFields {
  ipQuality?: IpQuality;
  ipQualityLabel?: string;
  ipUsable?: boolean;
  ipQualityHint?: string;
}

const TAG_COLOR: Record<IpQuality, string> = {
  public: 'success',
  cgnat: 'error',
  link_local: 'warning',
  private: 'default',
  missing: 'default',
  invalid: 'error',
};

export function ipQualityTagColor(quality?: IpQuality | null): string {
  if (!quality) return 'default';
  return TAG_COLOR[quality] ?? 'default';
}

/** Phân loại IP phía client (fallback khi API cũ chưa có field). */
export function classifyIpClient(ip: string | null | undefined): IpQualityFields {
  if (!ip?.trim()) {
    return { ipQuality: 'missing', ipQualityLabel: 'Chưa có IP', ipUsable: false, ipQualityHint: 'Chưa nhận IP WAN' };
  }
  const parts = ip.trim().split('.');
  const o1 = parseInt(parts[0], 10);
  const o2 = parseInt(parts[1], 10);
  if (!Number.isFinite(o1) || !Number.isFinite(o2)) {
    return { ipQuality: 'invalid', ipQualityLabel: 'IP lỗi', ipUsable: false };
  }
  if (o1 === 169 && o2 === 254) {
    return { ipQuality: 'link_local', ipQualityLabel: 'Link-local', ipUsable: false, ipQualityHint: '169.254.x.x' };
  }
  if (o1 === 100 && o2 >= 64 && o2 <= 127) {
    return { ipQuality: 'cgnat', ipQualityLabel: 'CGNAT', ipUsable: false, ipQualityHint: '100.64.0.0/10' };
  }
  return { ipQuality: 'public', ipQualityLabel: 'Public', ipUsable: true };
}

export function resolveIpQuality(row: { publicIp?: string | null } & IpQualityFields): IpQualityFields {
  if (row.ipQuality) {
    return {
      ipQuality: row.ipQuality,
      ipQualityLabel: row.ipQualityLabel,
      ipUsable: row.ipUsable,
      ipQualityHint: row.ipQualityHint,
    };
  }
  return classifyIpClient(row.publicIp);
}