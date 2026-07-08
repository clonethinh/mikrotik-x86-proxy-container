/** Mangle rules for per-LAN-host upload/download byte counters (forward + conn-mark; FastTrack excluded). */

export const LAN_STATS_CONN_MARK = 'webui-lan-stats';
export const LAN_STATS_UL_COMMENT_PREFIX = 'webui-lan-ul-';
export const LAN_STATS_DL_COMMENT_PREFIX = 'webui-lan-dl-';
export const LAN_STATS_MARK_SRC_PREFIX = 'webui-lan-mark-src-';
export const LAN_STATS_MARK_DST_PREFIX = 'webui-lan-mark-dst-';
export const LAN_STATS_RULE_COMMENT_RE = '^webui-lan-(ul|dl|mark-src|mark-dst)-';

export function lanStatsUlComment(ip: string): string {
  return `${LAN_STATS_UL_COMMENT_PREFIX}${ip}`;
}

export function lanStatsDlComment(ip: string): string {
  return `${LAN_STATS_DL_COMMENT_PREFIX}${ip}`;
}

export function lanStatsMarkSrcComment(ip: string): string {
  return `${LAN_STATS_MARK_SRC_PREFIX}${ip}`;
}

export function lanStatsMarkDstComment(ip: string): string {
  return `${LAN_STATS_MARK_DST_PREFIX}${ip}`;
}

/** Extract LAN IP suffix from a webui-lan-* mangle comment. */
export function lanStatsIpFromComment(comment: string, prefix: string): string {
  if (!comment.startsWith(prefix)) return '';
  return comment.slice(prefix.length);
}

export function isValidLanIpv4(ip: string): boolean {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return false;
  return ip.split('.').every(o => {
    const n = parseInt(o, 10);
    return n >= 0 && n <= 255;
  });
}