// Hub container MikroTik ops — sharded hubs, per-slot routing/NAT
import { config } from '../../lib/config';
import {
  hubContainerName,
  hubDstnatHttpComment,
  hubDstnatSocksComment,
  hubExtHttpPort,
  hubExtPortEnd,
  hubExtSocksPort,
  hubHttpPort,
  hubInputHttpComment,
  hubInputSocksComment,
  hubLanIfHttpComment,
  hubLanIfSocksComment,
  hubLanPubHttpComment,
  hubLanPubSocksComment,
  hubMangleComment,
  hubMountList,
  hubRootDir,
  hubShardGw,
  hubShardId,
  hubShardVethCidr,
  hubSlotIp,
  hubSocksPort,
  hubSrcnatComment,
  hubVethName,
  HUB_FWD_HAIRPIN_COMMENT,
  HUB_FWD_HP_INVALID_PREFIX,
  HUB_FWD_LAN_COMMENT,
  HUB_HAIRPIN_GW_MARK,
  HUB_HAIRPIN_WAN_MARK,
  hubHpGwMangleComment,
  hubHpGwPktMark,
  hubHpGwSrcnatComment,
  hubHpWanSrcnatComment,
  HUB_IN_LAN_IFACE_COMMENT,
  HUB_IN_LAN_PROXY_COMMENT,
  HUB_LAN_ADDRESS_LIST,
  HUB_MANGLE_LAN_PROXY_COMMENT,
  HUB_MANGLE_LAN_WAN_COMMENT,
  HUB_ROUTER_ADDRESS_LIST,
  HUB_SLOT_ADDRESS_LIST,
  HUB_SRCNAT_LAN_HAIRPIN_COMMENT,
  HUB_SRCNAT_LAN_PLACE_BEFORE,
  HUB_WAN_ADDRESS_LIST,
  hubShardSubnet,
  hubShardIdFromContainerName,
  lanGatewayIp,
  HUB_SHARD_COUNT,
  HUB_TARBALL,
} from '../../lib/hubUtils';
import { assertProxyPoolPppoe } from '../../lib/pppoeUtils';
import { getMikrotikService } from '../mikrotik/MikrotikService';
import { logger } from '../../lib/logger';
import { syncHubConfig, syncHubConfigForShard } from './HubConfigService';
import { hubRateLimitService } from './HubRateLimitService';

const hubExtracted = new Map<number, boolean>();
const hubVethReady = new Map<number, boolean>();
const hubShardRunning = new Map<number, boolean>();
let hubLanAccessReady = false;
let repairAllPending: ReturnType<typeof setTimeout> | null = null;
const shardFlushPending = new Map<number, ReturnType<typeof setTimeout>>();
const shardFlushing = new Set<number>();

function rosIf(cond: string, body: string, elseBody?: string): string {
  return elseBody
    ? `:if (${cond}) do={${body}} else={${elseBody}}`
    : `:if (${cond}) do={${body}}`;
}

export class HubProxyService {
  async ensureHubVeth(shardId: number): Promise<void> {
    if (hubVethReady.get(shardId)) return;
    const mik = getMikrotikService();
    const bridge = config.network.bridgeName;
    const vethName = hubVethName(shardId);
    const vethCidr = hubShardVethCidr(shardId);
    const gw = hubShardGw(shardId);
    const gwCidr = `${gw}/24`;

    await mik.sshExec(
      rosIf(
        `[:len [/interface/veth/find name=${vethName}]] = 0`,
        `/interface/veth/add name=${vethName} address=${vethCidr} gateway=${gw}`,
      ),
      15_000,
    );
    await new Promise(r => setTimeout(r, 1500));

    await mik.sshExec(
      rosIf(
        `[:len [/interface/bridge/port/find where bridge=${bridge} interface=${vethName}]] = 0`,
        `/interface/bridge/port/add bridge=${bridge} interface=${vethName} comment=bp-${vethName}`,
      ),
      10_000,
    );
    await mik.sshExec(
      rosIf(
        `[:len [/ip/address/find where comment=gw-${vethName}]] = 0`,
        `/ip/address/add address=${gwCidr} interface=${bridge} comment=gw-${vethName}`,
      ),
      10_000,
    );
    hubVethReady.set(shardId, true);
  }

  /**
   * Fast path khi hub shard đã chạy — bỏ sync cfg (flushShard xử lý), bỏ container/set thừa.
   */
  async ensureHubShardReady(shardId: number): Promise<void> {
    if (hubShardRunning.get(shardId)) return;

    const mik = getMikrotikService();
    const ctnName = hubContainerName(shardId);
    const containers = await mik.getContainers();
    const me = containers.find(c => c.name === ctnName);

    if (!me || !hubExtracted.get(shardId)) {
      await this.ensureHubContainer(shardId);
      hubShardRunning.set(shardId, true);
      return;
    }

    await this.ensureHubVeth(shardId);
    if (me.status !== 'running') {
      await this.startHubContainer(shardId);
    }
    hubShardRunning.set(shardId, true);
  }

