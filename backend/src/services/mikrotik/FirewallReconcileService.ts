// Firewall reconcile — audit, dọn orphan/duplicate, repair hub slots (scale-safe)
import { prisma } from '../../db/prisma';
import { config } from '../../lib/config';
import {
  extractHubSlotFromComment,
  expectedHubSlotComments,
  WEBUI_DEDUP_COMMENTS,
} from '../../lib/firewallCommentUtils';
import { logger } from '../../lib/logger';
import { routerQueue } from '../../lib/queue';
import { isHubMode } from '../../lib/hubUtils';
import { getMikrotikService } from './MikrotikService';
import { hubProxyService } from '../proxy/HubProxyService';


type FirewallChain = 'filter' | 'nat' | 'mangle';

interface FirewallRow {
  id: string;
  comment: string;
}

export interface FirewallAuditSummary {
  totals: Record<FirewallChain, number>;
  hubRules: Record<FirewallChain, number>;
  duplicates: { chain: FirewallChain; comment: string; count: number }[];
  orphans: { chain: FirewallChain; comment: string; slot: number }[];
  missing: { pppoeIdx: number; egress: string; comments: string[] }[];
  staleHubWan: { pppoe: string; address: string; id: string }[];
}

export interface FirewallReconcileResult {
  dryRun: boolean;
  repair: boolean;
  audit: FirewallAuditSummary;
  removed: Record<FirewallChain, number> & { addressList: number };
  repaired: { attempted: number; ok: number; failed: number };
  durationMs: number;
  at: string;
}

export interface FirewallReconcileStatus {
  enabled: boolean;
  intervalMs: number;
  maxSlotsPerPass: number;
  lastResult: FirewallReconcileResult | null;
  lastError: string | null;
  running: boolean;
  repairOffset: number;
}

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;
let repairOffset = 0;
let lastResult: FirewallReconcileResult | null = null;
let lastError: string | null = null;

function rowsFromRest(raw: unknown): FirewallRow[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(r => {
      const row = r as Record<string, unknown>;
      const id = row['.id'];
      if (!id) return null;
      return { id: String(id), comment: String(row.comment || '') };
    })
    .filter((x): x is FirewallRow => x !== null);
}

function groupByComment(rows: FirewallRow[]): Map<string, FirewallRow[]> {
  const map = new Map<string, FirewallRow[]>();
  for (const r of rows) {
    if (!r.comment) continue;
    const list = map.get(r.comment) || [];
    list.push(r);
    map.set(r.comment, list);
  }
  return map;
}

async function fetchFirewallTables(): Promise<Record<FirewallChain, FirewallRow[]>> {
  const mik = getMikrotikService();
  const [filter, nat, mangle] = await Promise.all([
    mik.restGet('/rest/ip/firewall/filter').catch(() => []),
    mik.restGet('/rest/ip/firewall/nat').catch(() => []),
    mik.restGet('/rest/ip/firewall/mangle').catch(() => []),
  ]);
  return {
    filter: rowsFromRest(filter),
    nat: rowsFromRest(nat),
    mangle: rowsFromRest(mangle),
  };
}

async function fetchHubWanList(): Promise<{ id: string; address: string; comment: string }[]> {
  const mik = getMikrotikService();
  const raw = await mik.restGet('/rest/ip/firewall/address-list?list=hub-wan').catch(() => []);
  if (!Array.isArray(raw)) return [];
  return raw
    .map(r => {
      const row = r as Record<string, unknown>;
      const id = row['.id'];
      if (!id) return null;
      return {
        id: String(id),
        address: String(row.address || ''),
        comment: String(row.comment || ''),
      };
    })
    .filter((x): x is { id: string; address: string; comment: string } => x !== null);
}

