// Hub container pool — sharded hubs, N proxy slots, N egress IPs (pppoe-out1+)
import { config } from './config';
import { assertValidPppoeIdx } from './networkUtils';

/** Slots per hub shard (default 50 → 2 shards = 100 pppoe-out). */
export const HUB_SHARD_SIZE = config.hub.shardSize;
export const HUB_SHARD_COUNT = config.hub.shardCount;

/** @deprecated use hubContainerName(hubShardId(idx)) */
export const HUB_CONTAINER_NAME = 'proxy3p-hub';
/** @deprecated use hubVethName(hubShardId(idx)) */
export const HUB_VETH_NAME = 'veth-3p-hub';
/** @deprecated use hubShardGw(0) */
export const HUB_BRIDGE_GW = '172.18.0.1';
/** @deprecated use hubShardVethCidr(0) */
export const HUB_VETH_CIDR = '172.18.0.2/24';
/** @deprecated use hubShardContainerIp(0) */
export const HUB_CONTAINER_IP = HUB_VETH_CIDR.split('/')[0];
/** @deprecated use hubCfgFile(0) */
export const HUB_CFG_FILE = 'disk1/hub-3proxy.cfg';
/** @deprecated use hubSlotIpsFile(0) */
export const HUB_SLOT_IPS_FILE = 'disk1/hub-slot-ips';
/** @deprecated use hubMountList(0) */
export const HUB_MOUNT_LIST = 'MOUNT_HUB_CFG';
/** @deprecated use hubRootDir(0) */
export const HUB_ROOT_DIR = 'disk1/3proxy-hub2';
export const HUB_TARBALL = 'disk1/3proxy-hub.tar';

export function hubShardId(pppoeIdx: number): number {
  assertValidPppoeIdx(pppoeIdx);
  const sid = Math.floor((pppoeIdx - 1) / HUB_SHARD_SIZE);
  if (sid >= HUB_SHARD_COUNT) {
    throw new Error(`pppoeIdx ${pppoeIdx} vượt hub shard count (${HUB_SHARD_COUNT}×${HUB_SHARD_SIZE})`);
  }
  return sid;
}

export function hubContainerName(shardId: number): string {
  return shardId === 0 ? 'proxy3p-hub' : `proxy3p-hub-${shardId + 1}`;
}

export function hubVethName(shardId: number): string {
  return shardId === 0 ? 'veth-3p-hub' : `veth-3p-hub-${shardId + 1}`;
}

/** Gateway IP on bridge for shard subnet (172.18.0.1, 172.19.0.1, …). */
export function hubShardGw(shardId: number): string {
  const oct2 = 18 + shardId;
  return `172.${oct2}.0.1`;
}

export function hubShardVethCidr(shardId: number): string {
  const oct2 = 18 + shardId;
  return `172.${oct2}.0.2/24`;
}

export function hubShardContainerIp(shardId: number): string {
  return hubShardVethCidr(shardId).split('/')[0];
}

export function hubCfgFile(shardId: number): string {
  return shardId === 0 ? 'disk1/hub-3proxy.cfg' : `disk1/hub-3proxy-${shardId + 1}.cfg`;
}

export function hubSlotIpsFile(shardId: number): string {
  return shardId === 0 ? 'disk1/hub-slot-ips' : `disk1/hub-slot-ips-${shardId + 1}`;
}

export function hubMountList(shardId: number): string {
  return shardId === 0 ? 'MOUNT_HUB_CFG' : `MOUNT_HUB_CFG_${shardId + 1}`;
}

/** Shard 0 dùng hub2 (legacy); shard 1+ → hub3, hub4, … tránh overlap MikroTik root-dir. */
export function hubRootDir(shardId: number): string {
  return `disk1/3proxy-hub${shardId + 2}`;
}

export function isHubContainerName(name: string): boolean {
  return name === HUB_CONTAINER_NAME || /^proxy3p-hub-\d+$/.test(name);
}

