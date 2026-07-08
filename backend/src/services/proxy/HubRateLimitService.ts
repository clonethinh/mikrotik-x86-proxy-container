// Rate-limit bot scan trên cổng proxy WAN — tự động sau mỗi lần tạo/sửa proxy hub.
// - SYN > 40/s mỗi IP → drop (per pppoe-out)
// - > 60 concurrent conn mỗi IP → drop (all-ppp)
// Idempotent — chạy lại an toàn.
import { config } from '../../lib/config';
import { logger } from '../../lib/logger';
import { getMikrotikService } from '../mikrotik/MikrotikService';

const BASE_COMMENTS = [
  'hub-rate-limit-scan-drop',
  'hub-rate-limit-http-conn',
  'hub-rate-limit-socks-conn',
  'hub-rate-limit-http-syn',
  'hub-rate-limit-socks-syn',
] as const;

const PROXY_PLACE_BEFORE = '[find comment=hub-in-http-pppoe-out1-s1]';
/** scan-drop phải trước rule accept SSH WAN — nếu không blacklist SSH không có tác dụng */
const SCAN_DROP_PLACE_BEFORE = '[find comment="INPUT: Allow port 22222 (SSH) from WAN"]';

export class HubRateLimitService {
  private pending: ReturnType<typeof setTimeout> | null = null;
  private applying = false;
  private rerunAfterCurrent = false;

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
      await this.applyOnce();
      logger.info('applyProxyRateLimit OK');
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

  private async applyOnce(): Promise<void> {
    const mik = getMikrotikService();
    const extHttp = config.network.extHttpPortBase;
    const extSocks = config.network.extSocksPortBase;
    const maxOut = config.hub.maxPppoeOut;
    const httpFrom = extHttp + 1;
    const httpTo = extHttp + maxOut;
    const socksFrom = extSocks + 1;
    const socksTo = extSocks + maxOut;

    for (const c of BASE_COMMENTS) {
      await mik.sshExec(`:do {/ip firewall filter remove [find comment=${c}]} on-error={}`, 8_000);
    }
    await mik.sshExec(
      ':do {/ip firewall filter remove [find comment~"hub-rate-limit-syn-"]} on-error={}',
      10_000,
    );
    await mik.sshExec(
      ':foreach i in=[/ip firewall/filter/find where comment~"hub-rate-limit" and invalid] do={/ip firewall/filter/remove $i}',
      10_000,
    );

    const baseRules = [
      `/ip firewall filter add chain=input in-interface=all-ppp src-address-list=hub-scan-deny action=drop comment=hub-rate-limit-scan-drop place-before=${SCAN_DROP_PLACE_BEFORE}`,
      `/ip firewall filter add chain=input in-interface=all-ppp protocol=tcp connection-state=new dst-port=${httpFrom}-${httpTo} connection-limit=60,32 action=drop comment=hub-rate-limit-http-conn place-before=${PROXY_PLACE_BEFORE}`,
      `/ip firewall filter add chain=input in-interface=all-ppp protocol=tcp connection-state=new dst-port=${socksFrom}-${socksTo} connection-limit=60,32 action=drop comment=hub-rate-limit-socks-conn place-before=${PROXY_PLACE_BEFORE}`,
    ];
    for (const cmd of baseRules) {
      await mik.sshExec(`:do {${cmd}} on-error={}`, 10_000);
    }

    const ppOut = await mik.sshExec('/interface print terse where name~"^pppoe-out"', 15_000);
    const ifaces = [...ppOut.matchAll(/name=([^\s]+)/g)]
      .map(m => m[1])
      .filter(n => /^pppoe-out\d+$/.test(n));
    const synDest = '[find comment=hub-rate-limit-scan-drop]';

    for (const ifn of ifaces) {
      for (const [suffix, range] of [
        ['http', `${httpFrom}-${httpTo}`],
        ['socks', `${socksFrom}-${socksTo}`],
      ] as const) {
        await mik.sshExec(
          `/ip firewall filter add chain=input in-interface=${ifn} protocol=tcp tcp-flags=syn connection-state=new dst-port=${range} limit=40,32:packet action=drop comment=hub-rate-limit-syn-${ifn}-${suffix} place-before=${synDest}`,
          8_000,
        );
      }
    }

    await mik.sshExec(
      `:do {/ip firewall filter move [find comment=hub-rate-limit-scan-drop] destination=${SCAN_DROP_PLACE_BEFORE}} on-error={}`,
      8_000,
    );
    for (const c of ['hub-rate-limit-http-conn', 'hub-rate-limit-socks-conn']) {
      await mik.sshExec(
        `:do {/ip firewall filter move [find comment=${c}] destination=${PROXY_PLACE_BEFORE}} on-error={}`,
        8_000,
      );
    }
    for (const ifn of ifaces) {
      for (const s of ['http', 'socks'] as const) {
        await mik.sshExec(
          `:do {/ip firewall filter move [find comment=hub-rate-limit-syn-${ifn}-${s}] destination=${PROXY_PLACE_BEFORE}} on-error={}`,
          5_000,
        );
      }
    }

    const count = await mik.sshExec(
      '/ip firewall filter print count-only where comment~"hub-rate-limit"',
      8_000,
    );
    const invalid = await mik.sshExec(
      '/ip firewall filter print count-only where comment~"hub-rate-limit" and invalid',
      8_000,
    );
    logger.info(
      { rules: count.trim(), invalid: invalid.trim(), pppoeOut: ifaces.length },
      'proxy rate-limit applied',
    );
  }
}

export const hubRateLimitService = new HubRateLimitService();