  async ensureHubContainer(shardId: number): Promise<void> {
    const mik = getMikrotikService();
    const ctnName = hubContainerName(shardId);
    const vethName = hubVethName(shardId);
    const mountList = hubMountList(shardId);
    const rootDir = hubRootDir(shardId);

    await this.ensureHubVeth(shardId);
    await syncHubConfigForShard(shardId);

    const containers = await mik.getContainers();
    const exists = containers.find(c => c.name === ctnName);
    const healthPort = hubHttpPort(shardId * config.hub.shardSize + 1);
    const healthEnv = `PROXY_PORT=${healthPort},SOCKS_PORT=${hubSocksPort(shardId * config.hub.shardSize + 1)}`;

    if (!exists && !hubExtracted.get(shardId)) {
      const addOut = await mik.sshExec(
        `/container/add file=${config.threeProxy.hubTarball || HUB_TARBALL} interface=${vethName} root-dir=${rootDir} name=${ctnName} mountlists=${mountList} env=${healthEnv} logging=${config.logs.containerLogging ? 'yes' : 'no'} start-on-boot=yes stop-on-unhealthy=no`,
        30_000,
      );
      if (addOut.includes('failure:')) {
        throw new Error(addOut.trim().slice(0, 200));
      }
      logger.info({ shardId, ctnName }, 'hub container added — waiting extract');
      for (let i = 0; i < 24; i++) {
        await new Promise(r => setTimeout(r, 2500));
        const fresh = await mik.getContainers();
        const c = fresh.find(x => x.name === ctnName);
        if (c && c.status !== 'stopped' && c.status !== 'error') {
          hubExtracted.set(shardId, true);
          break;
        }
        if (i === 23) await new Promise(r => setTimeout(r, 5000));
      }
      hubExtracted.set(shardId, true);
    } else if (exists) {
      hubExtracted.set(shardId, true);
      if (exists.status !== 'running') {
        await mik.sshExec(
          `/container/set [find name=${ctnName}] mountlists=${mountList} env=${healthEnv} stop-on-unhealthy=no`,
          15_000,
        ).catch(() => {});
      }
    }

    await this.startHubContainer(shardId);
    hubShardRunning.set(shardId, true);
  }

  async startHubContainer(shardId: number): Promise<void> {
    const mik = getMikrotikService();
    const ctnName = hubContainerName(shardId);
    const all = await mik.getContainers();
    const me = all.find(c => c.name === ctnName);
    if (!me) throw new Error(`${ctnName} not found`);
    if (me.status === 'running') return;

    await mik.sshExec(`/container/start [find name=${ctnName}]`, 15_000);
    for (let i = 0; i < 6; i++) {
      await new Promise(r => setTimeout(r, 1500));
      const fresh = await mik.getContainers();
      const c = fresh.find(x => x.name === ctnName);
      if (c?.status === 'running') return;
      if (c?.status === 'error' || c?.status === 'stopped') {
        throw new Error(`Hub ${ctnName} start failed (status=${c?.status})`);
      }
    }
  }

  /** Gộp sync cfg + reload — 1 lần / shard sau burst tạo proxy */
  scheduleShardFlush(shardId: number, opts?: { delayMs?: number }): void {
    const ms = opts?.delayMs ?? config.hub.reloadDebounceMs;
    const prev = shardFlushPending.get(shardId);
    if (prev) clearTimeout(prev);
    shardFlushPending.set(shardId, setTimeout(() => {
      shardFlushPending.delete(shardId);
      void this.flushShard(shardId);
    }, ms));
  }

  private async flushShard(shardId: number): Promise<void> {
    if (shardFlushing.has(shardId)) return;
    shardFlushing.add(shardId);
    try {
      await syncHubConfigForShard(shardId);
      await this.reloadHubShard(shardId);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn({ err: msg.slice(0, 120), shardId }, 'flushShard failed');
    } finally {
      shardFlushing.delete(shardId);
    }
  }

  /** Chỉ rule phụ thuộc IP WAN — gọi khi IP lên (WanWatcher), tối thiểu CPU */
  async finalizeHubSlotIp(pppoeIdx: number, egressName: string, wanIp: string): Promise<void> {
    if (!wanIp || wanIp.startsWith('169.254.')) return;
    assertProxyPoolPppoe(egressName);
    const mik = getMikrotikService();
    const script = this.buildHubSlotIpRosScript(pppoeIdx, egressName, wanIp);
    const out = await mik.sshExec(script, 20_000);
    if (out.includes('failure:')) {
      throw new Error(out.trim().slice(0, 200));
    }
    logger.info({ pppoeIdx, egressName, wanIp }, 'finalizeHubSlotIp OK');
  }

