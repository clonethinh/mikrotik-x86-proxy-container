// Rate-limit bot scan trên cổng proxy WAN — tự động sau mỗi lần tạo/sửa proxy hub.
// - SYN > 40/s mỗi IP → drop (per pppoe-out)
// - > 60 concurrent conn mỗi IP → drop (all-ppp)
// Incremental idempotent — không remove/move hàng loạt (tránh spam RouterOS log).
import { config } from '../../lib/config';
import { logger } from '../../lib/logger';
import { getMikrotikService } from '../mikrotik/MikrotikService';

const BASE_RULE_COMMENTS = [
  'hub-rate-limit-scan-drop',
  'hub-rate-limit-http-conn',
  'hub-rate-limit-socks-conn',
] as const;

const PROXY_PLACE_BEFORE = '[find comment=hub-in-http-pppoe-out1-s1]';
/** scan-drop phải trước rule accept SSH WAN — nếu không blacklist SSH không có tác dụng */
const SCAN_DROP_PLACE_BEFORE = '[find comment="INPUT: Allow port 22222 (SSH) from WAN"]';
const SYN_PLACE_BEFORE = '[find comment=hub-rate-limit-scan-drop]';

function synComment(ifn: string, suffix: 'http' | 'socks'): string {
  return `hub-rate-limit-syn-${ifn}-${suffix}`;
}

export class HubRateLimitService {
  private pending: ReturnType<typeof setTimeout> | null = null;
  private applying = false;
  private rerunAfterCurrent = false;
  /** Bỏ qua apply nếu vừa chạy xong và không có thay đổi interface */
  private lastIfaceKey = '';

