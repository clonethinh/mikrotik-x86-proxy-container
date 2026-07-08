// Dynamic egress pool — assign pppoe-out UP chưa được slot khác dùng
import { prisma } from '../../db/prisma';
import { getMikrotikService, type PppoeInterface } from '../mikrotik/MikrotikService';
import { isManagedPppoeName } from '../../lib/pppoeUtils';

export async function listAvailableEgress(): Promise<PppoeInterface[]> {
  const mik = getMikrotikService();
  const all = await mik.getPppoeInterfaces().catch(() => []);
  return all.filter(p => isManagedPppoeName(p.name) && p.running && p.publicIp && !p.publicIp.startsWith('169.254.'));
}

export async function listUsedEgressNames(): Promise<Set<string>> {
  const rows = await prisma.proxyUser.findMany({
    where: { status: { in: ['running', 'pending'] }, enabled: true },
    select: { egressPppoeName: true, pppoeName: true },
  });
  const used = new Set<string>();
  for (const r of rows) {
    used.add(r.egressPppoeName || r.pppoeName);
  }
  return used;
}

/** Gán egress cho slot — ưu tiên preferredIdx, fallback pool UP khác. */
export async function allocateEgress(preferredIdx: number, excludeProxyId?: number): Promise<PppoeInterface> {
  const available = await listAvailableEgress();
  if (available.length === 0) throw new Error('Không có pppoe-out UP trong pool');

  const used = await listUsedEgressNames();
  if (excludeProxyId) {
    const self = await prisma.proxyUser.findUnique({ where: { id: excludeProxyId } });
    if (self?.egressPppoeName) used.delete(self.egressPppoeName);
    else if (self?.pppoeName) used.delete(self.pppoeName);
  }

  const preferred = available.find(p => p.index === preferredIdx && !used.has(p.name));
  if (preferred) return preferred;

  const fallback = available.find(p => !used.has(p.name));
  if (fallback) return fallback;

  throw new Error(`Tất cả pppoe-out UP đã được gán (${available.length} session)`);
}

export async function releaseEgress(_name: string): Promise<void> {
  // Stateless — caller updates DB; reserved for future lease table
}

/** Fast path — luôn trả tên egress ưu tiên (pppoe-outN), không chờ UP/IP. */
export async function resolveEgressName(preferredIdx: number, excludeProxyId?: number): Promise<string> {
  try {
    const allocated = await allocateEgress(preferredIdx, excludeProxyId);
    return allocated.name;
  } catch {
    return `pppoe-out${preferredIdx}`;
  }
}