  private buildHubSlotCoreRosScript(pppoeIdx: number, egressName: string): string {
    const slotIp = hubSlotIp(pppoeIdx);
    const egressIdx = parseInt(egressName.replace('pppoe-out', ''), 10);
    const rmark = `to_pppoe${egressIdx}`;
    const mangleComment = hubMangleComment(pppoeIdx);
    const hairpinExcl = `connection-mark=!${HUB_HAIRPIN_WAN_MARK},!${HUB_HAIRPIN_GW_MARK}`;
    const httpComment = hubDstnatHttpComment(pppoeIdx);
    const socksComment = hubDstnatSocksComment(pppoeIdx);
    const extHttp = hubExtHttpPort(pppoeIdx);
    const extSocks = hubExtSocksPort(pppoeIdx);
    const intHttp = hubHttpPort(pppoeIdx);
    const intSocks = hubSocksPort(pppoeIdx);
    const inHttp = hubInputHttpComment(pppoeIdx, egressName);
    const inSocks = hubInputSocksComment(pppoeIdx, egressName);
    const routeComment = `hub-route-${egressName}`;
    const { lanInterfaces, lanSubnets } = config.network;
    const natBefore = HUB_SRCNAT_LAN_PLACE_BEFORE;

    const lines: string[] = [
      `:do {/ip/firewall/address-list/add list=${HUB_SLOT_ADDRESS_LIST} address=${slotIp} comment=hub-slot} on-error={}`,
      rosIf(`[:len [/routing/table/find name=${rmark}]] = 0`, `/routing/table/add name=${rmark} fib`),
      rosIf(
        `[:len [/ip/route/find where comment=${routeComment}]] = 0`,
        `/ip/route/add dst-address=0.0.0.0/0 gateway=${egressName} routing-table=${rmark} comment=${routeComment}`,
        `/ip/route/set [find comment=${routeComment}] gateway=${egressName} routing-table=${rmark} disabled=no`,
      ),
      rosIf(
        `[:len [/ip/firewall/mangle/find where comment=${mangleComment}]] = 0`,
        `/ip/firewall/mangle/add chain=prerouting src-address=${slotIp}/32 dst-address-list=!${HUB_LAN_ADDRESS_LIST} ${hairpinExcl} action=mark-routing new-routing-mark=${rmark} passthrough=yes comment=${mangleComment}`,
        `/ip/firewall/mangle/set [find comment=${mangleComment}] src-address=${slotIp}/32 dst-address-list=!${HUB_LAN_ADDRESS_LIST} ${hairpinExcl} new-routing-mark=${rmark}`,
      ),
      rosIf(
        `[:len [/ip/firewall/nat/find where comment=${httpComment}]] = 0`,
        `/ip/firewall/nat/add chain=dstnat in-interface=${egressName} dst-port=${extHttp} protocol=tcp action=dst-nat to-addresses=${slotIp} to-ports=${intHttp} comment=${httpComment}`,
        `/ip/firewall/nat/set [find comment=${httpComment}] in-interface=${egressName} to-addresses=${slotIp} to-ports=${intHttp}`,
      ),
      rosIf(
        `[:len [/ip/firewall/nat/find where comment=${socksComment}]] = 0`,
        `/ip/firewall/nat/add chain=dstnat in-interface=${egressName} dst-port=${extSocks} protocol=tcp action=dst-nat to-addresses=${slotIp} to-ports=${intSocks} comment=${socksComment}`,
        `/ip/firewall/nat/set [find comment=${socksComment}] in-interface=${egressName} to-addresses=${slotIp} to-ports=${intSocks}`,
      ),
      rosIf(
        `[:len [/ip/firewall/filter/find where comment=${inHttp}]] = 0`,
        `/ip/firewall/filter/add chain=input connection-state=new in-interface=${egressName} dst-port=${extHttp} protocol=tcp action=accept comment=${inHttp}`,
      ),
      rosIf(
        `[:len [/ip/firewall/filter/find where comment=${inSocks}]] = 0`,
        `/ip/firewall/filter/add chain=input connection-state=new in-interface=${egressName} dst-port=${extSocks} protocol=tcp action=accept comment=${inSocks}`,
      ),
    ];

    for (let i = 0; i < lanInterfaces.length; i++) {
      const lanIf = lanInterfaces[i];
      const gwIp = lanGatewayIp(lanSubnets[i] || lanSubnets[0]);
      const lanHttpC = hubLanIfHttpComment(pppoeIdx, lanIf);
      const lanSocksC = hubLanIfSocksComment(pppoeIdx, lanIf);
      lines.push(
        rosIf(
          `[:len [/ip/firewall/nat/find where comment=${lanHttpC}]] = 0`,
          `/ip/firewall/nat/add chain=dstnat dst-address=${gwIp}/32 dst-port=${extHttp} protocol=tcp action=dst-nat to-addresses=${slotIp} to-ports=${extHttp} comment=${lanHttpC}`,
          `/ip/firewall/nat/set [find comment=${lanHttpC}] dst-address=${gwIp}/32 to-addresses=${slotIp} to-ports=${extHttp}`,
        ),
        rosIf(
          `[:len [/ip/firewall/nat/find where comment=${lanSocksC}]] = 0`,
          `/ip/firewall/nat/add chain=dstnat dst-address=${gwIp}/32 dst-port=${extSocks} protocol=tcp action=dst-nat to-addresses=${slotIp} to-ports=${extSocks} comment=${lanSocksC}`,
          `/ip/firewall/nat/set [find comment=${lanSocksC}] dst-address=${gwIp}/32 to-addresses=${slotIp} to-ports=${extSocks}`,
        ),
      );
    }

    const moveComments = [
      hubLanPubHttpComment(pppoeIdx),
      hubLanPubSocksComment(pppoeIdx),
      ...lanInterfaces.flatMap(ifName => [
        hubLanIfHttpComment(pppoeIdx, ifName),
        hubLanIfSocksComment(pppoeIdx, ifName),
      ]),
    ];
    for (const c of moveComments) {
      lines.push(`:do {/ip/firewall/nat/move [find comment=${c}] destination=0} on-error={}`);
    }

    for (const { proto, port } of [
      { proto: 'http' as const, port: extHttp },
      { proto: 'socks' as const, port: extSocks },
    ]) {
      const pktMark = hubHpGwPktMark(pppoeIdx, proto);
      const mangleHpCmt = hubHpGwMangleComment(pppoeIdx, proto);
      lines.push(
        rosIf(
          `[:len [/ip/firewall/mangle/find where comment=${mangleHpCmt}]] = 0`,
          `/ip/firewall/mangle/add chain=postrouting action=mark-packet new-packet-mark=${pktMark} passthrough=no protocol=tcp connection-mark=${HUB_HAIRPIN_GW_MARK} src-address=${slotIp} src-port=${port} dst-address-list=${HUB_LAN_ADDRESS_LIST} comment=${mangleHpCmt}`,
        ),
      );
      for (let i = 0; i < lanInterfaces.length; i++) {
        const lanIf = lanInterfaces[i];
        const lanNet = lanSubnets[i] || lanSubnets[0];
        const gwIp = lanGatewayIp(lanNet);
        const gwCmt = hubHpGwSrcnatComment(pppoeIdx, lanIf, proto);
        lines.push(
          rosIf(
            `[:len [/ip/firewall/nat/find where comment=${gwCmt}]] = 0`,
            `/ip/firewall/nat/add chain=srcnat action=src-nat to-addresses=${gwIp} to-ports=${port} protocol=tcp packet-mark=${pktMark} src-address=${slotIp} src-port=${port} dst-address=${lanNet} comment=${gwCmt} place-before=${natBefore}`,
            `/ip/firewall/nat/set [find comment=${gwCmt}] to-addresses=${gwIp} to-ports=${port} packet-mark=${pktMark} src-address=${slotIp} src-port=${port} dst-address=${lanNet}`,
          ),
        );
      }
    }

    return lines.join('\n');
  }