/** Map running hub container name → shard id (proxy3p-hub → 0, proxy3p-hub-2 → 1). */
export function hubShardIdFromContainerName(name: string): number | null {
  if (name === HUB_CONTAINER_NAME) return 0;
  const m = name.match(/^proxy3p-hub-(\d+)$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n >= 2 ? n - 1 : null;
}

/** Slot idx (1-based) → bind IP trong subnet shard (172.18.0.2..51, 172.19.0.2..51, …). */
export function hubSlotIp(idx: number): string {
  assertValidPppoeIdx(idx);
  const shardId = hubShardId(idx);
  const slotInShard = (idx - 1) % HUB_SHARD_SIZE;
  const oct2 = 18 + shardId;
  const hostOct4 = slotInShard + 2;
  return `172.${oct2}.0.${hostOct4}`;
}

export function hubHttpPort(idx: number): number {
  return config.network.httpPortBase + idx;
}

export function hubSocksPort(idx: number): number {
  return config.network.socksPortBase + idx;
}

export function hubExtHttpPort(idx: number): number {
  return config.network.extHttpPortBase + idx;
}

export function hubExtSocksPort(idx: number): number {
  return config.network.extSocksPortBase + idx;
}

/** Port ngoài SOCKS cao nhất (hairpin/LAN rules) — theo maxPppoeOut. */
export function hubExtPortEnd(): number {
  return config.network.extSocksPortBase + config.hub.maxPppoeOut;
}

export function hubConnMark(idx: number): string {
  return `hub-slot${idx}`;
}

export function hubConnMarkComment(idx: number): string {
  return `hub-connmark-slot${idx}`;
}

export function hubMangleComment(idx: number): string {
  return `hub-mangle-slot${idx}`;
}

export function hubDstnatHttpComment(idx: number): string {
  return `hub-slot${idx}-HTTP`;
}

export function hubDstnatSocksComment(idx: number): string {
  return `hub-slot${idx}-SOCKS`;
}

/** LAN hairpin: client trong LAN → public IP egress:extPort */
export function hubLanPubHttpComment(idx: number): string {
  return `hub-lan-pub-slot${idx}-HTTP`;
}

export function hubLanPubSocksComment(idx: number): string {
  return `hub-lan-pub-slot${idx}-SOCKS`;
}

/** LAN gateway: client → 192.168.x.1:extPort (in-interface LAN) */
export function hubLanIfHttpComment(idx: number, lanIf: string): string {
  return `hub-lan-if-${lanIf}-s${idx}-HTTP`;
}

export function hubLanIfSocksComment(idx: number, lanIf: string): string {
  return `hub-lan-if-${lanIf}-s${idx}-SOCKS`;
}

export const HUB_HAIRPIN_SRCNAT_COMMENT = 'hub-hairpin-lan-srcnat';
export const HUB_FWD_LAN_COMMENT = 'hub-fwd-lan-to-containers';
export const HUB_FWD_HAIRPIN_COMMENT = 'hub-fwd-hairpin-dstnat';
export const HUB_FWD_HP_INVALID_PREFIX = 'hub-fwd-hp-invalid';
export const HUB_IN_LAN_PROXY_COMMENT = 'hub-in-lan-proxy-tcp';
export const HUB_IN_LAN_IFACE_COMMENT = 'hub-in-lan-';
export const HUB_LAN_ADDRESS_LIST = 'hub-lan';
export const HUB_WAN_ADDRESS_LIST = 'hub-wan';
export const HUB_ROUTER_ADDRESS_LIST = 'hub-router';
export const HUB_SLOT_ADDRESS_LIST = 'hub-slot-ips';
/** LAN/device policy routing: không mark traffic tới router/container/mgmt */
export const DEV_ROUTE_SKIP_ADDRESS_LIST = 'dev-route-skip';
export const DEV_MGMT_TCP_PORTS = '8088,22222,80,443,8291';
export const DEV_MGMT_BYPASS_COMMENT = 'dev-mgmt-bypass';
/** Gateway hairpin: LAN client → 192.168.x.1:extPort */
export const HUB_HAIRPIN_GW_MARK = 'hub-hairpin-gw';
/** WAN hairpin: LAN client → public IP:extPort */
export const HUB_HAIRPIN_WAN_MARK = 'hub-hairpin-wan';
/** @deprecated use HUB_HAIRPIN_GW_MARK / HUB_HAIRPIN_WAN_MARK */
export const HUB_LAN_HAIRPIN_MARK = HUB_HAIRPIN_GW_MARK;
export const HUB_SRCNAT_LAN_HAIRPIN_COMMENT = 'hub-srcnat-lan-hairpin';
export const HUB_MANGLE_LAN_PROXY_COMMENT = 'hub-mangle-lan-proxy';
export const HUB_MANGLE_LAN_WAN_COMMENT = 'hub-mangle-lan-wan';
export const HUB_SRCNAT_LAN_PLACE_BEFORE = '[find comment="NAT: LAN -> WAN"]';

export function hubShardSubnet(shardId: number): string {
  const oct2 = 18 + shardId;
  return `172.${oct2}.0.0/24`;
}

export function hubHpGwPktMark(idx: number, proto: 'http' | 'socks'): string {
  return `hp-gw-${proto}-s${idx}`;
}

export function hubHpGwMangleComment(idx: number, proto: 'http' | 'socks'): string {
  return `hub-mangle-hp-gw-s${idx}-${proto}`;
}

export function hubHpGwSrcnatComment(idx: number, lanIf: string, proto: 'http' | 'socks'): string {
  return `hub-hp-gw-${lanIf}-s${idx}-${proto}`;
}

export function hubHpWanSrcnatComment(idx: number, proto: 'http' | 'socks'): string {
  return `hub-hp-wan-s${idx}-${proto}`;
}

/** Gateway IP (.1) của subnet LAN — client dùng IP này:extPort */
export function lanGatewayIp(subnet: string): string {
  const base = subnet.split('/')[0];
  const parts = base.split('.').map(n => parseInt(n, 10));
  parts[3] = 1;
  return parts.join('.');
}

export function hubInputHttpComment(idx: number, egressName: string): string {
  return `hub-in-http-${egressName}-s${idx}`;
}

export function hubInputSocksComment(idx: number, egressName: string): string {
  return `hub-in-socks-${egressName}-s${idx}`;
}

export function hubSrcnatComment(idx: number): string {
  return `hub-srcnat-slot${idx}`;
}

export function hubMaxConn(slotCount: number): number {
  const perSlot = config.hub.maxconnPerSlot;
  const min = config.hub.maxconnMin;
  return Math.max(min, slotCount * perSlot);
}

/** Internal 3proxy admin HTTP port per shard (bridge-only bind). */
export function hubAdminPort(shardId: number): number {
  return 31800 + shardId;
}

/** Log directory inside hub container (persists under root-dir on router). */
export const HUB_LOG_DIR_CONTAINER = '/var/log/3proxy';

/** RouterOS placeholder path prefix for hub logs (operator reference). */
export function hubLogRouterPrefix(shardId: number): string {
  return shardId === 0 ? 'disk1/hub-logs' : `disk1/hub-logs-${shardId + 1}`;
}

/** Daily rotated log file pattern for shard (used in 3proxy.cfg). */
export function hubLogFilePattern(shardId: number): string {
  const n = shardId + 1;
  return `${HUB_LOG_DIR_CONTAINER}/shard${n}-%y%m%d.log`;
}

/** Dedicated read-only admin user for WebUI metrics polling. */
export const HUB_MONITOR_USERNAME = '_webui_mon';

export function isHubMode(): boolean {
  return (config.proxy.deployMode || 'hub') === 'hub';
}