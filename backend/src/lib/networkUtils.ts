// Port + veth IP mapping for infinite pppoe-out pool rotation
import { config } from './config';

export const TCP_PORT_MAX = 65535;
export const PROXY_CONTAINER_ROUTE_CIDR = '172.16.0.0/12';

const PRIVATE_172_MAX_OCT2 = 31;

export function maxPppoeIdxByPort(): number {
  return TCP_PORT_MAX - config.network.extSocksPortBase;
}

export function maxPppoeIdxByIp(): number {
  const baseOct2 = parseInt(config.network.vethNetworkBase.split('.')[1] || '18', 10);
  const blocks = PRIVATE_172_MAX_OCT2 - baseOct2 + 1;
  return blocks * 255;
}

/** Hard upper bound for pppoe-out index (min of TCP port + private IP space). */
export function maxPppoeIdx(): number {
  return Math.min(maxPppoeIdxByPort(), maxPppoeIdxByIp());
}

export function assertValidPppoeIdx(idx: number): void {
  if (!Number.isInteger(idx) || idx < 1 || idx > maxPppoeIdx()) {
    throw new Error(`pppoeIdx ${idx} không hợp lệ (1..${maxPppoeIdx()})`);
  }
}

/**
 * Map pppoe-out index → /30 container subnet.
 * idx 1..255   → 172.18.1..255
 * idx 256..510 → 172.19.1..255
 * ...
 */
export function vethIpsForIdx(idx: number): {
  containerIp: string;
  gatewayIp: string;
  vethIpCidr: string;
  gatewayIpCidr: string;
} {
  assertValidPppoeIdx(idx);
  const baseOct2 = parseInt(config.network.vethNetworkBase.split('.')[1] || '18', 10);
  const slot = idx - 1;
  const oct2 = baseOct2 + Math.floor(slot / 255);
  const oct3 = (slot % 255) + 1;
  const containerIp = `172.${oct2}.${oct3}.2`;
  const gatewayIp = `172.${oct2}.${oct3}.1`;
  return {
    containerIp,
    gatewayIp,
    vethIpCidr: `${containerIp}/30`,
    gatewayIpCidr: `${gatewayIp}/30`,
  };
}

export interface ProxyPorts {
  httpPort: number;
  socksPort: number;
  extHttpPort: number;
  extSocksPort: number;
  vethName: string;
  pppoeName: string;
  containerName: string;
  vethIp: string;
  gatewayIp: string;
  containerIp: string;
}

export function computePorts(idx: number): ProxyPorts {
  assertValidPppoeIdx(idx);
  const ips = vethIpsForIdx(idx);
  return {
    httpPort: config.network.httpPortBase + idx,
    socksPort: config.network.socksPortBase + idx,
    extHttpPort: config.network.extHttpPortBase + idx,
    extSocksPort: config.network.extSocksPortBase + idx,
    vethName: `veth-3p-${idx}`,
    pppoeName: `pppoe-out${idx}`,
    containerName: `proxy3p-${idx}`,
    vethIp: ips.vethIpCidr,
    gatewayIp: ips.gatewayIpCidr,
    containerIp: ips.containerIp,
  };
}

export function firewallCommentHttp(idx: number): string {
  return `webuiproxymikrotik-fwd-http-${idx}`;
}

export function firewallCommentSocks(idx: number): string {
  return `webuiproxymikrotik-fwd-socks-${idx}`;
}

export function firewallCommentInputHttp(idx: number): string {
  return `webuiproxymikrotik-in-http-${idx}`;
}

export function firewallCommentInputSocks(idx: number): string {
  return `webuiproxymikrotik-in-socks-${idx}`;
}

export const LEGACY_FIREWALL_COMMENTS = [
  'webuiproxymikrotik-accept-proxy-range',
  'webuiproxymikrotik-accept-proxy-range-socks',
  'webuiproxymikrotik-accept-input-proxy',
  'INPUT: Allow proxy gateway HTTP',
  'INPUT: Allow proxy gateway SOCKS',
  'FWD: proxy gateway to containers',
] as const;

/** RAW/filter rules mở proxy trên pppoe-wan — phải xóa (proxy chỉ pppoe-out1+). */
export const LEGACY_PROXY_RAW_COMMENTS = [
  'RAW: allow proxy gateway HTTP on pppoe-wan',
  'RAW: allow proxy gateway SOCKS on pppoe-wan',
] as const;

/** Best-effort port lookup for UI when idx is out of supported range. */
export function safeComputePorts(idx: number): ProxyPorts | null {
  try {
    return computePorts(idx);
  } catch {
    return null;
  }
}