  private buildHubSlotIpRosScript(pppoeIdx: number, egressName: string, wanIp: string): string {
    const slotIp = hubSlotIp(pppoeIdx);
    const srcnatComment = hubSrcnatComment(pppoeIdx);
    const extHttp = hubExtHttpPort(pppoeIdx);
    const extSocks = hubExtSocksPort(pppoeIdx);
    const lanPubHttp = hubLanPubHttpComment(pppoeIdx);
    const lanPubSocks = hubLanPubSocksComment(pppoeIdx);
    const lanList = HUB_LAN_ADDRESS_LIST;
    const natBefore = HUB_SRCNAT_LAN_PLACE_BEFORE;

    const lines: string[] = [
      `:do {/ip/firewall/address-list/add list=${HUB_WAN_ADDRESS_LIST} address=${wanIp} comment=${egressName}} on-error={}`,
      rosIf(
        `[:len [/ip/firewall/nat/find where comment=${srcnatComment}]] = 0`,
        `/ip/firewall/nat/add chain=srcnat src-address=${slotIp}/32 out-interface=${egressName} action=src-nat to-addresses=${wanIp} comment=${srcnatComment}`,
        `/ip/firewall/nat/set [find comment=${srcnatComment}] to-addresses=${wanIp} out-interface=${egressName} src-address=${slotIp}/32`,
      ),
      rosIf(
        `[:len [/ip/firewall/nat/find where comment=${lanPubHttp}]] = 0`,
        `/ip/firewall/nat/add chain=dstnat src-address-list=${lanList} dst-address=${wanIp}/32 dst-port=${extHttp} protocol=tcp action=dst-nat to-addresses=${slotIp} to-ports=${extHttp} comment=${lanPubHttp}`,
        `/ip/firewall/nat/set [find comment=${lanPubHttp}] src-address-list=${lanList} dst-address=${wanIp}/32 to-addresses=${slotIp} to-ports=${extHttp}`,
      ),
      rosIf(
        `[:len [/ip/firewall/nat/find where comment=${lanPubSocks}]] = 0`,
        `/ip/firewall/nat/add chain=dstnat src-address-list=${lanList} dst-address=${wanIp}/32 dst-port=${extSocks} protocol=tcp action=dst-nat to-addresses=${slotIp} to-ports=${extSocks} comment=${lanPubSocks}`,
        `/ip/firewall/nat/set [find comment=${lanPubSocks}] src-address-list=${lanList} dst-address=${wanIp}/32 to-addresses=${slotIp} to-ports=${extSocks}`,
      ),
    ];

    for (const { proto, port } of [
      { proto: 'http' as const, port: extHttp },
      { proto: 'socks' as const, port: extSocks },
    ]) {
      const wanCmt = hubHpWanSrcnatComment(pppoeIdx, proto);
      lines.push(
        rosIf(
          `[:len [/ip/firewall/nat/find where comment=${wanCmt}]] = 0`,
          `/ip/firewall/nat/add chain=srcnat action=src-nat to-addresses=${wanIp} to-ports=${port} protocol=tcp connection-mark=${HUB_HAIRPIN_WAN_MARK} src-address=${slotIp} src-port=${port} dst-address-list=${HUB_LAN_ADDRESS_LIST} comment=${wanCmt} place-before=${natBefore}`,
          `/ip/firewall/nat/set [find comment=${wanCmt}] to-addresses=${wanIp} to-ports=${port} connection-mark=${HUB_HAIRPIN_WAN_MARK} src-address=${slotIp} src-port=${port}`,
        ),
      );
    }

    return lines.join('\n');
  }