async function buildAudit(knownSlots: Set<number>, enabledSlots: Map<number, string>): Promise<FirewallAuditSummary> {
  const tables = await fetchFirewallTables();
  const commentIndex = new Map<string, Set<FirewallChain>>();

  for (const chain of ['filter', 'nat', 'mangle'] as const) {
    for (const r of tables[chain]) {
      if (!r.comment) continue;
      const chains = commentIndex.get(r.comment) || new Set();
      chains.add(chain);
      commentIndex.set(r.comment, chains);
    }
  }

  const duplicates: FirewallAuditSummary['duplicates'] = [];
  const orphans: FirewallAuditSummary['orphans'] = [];

  for (const chain of ['filter', 'nat', 'mangle'] as const) {
    const byComment = groupByComment(tables[chain]);
    for (const [comment, list] of byComment) {
      if (list.length > 1) {
        duplicates.push({ chain, comment, count: list.length });
      }
      const slot = extractHubSlotFromComment(comment);
      if (slot !== null && !knownSlots.has(slot)) {
        orphans.push({ chain, comment, slot });
      }
    }
  }

  const missing: FirewallAuditSummary['missing'] = [];
  for (const [pppoeIdx, egress] of enabledSlots) {
    const absent: string[] = [];
    for (const c of expectedHubSlotComments(pppoeIdx, egress)) {
      if (!commentIndex.has(c)) absent.push(c);
    }
    if (absent.length) missing.push({ pppoeIdx, egress, comments: absent });
  }

  const wanRows = await fetchHubWanList();
  const staleHubWan: FirewallAuditSummary['staleHubWan'] = [];
  const mik = getMikrotikService();
  const pppoes = await mik.getPppoeInterfaces().catch(() => []);
  const currentIpByPppoe = new Map<string, string>();
  for (const p of pppoes) {
    if (p.publicIp && p.name) currentIpByPppoe.set(p.name, p.publicIp);
  }
  for (const row of wanRows) {
    const pppoe = row.comment;
    const current = currentIpByPppoe.get(pppoe);
    if (!current || row.address === current) continue;
    staleHubWan.push({ pppoe, address: row.address, id: row.id });
  }

  const hubRules = { filter: 0, nat: 0, mangle: 0 };
  for (const chain of ['filter', 'nat', 'mangle'] as const) {
    hubRules[chain] = tables[chain].filter(r =>
      r.comment.startsWith('hub-') || r.comment.startsWith('webuiproxymikrotik-'),
    ).length;
  }

  return {
    totals: {
      filter: tables.filter.length,
      nat: tables.nat.length,
      mangle: tables.mangle.length,
    },
    hubRules,
    duplicates,
    orphans,
    missing,
    staleHubWan,
  };
}

async function removeRule(chain: FirewallChain, id: string): Promise<boolean> {
  const mik = getMikrotikService();
  try {
    await mik.restDelete(`/rest/ip/firewall/${chain}/${encodeURIComponent(id)}`);
    return true;
  } catch {
    return false;
  }
}

async function cleanup(
  audit: FirewallAuditSummary,
  dryRun: boolean,
): Promise<Record<FirewallChain, number> & { addressList: number }> {
  const removed = { filter: 0, nat: 0, mangle: 0, addressList: 0 };
  if (dryRun) return removed;

  const tables = await fetchFirewallTables();

  for (const comment of WEBUI_DEDUP_COMMENTS) {
    const chain: FirewallChain = comment.includes('dstnat') ? 'nat' : 'filter';
    const list = tables[chain].filter(r => r.comment === comment);
    if (list.length <= 1) continue;
    for (const row of list.slice(1)) {
      if (await removeRule(chain, row.id)) removed[chain]++;
    }
  }

  for (const chain of ['filter', 'nat', 'mangle'] as const) {
    const byComment = groupByComment(tables[chain]);
    for (const [, list] of byComment) {
      if (list.length <= 1) continue;
      for (const row of list.slice(1)) {
        if (await removeRule(chain, row.id)) removed[chain]++;
      }
    }
  }

  const orphanIds = new Set<string>();
  for (const o of audit.orphans) {
    const rows = tables[o.chain].filter(r => r.comment === o.comment);
    for (const r of rows) orphanIds.add(`${o.chain}:${r.id}`);
  }
  for (const key of orphanIds) {
    const [chain, id] = key.split(':') as [FirewallChain, string];
    if (await removeRule(chain, id)) removed[chain]++;
  }

  for (const stale of audit.staleHubWan) {
    const mik = getMikrotikService();
    try {
      await mik.restDelete(`/rest/ip/firewall/address-list/${encodeURIComponent(stale.id)}`);
      removed.addressList++;
    } catch { /* ignore */ }
  }

  return removed;
}

async function repairSlots(
  proxies: { pppoeIdx: number; egress: string }[],
  dryRun: boolean,
): Promise<{ attempted: number; ok: number; failed: number }> {
  const stats = { attempted: 0, ok: 0, failed: 0 };
  if (dryRun || !proxies.length) return stats;

  await hubProxyService.ensureHubLanAccess({ force: true });

  for (const p of proxies) {
    stats.attempted++;
    try {
      await hubProxyService.ensureHubSlot(p.pppoeIdx, p.egress, { allowPendingIp: true });
      stats.ok++;
    } catch (e: unknown) {
      stats.failed++;
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn({ err: msg.slice(0, 120), pppoeIdx: p.pppoeIdx }, 'firewall reconcile slot repair failed');
    }
  }

  return stats;
}