  /** Gộp burst tạo proxy — 1 lần apply sau debounce */
  scheduleApply(): void {
    if (!config.hub.rateLimitOnApply) return;
    const ms = config.hub.rateLimitDebounceMs;
    if (this.pending) clearTimeout(this.pending);
    this.pending = setTimeout(() => {
      this.pending = null;
      void this.apply().catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        logger.warn({ err: msg.slice(0, 120) }, 'applyProxyRateLimit failed');
      });
    }, ms);
  }

  async apply(): Promise<void> {
    if (!config.hub.rateLimitOnApply) return;
    if (this.applying) {
      this.rerunAfterCurrent = true;
      return;
    }
    this.applying = true;
    try {
      const changed = await this.applyOnce();
      if (changed) logger.info('applyProxyRateLimit OK');
    } finally {
      this.applying = false;
      if (this.rerunAfterCurrent) {
        this.rerunAfterCurrent = false;
        void this.apply().catch((e: unknown) => {
          const msg = e instanceof Error ? e.message : String(e);
          logger.warn({ err: msg.slice(0, 120) }, 'applyProxyRateLimit rerun failed');
        });
      }
    }
  }

  /** @returns true nếu có thay đổi rule (add/remove) */
  private async applyOnce(): Promise<boolean> {
    const mik = getMikrotikService();
    const extHttp = config.network.extHttpPortBase;
    const extSocks = config.network.extSocksPortBase;
    const maxOut = config.hub.maxPppoeOut;
    const httpFrom = extHttp + 1;
    const httpTo = extHttp + maxOut;
    const socksFrom = extSocks + 1;
    const socksTo = extSocks + maxOut;

    const ppOut = await mik.sshExec('/interface print terse where name~"^pppoe-out"', 15_000);
    const ifaces = [...ppOut.matchAll(/name=([^\s]+)/g)]
      .map(m => m[1])
      .filter(n => /^pppoe-out\d+$/.test(n))
      .sort();
    const ifaceKey = ifaces.join(',');
    if (ifaceKey === this.lastIfaceKey) {
      const invalid = await mik.sshExec(
        '/ip firewall filter print count-only where comment~"hub-rate-limit" and invalid',
        8_000,
      );
      if (parseInt(invalid.trim(), 10) === 0) return false;
    }

    let changed = false;

    const invalidBefore = await mik.sshExec(
      '/ip firewall filter print count-only where comment~"hub-rate-limit" and invalid',
      8_000,
    );
    if (parseInt(invalidBefore.trim(), 10) > 0) {
      await mik.sshExec(
        ':foreach i in=[/ip/firewall/filter/find where comment~"hub-rate-limit" and invalid] do={/ip/firewall/filter/remove $i}',
        10_000,
      );
      changed = true;
    }

    const baseAdds = [
      {
        comment: BASE_RULE_COMMENTS[0],
        cmd: `/ip firewall filter add chain=input in-interface=all-ppp src-address-list=hub-scan-deny action=drop comment=${BASE_RULE_COMMENTS[0]} place-before=${SCAN_DROP_PLACE_BEFORE}`,
      },
      {
        comment: BASE_RULE_COMMENTS[1],
        cmd: `/ip firewall filter add chain=input in-interface=all-ppp protocol=tcp connection-state=new dst-port=${httpFrom}-${httpTo} connection-limit=60,32 action=drop comment=${BASE_RULE_COMMENTS[1]} place-before=${PROXY_PLACE_BEFORE}`,
      },
      {
        comment: BASE_RULE_COMMENTS[2],
        cmd: `/ip firewall filter add chain=input in-interface=all-ppp protocol=tcp connection-state=new dst-port=${socksFrom}-${socksTo} connection-limit=60,32 action=drop comment=${BASE_RULE_COMMENTS[2]} place-before=${PROXY_PLACE_BEFORE}`,
      },
    ];
    for (const { comment, cmd } of baseAdds) {
      const n = await mik.sshExec(
        `/ip firewall filter print count-only where comment=${comment}`,
        5_000,
      );
      if (parseInt(n.trim(), 10) > 0) continue;
      await mik.sshExec(cmd, 10_000);
      changed = true;
    }

    const ifaceSet = new Set(ifaces);
    for (const ifn of ifaces) {
      for (const [suffix, range] of [
        ['http', `${httpFrom}-${httpTo}`],
        ['socks', `${socksFrom}-${socksTo}`],
      ] as const) {
        const cmt = synComment(ifn, suffix);
        const n = await mik.sshExec(
          `/ip firewall filter print count-only where comment=${cmt}`,
          5_000,
        );
        if (parseInt(n.trim(), 10) > 0) continue;
        await mik.sshExec(
          `/ip firewall filter add chain=input in-interface=${ifn} protocol=tcp tcp-flags=syn connection-state=new dst-port=${range} limit=40,32:packet action=drop comment=${cmt} place-before=${SYN_PLACE_BEFORE}`,
          8_000,
        );
        changed = true;
      }
    }

    const filterRows = await mik.restGet('/rest/ip/firewall/filter').catch(() => []);
    const synRows = Array.isArray(filterRows)
      ? filterRows.filter((r: Record<string, unknown>) => {
          const c = String(r.comment || '');
          return c.startsWith('hub-rate-limit-syn-pppoe-out');
        })
      : [];
    for (const row of synRows) {
      const c = String((row as Record<string, unknown>).comment || '');
      const m = c.match(/^hub-rate-limit-syn-(pppoe-out\d+)-(http|socks)$/);
      if (!m) continue;
      if (!ifaceSet.has(m[1])) {
        const id = (row as Record<string, unknown>)['.id'];
        if (id) {
          await mik.sshExec(`/ip firewall filter remove ${id}`, 5_000);
          changed = true;
        }
      }
    }

    this.lastIfaceKey = ifaceKey;

    const count = await mik.sshExec(
      '/ip firewall filter print count-only where comment~"hub-rate-limit"',
      8_000,
    );
    logger.info(
      { rules: count.trim(), pppoeOut: ifaces.length, changed },
      'proxy rate-limit sync',
    );
    return changed;
  }
}

export const hubRateLimitService = new HubRateLimitService();