  async restartHubContainer(shardId: number): Promise<void> {
    const mik = getMikrotikService();
    const ctnName = hubContainerName(shardId);
    await mik.sshExec(`:do {/container/stop [find name=${ctnName}]} on-error={}`, 20_000);
    await new Promise(r => setTimeout(r, 3000));
    await this.startHubContainer(shardId);
  }

  /** Rolling reload — chỉ shard bị ảnh hưởng, không stop container. */
  async reloadHubShard(shardId: number): Promise<void> {
    const mik = getMikrotikService();
    const ctnName = hubContainerName(shardId);
    const all = await mik.getContainers();
    const me = all.find(c => c.name === ctnName);
    if (!me || me.status !== 'running') {
      await this.ensureHubContainer(shardId);
      return;
    }

    const reloadCmd = [
      'mkdir -p /var/log/3proxy 2>/dev/null || true',
      'IFACE=$(ip -4 addr show 2>/dev/null | awk \'/inet / && $NF != "lo" {print $NF; exit}\')',
      'if [ -f /etc/3proxy/hub-slot-ips ]; then',
      '  while IFS= read -r raw; do',
      '    ip=$(echo "$raw" | sed \'s/\\r//\')',
      '    [ -z "$ip" ] && continue',
      '    ip addr add "${ip}/32" dev "$IFACE" 2>/dev/null || true',
      '  done < /etc/3proxy/hub-slot-ips',
      'fi',
      'PID=$(pidof 3proxy 2>/dev/null | awk \'{print $1}\')',
      'if [ -n "$PID" ]; then kill -USR1 "$PID" 2>/dev/null; sleep 2; pgrep -x 3proxy >/dev/null && echo OK || echo FAIL',
      'else nohup /bin/3proxy /etc/3proxy/3proxy.cfg >/dev/null 2>&1 & sleep 2; pgrep -x 3proxy >/dev/null && echo OK || echo FAIL; fi',
    ].join(' ');

    const out = await mik.sshExec(
      `/container/shell ${ctnName} cmd="/bin/sh -c '${reloadCmd.replace(/'/g, "'\\''")}'"`,
      25_000,
    ).catch(() => '');

    if (!out.includes('OK')) {
      logger.warn({ shardId, out: out.slice(0, 120) }, 'reloadHubShard fallback to restart');
      await this.restartHubContainer(shardId);
    } else {
      logger.info({ shardId, ctnName }, 'reloadHubShard OK');
    }
  }

