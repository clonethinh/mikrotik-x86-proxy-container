import type { ProxyUser } from '@prisma/client';

/** Interface PPPoE thực tế proxy đi ra internet (hub pool có thể ≠ slot). */
export function resolveProxyEgress(proxy: Pick<ProxyUser, 'pppoeIdx' | 'pppoeName' | 'egressPppoeName'>): string {
  return proxy.egressPppoeName || proxy.pppoeName || `pppoe-out${proxy.pppoeIdx}`;
}

export function egressIdx(egressName: string): number {
  return parseInt(egressName.replace('pppoe-out', ''), 10);
}