async function loadProxyMaps(): Promise<{
  knownSlots: Set<number>;
  enabledProxies: { pppoeIdx: number; egress: string }[];
}> {
  const rows = await prisma.proxyUser.findMany({ orderBy: { pppoeIdx: 'asc' } });
  const knownSlots = new Set(rows.map(r => r.pppoeIdx));
  const enabledSlots = new Map<number, string>();
  const enabledProxies: { pppoeIdx: number; egress: string }[] = [];

  for (const r of rows) {
    const egress = r.egressPppoeName || r.pppoeName || `pppoe-out${r.pppoeIdx}`;
    if (r.enabled) {
      enabledSlots.set(r.pppoeIdx, egress);
      enabledProxies.push({ pppoeIdx: r.pppoeIdx, egress });
    }
  }

  return { knownSlots, enabledProxies };
}

export async function runFirewallReconcile(opts?: {
  dryRun?: boolean;
  repair?: boolean;
  repairAll?: boolean;
}): Promise<FirewallReconcileResult> {
  if (!isHubMode()) {
    throw new Error('Firewall reconcile chỉ hỗ trợ hub mode');
  }
  if (config.deployTarget !== 'router') {
    throw new Error('Firewall reconcile chỉ chạy trên router deploy');
  }

  const dryRun = opts?.dryRun ?? false;
  const repair = opts?.repair ?? true;
  const repairAll = opts?.repairAll ?? false;
  const t0 = Date.now();

  const { knownSlots, enabledProxies } = await loadProxyMaps();
  const enabledMap = new Map(enabledProxies.map(p => [p.pppoeIdx, p.egress]));
  const audit = await buildAudit(knownSlots, enabledMap);

  const removed = await cleanup(audit, dryRun);

  let repairBatch = enabledProxies;
  if (repair && !repairAll && enabledProxies.length > config.firewallReconcile.maxSlotsPerPass) {
    const max = config.firewallReconcile.maxSlotsPerPass;
    const start = repairOffset % enabledProxies.length;
    repairBatch = [];
    for (let i = 0; i < max && i < enabledProxies.length; i++) {
      repairBatch.push(enabledProxies[(start + i) % enabledProxies.length]);
    }
    repairOffset = (start + repairBatch.length) % Math.max(enabledProxies.length, 1);
  }

  const repaired = repair
    ? await repairSlots(repairAll ? enabledProxies : repairBatch, dryRun)
    : { attempted: 0, ok: 0, failed: 0 };

  const result: FirewallReconcileResult = {
    dryRun,
    repair,
    audit,
    removed,
    repaired,
    durationMs: Date.now() - t0,
    at: new Date().toISOString(),
  };

  lastResult = result;
  lastError = null;

  logger.info(
    {
      dryRun,
      removed,
      repaired,
      orphans: audit.orphans.length,
      missing: audit.missing.length,
      duplicates: audit.duplicates.length,
      durationMs: result.durationMs,
    },
    'firewall reconcile done',
  );

  return result;
}

export function getFirewallReconcileStatus(): FirewallReconcileStatus {
  return {
    enabled: config.firewallReconcile.enabled,
    intervalMs: config.firewallReconcile.intervalMs,
    maxSlotsPerPass: config.firewallReconcile.maxSlotsPerPass,
    lastResult,
    lastError,
    running,
    repairOffset,
  };
}

async function periodicTick(): Promise<void> {
  if (running || routerQueue.size > 0) return;
  running = true;
  try {
    await routerQueue.enqueue(() => runFirewallReconcile({ dryRun: false, repair: true, repairAll: false }));
  } catch (e: unknown) {
    lastError = e instanceof Error ? e.message : String(e);
    logger.warn({ err: lastError.slice(0, 120) }, 'firewall reconcile periodic failed');
  } finally {
    running = false;
  }
}

export function startFirewallReconcile(): void {
  if (!config.firewallReconcile.enabled) return;
  if (!isHubMode() || config.deployTarget !== 'router') return;
  if (timer) return;

  const ms = config.firewallReconcile.intervalMs;
  timer = setInterval(() => { void periodicTick(); }, ms);
  logger.info({ intervalMs: ms, maxSlotsPerPass: config.firewallReconcile.maxSlotsPerPass }, 'firewall reconcile scheduler started');

  if (config.firewallReconcile.onBoot) {
    setTimeout(() => { void periodicTick(); }, 45_000);
  }
}

export function stopFirewallReconcile(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

export async function enqueueFirewallReconcile(opts?: {
  dryRun?: boolean;
  repair?: boolean;
  repairAll?: boolean;
}): Promise<FirewallReconcileResult> {
  return routerQueue.enqueue(() => runFirewallReconcile(opts));
}