  /** NAT hairpin + forward — LAN client dùng public IP hoặc IP gateway:extPort */
  async ensureHubLanAccess(opts?: { force?: boolean }): Promise<void> {
    if (opts?.force) hubLanAccessReady = false;
    if (hubLanAccessReady) return;
    const mik = getMikrotikService();
    const { lanSubnets, lanInterfaces, containerCidr } = config.network;
    const fasttrackRef = '[find where action=fasttrack-connection]';
    const inputEarlyRef = '[find where comment="INPUT: Allow ICMP from WAN"]';

    for (const net of lanSubnets) {
      await mik.sshExec(
        `:do {/ip/firewall/address-list/add list=${HUB_LAN_ADDRESS_LIST} address=${net} comment=hub-lan} on-error={}`,
        8_000,
      );
    }

    for (let i = 0; i < lanInterfaces.length; i++) {
      const gw = lanGatewayIp(lanSubnets[i] || lanSubnets[0]);
      await mik.sshExec(
        `:do {/ip/firewall/address-list/add list=${HUB_ROUTER_ADDRESS_LIST} address=${gw} comment=hub-router} on-error={}`,
        8_000,
      );
    }

    const extBase = config.network.extHttpPortBase;
    const extEnd = hubExtPortEnd();

    const gwMark = HUB_HAIRPIN_GW_MARK;
    const wanMark = HUB_HAIRPIN_WAN_MARK;
    await mik.sshExec(
      rosIf(
        `[:len [/ip/firewall/mangle/find where comment=${HUB_MANGLE_LAN_PROXY_COMMENT}]] = 0`,
        `/ip/firewall/mangle/add chain=prerouting src-address-list=${HUB_LAN_ADDRESS_LIST} dst-address-list=${HUB_ROUTER_ADDRESS_LIST} protocol=tcp dst-port=${extBase}-${extEnd} action=mark-connection new-connection-mark=${gwMark} passthrough=yes comment=${HUB_MANGLE_LAN_PROXY_COMMENT}`,
        `/ip/firewall/mangle/set [find comment=${HUB_MANGLE_LAN_PROXY_COMMENT}] dst-port=${extBase}-${extEnd} new-connection-mark=${gwMark}`,
      ),
      10_000,
    );
    await mik.sshExec(
      rosIf(
        `[:len [/ip/firewall/mangle/find where comment=${HUB_MANGLE_LAN_WAN_COMMENT}]] = 0`,
        `/ip/firewall/mangle/add chain=prerouting src-address-list=${HUB_LAN_ADDRESS_LIST} dst-address-list=${HUB_WAN_ADDRESS_LIST} protocol=tcp dst-port=${extBase}-${extEnd} action=mark-connection new-connection-mark=${wanMark} passthrough=yes comment=${HUB_MANGLE_LAN_WAN_COMMENT}`,
        `/ip/firewall/mangle/set [find comment=${HUB_MANGLE_LAN_WAN_COMMENT}] dst-port=${extBase}-${extEnd} new-connection-mark=${wanMark}`,
      ),
      10_000,
    );
    for (const ifName of lanInterfaces) {
      const mInCmt = `${HUB_MANGLE_LAN_PROXY_COMMENT}-${ifName}`;
      await mik.sshExec(
        rosIf(
          `[:len [/ip/firewall/mangle/find where comment=${mInCmt}]] = 0`,
          `/ip/firewall/mangle/add chain=prerouting in-interface=${ifName} protocol=tcp dst-port=${extBase}-${extEnd} action=mark-connection new-connection-mark=${gwMark} passthrough=yes comment=${mInCmt}`,
          `/ip/firewall/mangle/set [find comment=${mInCmt}] dst-port=${extBase}-${extEnd} new-connection-mark=${gwMark}`,
        ),
        10_000,
      );
    }
    await mik.sshExec(
      `:do {/ip/firewall/nat/remove [find comment=${HUB_SRCNAT_LAN_HAIRPIN_COMMENT}]} on-error={}`,
      8_000,
    );

    const bridgeName = config.network.bridgeName;
    const dropInvalidRef = '[find where comment="FORWARD: Drop invalid"]';
    for (let i = 0; i < lanInterfaces.length; i++) {
      const lanIf = lanInterfaces[i];
      const lanNet = lanSubnets[i] || lanSubnets[0];
      for (let sid = 0; sid < HUB_SHARD_COUNT; sid++) {
        const hubNet = hubShardSubnet(sid);
        const invCmt = `${HUB_FWD_HP_INVALID_PREFIX}-${lanIf}-s${sid}`;
        await mik.sshExec(
          rosIf(
            `[:len [/ip/firewall/filter/find where comment=${invCmt}]] = 0`,
            `/ip/firewall/filter/add chain=forward action=accept connection-state=invalid protocol=tcp in-interface=${bridgeName} out-interface=${lanIf} src-address=${hubNet} dst-address=${lanNet} comment=${invCmt} place-before=${dropInvalidRef}`,
          ),
          10_000,
        );
      }
    }

    await mik.sshExec(
      rosIf(
        `[:len [/ip/firewall/filter/find where comment=${HUB_FWD_HAIRPIN_COMMENT}]] = 0`,
        `/ip/firewall/filter/add chain=forward action=accept connection-nat-state=dstnat comment=${HUB_FWD_HAIRPIN_COMMENT} place-before=${fasttrackRef}`,
      ),
      10_000,
    );
    await mik.sshExec(
      `:do {/ip/firewall/filter/move [find comment=${HUB_FWD_HAIRPIN_COMMENT}] destination=${fasttrackRef}} on-error={}`,
      8_000,
    );

    for (let i = 0; i < lanInterfaces.length; i++) {
      const ifName = lanInterfaces[i];
      const lanInCmt = `${HUB_IN_LAN_IFACE_COMMENT}${ifName}`;
      await mik.sshExec(
        rosIf(
          `[:len [/ip/firewall/filter/find where comment=${lanInCmt}]] = 0`,
          `/ip/firewall/filter/add chain=input action=accept in-interface=${ifName} comment=${lanInCmt} place-before=${inputEarlyRef}`,
        ),
        10_000,
      );

      const fwdCmt = i === 0 ? HUB_FWD_LAN_COMMENT : `${HUB_FWD_LAN_COMMENT}-${ifName}`;
      await mik.sshExec(
        rosIf(
          `[:len [/ip/firewall/filter/find where comment=${fwdCmt}]] = 0`,
          `/ip/firewall/filter/add chain=forward in-interface=${ifName} dst-address=${containerCidr} protocol=tcp action=accept comment=${fwdCmt} place-before=${fasttrackRef}`,
        ),
        10_000,
      );
      await mik.sshExec(
        `:do {/ip/firewall/filter/move [find comment=${fwdCmt}] destination=[find comment=${HUB_FWD_HAIRPIN_COMMENT}]} on-error={}`,
        8_000,
      );

      const inCmt = `${HUB_IN_LAN_PROXY_COMMENT}-${ifName}`;
      await mik.sshExec(
        rosIf(
          `[:len [/ip/firewall/filter/find where comment=${inCmt}]] = 0`,
          `/ip/firewall/filter/add chain=input in-interface=${ifName} dst-port=${extBase}-${extEnd} protocol=tcp action=accept comment=${inCmt} place-before=${inputEarlyRef}`,
          `/ip/firewall/filter/set [find comment=${inCmt}] dst-port=${extBase}-${extEnd}`,
        ),
        10_000,
      );
      await mik.sshExec(
        `:do {/ip/firewall/filter/move [find comment=${inCmt}] destination=${inputEarlyRef}} on-error={}`,
        8_000,
      );
    }
    hubLanAccessReady = true;
  }

