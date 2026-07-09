// Hub firewall rule comment helpers — audit/reconcile orphan & missing rules
import { config } from './config';
import {
  hubDstnatHttpComment,
  hubDstnatSocksComment,
  hubHpGwMangleComment,
  hubHpGwSrcnatComment,
  hubHpWanSrcnatComment,
  hubInputHttpComment,
  hubInputSocksComment,
  hubLanIfHttpComment,
  hubLanIfSocksComment,
  hubLanPubHttpComment,
  hubLanPubSocksComment,
  hubMangleComment,
  hubSrcnatComment,
} from './hubUtils';

const SLOT_COMMENT_PATTERNS: RegExp[] = [
  /^hub-mangle-slot(\d+)$/,
  /^hub-srcnat-slot(\d+)$/,
  /^hub-slot(\d+)-(?:HTTP|SOCKS)$/,
  /^hub-lan-pub-slot(\d+)-(?:HTTP|SOCKS)$/,
  /^hub-lan-if-[^-]+-s(\d+)-(?:HTTP|SOCKS)$/,
  /^hub-in-(?:http|socks)-[^-]+-s(\d+)$/,
  /^hub-mangle-hp-gw-s(\d+)-(?:http|socks)$/,
  /^hub-hp-gw-[^-]+-s(\d+)-(?:http|socks)$/,
  /^hub-hp-wan-s(\d+)-(?:http|socks)$/,
];

const GLOBAL_HUB_PREFIXES = [
  'hub-fwd-',
  'hub-mangle-lan-',
  'hub-in-lan-',
  'hub-srcnat-lan-hairpin',
  'hub-hairpin-',
  'webuiproxymikrotik-',
  'dev-mgmt-',
  'dev-route-',
];

export function isGlobalHubFirewallComment(comment: string): boolean {
  if (!comment) return true;
  return GLOBAL_HUB_PREFIXES.some(p => comment.startsWith(p) || comment === p);
}

export function extractHubSlotFromComment(comment: string): number | null {
  if (!comment || isGlobalHubFirewallComment(comment)) return null;
  for (const re of SLOT_COMMENT_PATTERNS) {
    const m = comment.match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return null;
}

/** Comments bắt buộc cho 1 hub slot (enabled proxy). */
export function expectedHubSlotComments(pppoeIdx: number, egressName: string): string[] {
  const comments = [
    hubMangleComment(pppoeIdx),
    hubSrcnatComment(pppoeIdx),
    hubDstnatHttpComment(pppoeIdx),
    hubDstnatSocksComment(pppoeIdx),
    hubLanPubHttpComment(pppoeIdx),
    hubLanPubSocksComment(pppoeIdx),
    hubInputHttpComment(pppoeIdx, egressName),
    hubInputSocksComment(pppoeIdx, egressName),
    hubHpGwMangleComment(pppoeIdx, 'http'),
    hubHpGwMangleComment(pppoeIdx, 'socks'),
    hubHpWanSrcnatComment(pppoeIdx, 'http'),
    hubHpWanSrcnatComment(pppoeIdx, 'socks'),
  ];
  for (const lanIf of config.network.lanInterfaces) {
    comments.push(
      hubLanIfHttpComment(pppoeIdx, lanIf),
      hubLanIfSocksComment(pppoeIdx, lanIf),
      hubHpGwSrcnatComment(pppoeIdx, lanIf, 'http'),
      hubHpGwSrcnatComment(pppoeIdx, lanIf, 'socks'),
    );
  }
  return comments;
}

export const WEBUI_DEDUP_COMMENTS = [
  'webuiproxymikrotik-webui-dstnat',
  'webuiproxymikrotik-accept-webui',
  'webuiproxymikrotik-accept-webui-forward',
] as const;