  scheduleRepairAllHubSlots(): void {
    if (repairAllPending) return;
    repairAllPending = setTimeout(() => {
      repairAllPending = null;
      this.repairAllHubSlots().catch((e: Error) => {
        logger.warn({ err: e.message?.slice(0, 120) }, 'deferred repairAllHubSlots failed');
      });
    }, 2500);
  }

  /**
   * Apply routing/NAT cho 1 hub slot — 1 SSH round-trip (core).
   * IP WAN có thể hoãn (allowPendingIp); finalizeHubSlotIp khi IP lên.
   */
  async ensureHubSlot(
    pppoeIdx: number,
    egressName: string,
    opts?: { allowPendingIp?: boolean; wanIp?: string | null },
  ): Promise<string | null> {
    assertProxyPoolPppoe(egressName);
    const mik = getMikrotikService();
    let wanIp = opts?.wanIp;
    if (wanIp === undefined) {
      wanIp = await mik.peekPppoeIp(egressName);
    }
    const hasValidIp = !!(wanIp && !wanIp.startsWith('169.254.'));

    if (!hasValidIp && !opts?.allowPendingIp) {
      throw new Error(`${egressName} chưa có IP public hợp lệ`);
    }

    let script = this.buildHubSlotCoreRosScript(pppoeIdx, egressName);
    if (hasValidIp && wanIp) {
      script += `\n${this.buildHubSlotIpRosScript(pppoeIdx, egressName, wanIp)}`;
    }
    const out = await mik.sshExec(script, 30_000);
    if (out.includes('failure:')) {
      throw new Error(out.trim().slice(0, 200));
    }

    if (hasValidIp && wanIp) {
      return wanIp;
    }

    return null;
  }

  async removeHubSlot(pppoeIdx: number, egressName: string): Promise<void> {
    const mik = getMikrotikService();
    const comments = [
      hubMangleComment(pppoeIdx),
      hubSrcnatComment(pppoeIdx),
      hubDstnatHttpComment(pppoeIdx),
      hubDstnatSocksComment(pppoeIdx),
      hubLanPubHttpComment(pppoeIdx),
      hubLanPubSocksComment(pppoeIdx),
      hubInputHttpComment(pppoeIdx, egressName),
      hubInputSocksComment(pppoeIdx, egressName),
    ];
    for (const lanIf of config.network.lanInterfaces) {
      comments.push(hubLanIfHttpComment(pppoeIdx, lanIf));
      comments.push(hubLanIfSocksComment(pppoeIdx, lanIf));
      comments.push(hubHpGwSrcnatComment(pppoeIdx, lanIf, 'http'));
      comments.push(hubHpGwSrcnatComment(pppoeIdx, lanIf, 'socks'));
    }
    comments.push(hubHpWanSrcnatComment(pppoeIdx, 'http'));
    comments.push(hubHpWanSrcnatComment(pppoeIdx, 'socks'));
    comments.push(hubHpGwMangleComment(pppoeIdx, 'http'));
    comments.push(hubHpGwMangleComment(pppoeIdx, 'socks'));
    const removeScript = comments
      .map(c => `:do {/ip/firewall/mangle/remove [find comment=${c}]} on-error={}; :do {/ip/firewall/nat/remove [find comment=${c}]} on-error={}; :do {/ip/firewall/filter/remove [find comment=${c}]} on-error={}`)
      .join('; ');
    await mik.sshExec(removeScript, 30_000);
  }

  async repairAllHubSlots(): Promise<void> {
    await this.ensureHubLanAccess();
    const { prisma } = await import('../../db/prisma');
    const proxies = await prisma.proxyUser.findMany({
      where: { enabled: true },
      orderBy: { pppoeIdx: 'asc' },
    });
    for (const p of proxies) {
      const egress = p.egressPppoeName || p.pppoeName || `pppoe-out${p.pppoeIdx}`;
      await this.ensureHubSlot(p.pppoeIdx, egress).catch((e: Error) => {
        logger.warn({ err: e.message, pppoeIdx: p.pppoeIdx }, 'repairAllHubSlots slot failed');
      });
    }
    hubRateLimitService.scheduleApply();
  }

  async applyHubProxy(
    proxyId: number,
    opts?: { wanIp?: string | null },
  ): Promise<{ publicIp: string | null }> {
    const { prisma } = await import('../../db/prisma');

    const proxy = await prisma.proxyUser.findUnique({ where: { id: proxyId } });
    if (!proxy) throw new Error('Proxy not found');

    const egressName = proxy.egressPppoeName || proxy.pppoeName || `pppoe-out${proxy.pppoeIdx}`;

    const shardId = hubShardId(proxy.pppoeIdx);
    await this.ensureHubShardReady(shardId);
    await this.ensureHubLanAccess();
    const publicIp = await this.ensureHubSlot(proxy.pppoeIdx, egressName, {
      allowPendingIp: true,
      wanIp: opts?.wanIp,
    });
    this.scheduleShardFlush(shardId, { delayMs: config.hub.applyFlushMs });
    hubRateLimitService.scheduleApply();
    if (config.hub.repairAllOnApply) {
      this.scheduleRepairAllHubSlots();
    }

    const ctnName = hubContainerName(shardId);
    const vethName = hubVethName(shardId);
    const gw = hubShardGw(shardId);
    const running = !!publicIp;

    await prisma.proxyUser.update({
      where: { id: proxyId },
      data: {
        egressPppoeName: egressName,
        containerName: ctnName,
        vethName,
        vethIp: `${hubSlotIp(proxy.pppoeIdx)}/32`,
        gatewayIp: `${gw}/24`,
        publicIp: publicIp || null,
        status: running ? 'running' : 'pending',
        statusMessage: running
          ? `hub shard${shardId + 1} slot ${proxy.pppoeIdx} · ${egressName} · ${publicIp}`
          : `hub shard${shardId + 1} slot ${proxy.pppoeIdx} · ${egressName} · chờ IP WAN`,
      },
    });

    return { publicIp: publicIp || null };
  }

  /** Boot: cache shard đang chạy — apply tiếp theo dùng fast path ngay. */
  async warmShardCacheFromContainers(): Promise<void> {
    const mik = getMikrotikService();
    const containers = await mik.getContainers().catch(() => []);
    for (const c of containers) {
      const sid = hubShardIdFromContainerName(c.name);
      if (sid === null) continue;
      hubExtracted.set(sid, true);
      hubVethReady.set(sid, true);
      if (c.status === 'running') {
        hubShardRunning.set(sid, true);
      }
    }
  }

  /** Pre-create veth + mount placeholders for all configured shards. */
  async ensureAllHubShards(): Promise<void> {
    for (let sid = 0; sid < HUB_SHARD_COUNT; sid++) {
      await this.ensureHubVeth(sid).catch((e: Error) => {
        logger.warn({ err: e.message, shardId: sid }, 'ensureAllHubShards veth failed');
      });
    }
  }
}

export const hubProxyService = new HubProxyService();