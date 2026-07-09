// Proxy CRUD service
import { Prisma, ProxyUser } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { getMikrotikService } from '../mikrotik/MikrotikService';
import { config } from '../../lib/config';
import { logger } from '../../lib/logger';
import { realtimeHub } from '../../realtime/hub';
import { routerQueue } from '../../lib/queue';
import { randomPassword, randomUsername, usernameSchema, passwordSchema, sanitizeNote } from '../../lib/validation';
import {
  computePorts,
  firewallCommentHttp,
  firewallCommentInputHttp,
  firewallCommentInputSocks,
  firewallCommentSocks,
  LEGACY_FIREWALL_COMMENTS,
  LEGACY_PROXY_RAW_COMMENTS,
  maxPppoeIdx,
  vethIpsForIdx,
} from '../../lib/networkUtils';
import { assertProxyPoolPppoe, isExcludedPppoe } from '../../lib/pppoeUtils';
import {
  hubContainerName,
  hubShardGw,
  hubShardId,
  hubSlotIp,
  hubVethName,
  isHubContainerName,
  hubSrcnatComment,
  isHubMode,
} from '../../lib/hubUtils';
import { hubProxyService } from './HubProxyService';
import { hubRateLimitService } from './HubRateLimitService';
import { syncHubConfig } from './HubConfigService';
import { resolveProxyEgress } from '../../lib/proxyEgressUtils';
import { z } from 'zod';

const MAX_PPPOE_IDX = maxPppoeIdx();

export const createProxySchema = z.object({
  pppoeIdx: z.number().int().min(1).max(MAX_PPPOE_IDX),
  proxyType: z.enum(['http', 'socks5', 'both']).default('both'),
  httpPort: z.number().int().min(20000).max(65535).optional(),
  socksPort: z.number().int().min(21000).max(65535).optional(),
  extHttpPort: z.number().int().min(30055).max(65535).optional(),
  extSocksPort: z.number().int().min(31055).max(65535).optional(),
  username: usernameSchema.optional(),
  password: z.string().min(6).max(64).optional(),
  note: z.string().max(255).optional(),
});

export const updateProxySchema = z.object({
  enabled: z.boolean().optional(),
  proxyType: z.enum(['http', 'socks5', 'both']).optional(),
  username: usernameSchema.optional(),
  password: z.string().min(6).max(64).optional(),
  note: z.string().max(255).optional(),
});

export interface CreateProxyInput {
  pppoeIdx: number;
  proxyType?: 'http' | 'socks5' | 'both';
  httpPort?: number;
  socksPort?: number;
  extHttpPort?: number;
  extSocksPort?: number;
  username?: string;
  password?: string;
  note?: string;
  /** IP WAN đã biết từ bước enable — tránh peek/SSH thừa khi apply hub */
  wanIp?: string | null;
}

export interface ApplyProxyOpts {
  wanIp?: string | null;
}

let legacyFirewallRangesRemoved = false;

function warn(self: any, label: string, e: any) {
  logger.warn({ err: e?.message || String(e), label }, 'cleanup warning');
}

class ProxyService {
  // ============ READ ============
  async list(opts?: { search?: string; status?: string }) {
    const where: Prisma.ProxyUserWhereInput = {};
    if (opts?.search) {
      where.OR = [
        { pppoeName: { contains: opts.search } },
        { username: { contains: opts.search } },
        { containerName: { contains: opts.search } },
        { publicIp: { contains: opts.search } },
      ];
    }
    if (opts?.status) where.status = opts.status;
    return prisma.proxyUser.findMany({
      where,
      orderBy: { pppoeIdx: 'asc' },
      include: {
        ipHistory: { orderBy: { createdAt: 'desc' }, take: 5 },
        healthChecks: { orderBy: { checkedAt: 'desc' }, take: 3 },
      },
    });
  }

  async getById(id: number) {
    return prisma.proxyUser.findUnique({
      where: { id },
      include: {
        ipHistory: { orderBy: { createdAt: 'desc' }, take: 20 },
        healthChecks: { orderBy: { checkedAt: 'desc' }, take: 20 },
      },
    });
  }

  async getByPppoeIdx(idx: number) {
    return prisma.proxyUser.findUnique({ where: { pppoeIdx: idx } });
  }

  // ============ CREATE ============
  async create(input: CreateProxyInput) {
    const parsed = createProxySchema.parse(input);
    const pppoeName = `pppoe-out${parsed.pppoeIdx}`;
    assertProxyPoolPppoe(pppoeName, parsed.pppoeIdx);
    // Sanitize note before DB write
    if (input.note) (input as any).note = sanitizeNote(input.note);

    // Check existing
    const existing = await prisma.proxyUser.findUnique({ where: { pppoeIdx: parsed.pppoeIdx } });
    if (existing) throw new Error(`Proxy for pppoe-out${parsed.pppoeIdx} already exists`);

    const ports = computePorts(parsed.pppoeIdx);
    const username = parsed.username || randomUsername('u');
    const password = parsed.password || randomPassword(12);

    const hub = isHubMode();
    const proxy = await prisma.proxyUser.create({
      data: {
        pppoeIdx: parsed.pppoeIdx,
        pppoeName: ports.pppoeName,
        egressPppoeName: ports.pppoeName,
        vethName: hub ? hubVethName(hubShardId(parsed.pppoeIdx)) : ports.vethName,
        vethIp: hub ? `${hubSlotIp(parsed.pppoeIdx)}/32` : ports.vethIp,
        gatewayIp: hub ? `${hubShardGw(hubShardId(parsed.pppoeIdx))}/24` : ports.gatewayIp,
        proxyType: parsed.proxyType || 'both',
        httpPort: parsed.httpPort || ports.httpPort,
        socksPort: parsed.socksPort || ports.socksPort,
        extHttpPort: parsed.extHttpPort || ports.extHttpPort,
        extSocksPort: parsed.extSocksPort || ports.extSocksPort,
        containerName: hub ? hubContainerName(hubShardId(parsed.pppoeIdx)) : ports.containerName,
        username,
        password,
        note: parsed.note || null,
        enabled: true,
        status: 'pending',
        statusMessage: 'queued for apply',
      },
    });

    realtimeHub.broadcast({ type: 'proxy.created', payload: { id: proxy.id, pppoeIdx: proxy.pppoeIdx } });

    // Apply to Mikrotik (async, queued) — log chi tiết để debug silent fail
    void routerQueue.enqueue(async () => {
      try {
        logger.info({ proxyId: proxy.id, pppoeIdx: proxy.pppoeIdx }, 'applyToMikrotik starting');
        await this.applyToMikrotik(proxy.id);
        logger.info({ proxyId: proxy.id }, 'applyToMikrotik OK');
      } catch (e: any) {
        logger.error({ err: e.message, stack: e.stack, proxyId: proxy.id }, 'applyToMikrotik FAILED');
        // Update DB so user sees error status instead of pending forever
        try {
          await prisma.proxyUser.update({
            where: { id: proxy.id },
            data: { status: 'error', statusMessage: `apply failed: ${e.message?.slice(0, 200)}` },
          });
          realtimeHub.broadcast({ type: 'proxy.status', payload: { id: proxy.id, status: 'error', error: e.message } });
        } catch (e2: any) {
          logger.error({ err: e2.message }, 'failed to update status after apply error');
        }
      }
    });

    return proxy;
  }

  // ============ UPDATE ============
  async update(id: number, input: z.infer<typeof updateProxySchema>) {
    const parsed = updateProxySchema.parse(input);
    const proxy = await prisma.proxyUser.findUnique({ where: { id } });
    if (!proxy) throw new Error('Proxy not found');

    const updated = await prisma.proxyUser.update({ where: { id }, data: parsed });
    realtimeHub.broadcast({ type: 'proxy.updated', payload: { id } });

    // If credentials changed, regenerate users-N.json
    if (parsed.username || parsed.password) {
      void routerQueue.enqueue(async () => {
        try {
          await this.syncUsersJson(updated.id);
        } catch (e: any) {
          logger.error({ err: e.message, id }, 'syncUsersJson after update failed');
        }
      });
    }
    return updated;
  }

  // ============ DELETE ============
  async delete(id: number) {
    const proxy = await prisma.proxyUser.findUnique({ where: { id } });
    if (!proxy) throw new Error('Proxy not found');

    const egress = proxy.egressPppoeName || proxy.pppoeName;
    await routerQueue.enqueue(async () => {
      if (isHubMode()) {
        await hubProxyService.removeHubSlot(proxy.pppoeIdx, egress);
        await prisma.proxyUser.delete({ where: { id } });
        await syncHubConfig();
        const left = await prisma.proxyUser.count({ where: { enabled: true } });
        if (left > 0) {
          const sid = hubShardId(proxy.pppoeIdx);
          await hubProxyService.reloadHubShard(sid);
        }
      } else {
        await this.cleanupOnMikrotik(proxy.pppoeIdx);
        await prisma.proxyUser.delete({ where: { id } });
      }
    });
    realtimeHub.broadcast({ type: 'proxy.deleted', payload: { id, pppoeIdx: proxy.pppoeIdx } });
  }

  /** WAN stale TTL expired — xóa proxy + MikroTik resources + discovery state */
  async purgeByPppoeIdx(pppoeIdx: number, pppoeName?: string) {
    const name = pppoeName || `pppoe-out${pppoeIdx}`;
    if (isExcludedPppoe(name, pppoeIdx)) {
      logger.warn({ pppoeIdx, name }, 'refused purge for management PPPoE');
      return { purged: false, reason: 'management' as const };
    }

    const proxy = await prisma.proxyUser.findUnique({ where: { pppoeIdx } });
    if (proxy) {
      await this.delete(proxy.id);
    } else {
      await routerQueue.enqueue(async () => {
        await this.cleanupOnMikrotik(pppoeIdx);
      });
    }

    await prisma.wanDiscovery.deleteMany({ where: { pppoeIdx } });
    await prisma.wanStatus.deleteMany({ where: { pppoeName: name } });

    realtimeHub.broadcast({
      type: 'wan.purged',
      payload: { pppoeIdx, pppoeName: name, hadProxy: !!proxy },
    });
    logger.info({ pppoeIdx, name, hadProxy: !!proxy }, 'purged proxy by pppoe idx');
    return { purged: true, hadProxy: !!proxy };
  }

  // ============ START / STOP ============
  async start(id: number) {
    const proxy = await prisma.proxyUser.findUnique({ where: { id } });
    if (!proxy) throw new Error('Proxy not found');

    if (isHubMode()) {
      const mik = getMikrotikService();
      const pppoes = await mik.getPppoeInterfaces().catch(() => []);
      const slotWan = pppoes.find(p => p.index === proxy.pppoeIdx);
      const wanIp = slotWan?.running ? slotWan.publicIp : null;

      await routerQueue.enqueue(async () => {
        await hubProxyService.applyHubProxy(id, { wanIp });
        hubRateLimitService.scheduleApply();
      });
      const updated = await prisma.proxyUser.update({
        where: { id },
        data: { enabled: true, status: 'running' },
      });
      realtimeHub.broadcast({ type: 'proxy.status', payload: { id, status: 'running', enabled: true } });
      return updated;
    }

    await routerQueue.enqueue(async () => {
      await this.startContainer(proxy.pppoeIdx);
    });
    const updated = await prisma.proxyUser.update({
      where: { id },
      data: { enabled: true, status: 'running' },
    });
    realtimeHub.broadcast({ type: 'proxy.status', payload: { id, status: 'running' } });
    return updated;
  }

  async stop(id: number) {
    const proxy = await prisma.proxyUser.findUnique({ where: { id } });
    if (!proxy) throw new Error('Proxy not found');

    if (isHubMode()) {
      const updated = await prisma.proxyUser.update({
        where: { id },
        data: { enabled: false, status: 'stopped' },
      });
      hubRateLimitService.scheduleApply();
      realtimeHub.broadcast({ type: 'proxy.status', payload: { id, status: 'stopped', enabled: false } });
      return updated;
    }

    await routerQueue.enqueue(async () => {
      await this.stopContainer(proxy.containerName);
    });
    const updated = await prisma.proxyUser.update({
      where: { id },
      data: { enabled: false, status: 'stopped' },
    });
    realtimeHub.broadcast({ type: 'proxy.status', payload: { id, status: 'stopped' } });
    return updated;
  }

  // ============ RESTART ============
  async restart(id: number) {
    const proxy = await prisma.proxyUser.findUnique({ where: { id } });
    if (!proxy) throw new Error('Proxy not found');

    if (isHubMode()) {
      await routerQueue.enqueue(async () => {
        await syncHubConfig();
        const sid = hubShardId(proxy.pppoeIdx);
        await hubProxyService.reloadHubShard(sid);
        hubRateLimitService.scheduleApply();
      });
      realtimeHub.broadcast({ type: 'proxy.status', payload: { id, status: 'running' } });
      return { ok: true, mode: 'hub-reload' as const };
    }

    await routerQueue.enqueue(async () => {
      const mik = getMikrotikService();
      const ctnName = proxy.containerName;
      const containers = await mik.getContainers();
      const c = containers.find(x => x.name === ctnName);
      if (!c) throw new Error(`Container ${ctnName} not found`);
      if (c.status === 'running') {
        await mik.restPost('/rest/container/stop', { id: c.id });
        for (let i = 0; i < 10; i++) {
          await new Promise(r => setTimeout(r, 2000));
          const fresh = await mik.getContainers();
          const me = fresh.find(x => x.name === ctnName);
          if (me?.status === 'stopped') break;
        }
      }
      await mik.restPost('/rest/container/start', { id: c.id });
      for (let i = 0; i < 5; i++) {
        await new Promise(r => setTimeout(r, 3000));
        const fresh = await mik.getContainers();
        const me = fresh.find(x => x.name === ctnName);
        if (me?.status === 'running') {
          realtimeHub.broadcast({ type: 'proxy.status', payload: { id, status: 'running' } });
          return;
        }
      }
      throw new Error(`Container ${ctnName} không start được sau restart`);
    });
    return { ok: true, mode: 'legacy' as const };
  }

  // ============ LOGS ============
  async getLogs(id: number, lines = 100): Promise<string> {
    const proxy = await prisma.proxyUser.findUnique({ where: { id } });
    if (!proxy) throw new Error('Proxy not found');
    const mik = getMikrotikService();
    try {
      const out = await mik.sshExec(
        `/log print where message~"${proxy.containerName}"`,
        10_000,
      );
      const arr = out.split('\n').filter(Boolean);
      return arr.slice(-lines).join('\n');
    } catch (e: any) {
      return `[error reading logs: ${e.message}]`;
    }
  }

  // ============ IMPORT BULK ============
  // Parse text body: mỗi dòng = pppoeIdx (1-based) hoặc tên pppoe-outN
  // Tự động tạo proxy cho từng dòng
  async importBulk(text: string): Promise<{ created: number; skipped: number; errors: string[] }> {
    const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const errors: string[] = [];
    let created = 0, skipped = 0;
    for (const line of lines) {
      try {
        // Accept: "3", "pppoe-out3", "3,", "pppoe-out3,"
        const m = line.match(/(?:pppoe-out)?(\d{1,3})/);
        if (!m) { errors.push(`Invalid line: ${line}`); continue; }
        const idx = parseInt(m[1], 10);
        if (idx < 1 || idx > 99) { errors.push(`Out of range: ${line}`); continue; }
        // Skip if exists
        const existing = await prisma.proxyUser.findUnique({ where: { pppoeIdx: idx } });
        if (existing) { skipped++; continue; }
        // Create (background)
        await this.create({ pppoeIdx: idx, proxyType: 'both' });
        created++;
      } catch (e: any) {
        errors.push(`${line}: ${e.message}`);
      }
    }
    return { created, skipped, errors };
  }

  // ============ BULK UPDATE CREDENTIALS ============
  async bulkUpdateCredentials(
    updates: Array<{ id: number; username?: string; password?: string }>,
  ): Promise<{ updated: number; results: Array<{ id: number; pppoeIdx: number; username: string }> }> {
    if (!updates.length) throw new Error('Không có proxy nào để cập nhật');

    const byId = new Map<number, { username?: string; password?: string }>();
    for (const u of updates) {
      if (!u.username && !u.password) {
        throw new Error(`Proxy #${u.id}: cần username hoặc password`);
      }
      const prev = byId.get(u.id);
      byId.set(u.id, {
        username: u.username ?? prev?.username,
        password: u.password ?? prev?.password,
      });
    }

    const ids = [...byId.keys()];
    const proxies = await prisma.proxyUser.findMany({ where: { id: { in: ids } } });
    if (proxies.length !== ids.length) {
      const found = new Set(proxies.map(p => p.id));
      throw new Error(`Proxy không tồn tại: ${ids.filter(id => !found.has(id)).join(', ')}`);
    }

    const proxyMap = new Map(proxies.map(p => [p.id, p]));
    const finalRows: Array<{ id: number; username: string; password: string }> = [];

    for (const [id, patch] of byId) {
      const p = proxyMap.get(id)!;
      const username = patch.username ?? p.username;
      const password = patch.password ?? p.password;
      usernameSchema.parse(username);
      passwordSchema.parse(password);
      finalRows.push({ id, username, password });
    }

    const finalUsernameById = new Map(finalRows.map(row => [row.id, row.username]));
    const allProxies = await prisma.proxyUser.findMany({ select: { id: true, username: true } });
    const ownerByUsername = new Map<string, number>();
    for (const p of allProxies) {
      const un = finalUsernameById.get(p.id) ?? p.username;
      const other = ownerByUsername.get(un);
      if (other !== undefined && other !== p.id) {
        throw new Error(`Username "${un}" bị trùng (proxy #${other} và #${p.id})`);
      }
      ownerByUsername.set(un, p.id);
    }

    const updatedProxies = await prisma.$transaction(
      finalRows.map(row =>
        prisma.proxyUser.update({
          where: { id: row.id },
          data: {
            username: row.username,
            password: row.password,
          },
        }),
      ),
    );

    for (const p of updatedProxies) {
      realtimeHub.broadcast({ type: 'proxy.updated', payload: { id: p.id } });
    }

    void routerQueue.enqueue(async () => {
      try {
        await this.syncCredentialsAfterBulk(updatedProxies.map(p => p.id));
      } catch (e: any) {
        logger.error({ err: e.message, count: updatedProxies.length }, 'bulk credentials sync failed');
      }
    });

    return {
      updated: updatedProxies.length,
      results: updatedProxies.map(p => ({ id: p.id, pppoeIdx: p.pppoeIdx, username: p.username })),
    };
  }

  async resolveBulkCredentialLines(text: string) {
    const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const errors: string[] = [];
    const updates: Array<{ id: number; username: string; password: string }> = [];

    for (const line of lines) {
      const parts = line.split(':');
      if (parts.length < 3) {
        errors.push(`Sai định dạng (cần idx:user:pass): ${line}`);
        continue;
      }
      const idxPart = parts[0].trim();
      const password = parts[parts.length - 1].trim();
      const username = parts.slice(1, -1).join(':').trim();
      const m = idxPart.match(/^(?:pppoe-out)?(\d{1,3})$/i);
      if (!m) {
        errors.push(`Idx không hợp lệ: ${line}`);
        continue;
      }
      const idx = parseInt(m[1], 10);
      if (idx < 1 || idx > MAX_PPPOE_IDX) {
        errors.push(`Idx ngoài phạm vi: ${line}`);
        continue;
      }
      try {
        usernameSchema.parse(username);
        passwordSchema.parse(password);
      } catch (e: any) {
        errors.push(`${line}: ${e.message}`);
        continue;
      }
      const proxy = await prisma.proxyUser.findUnique({ where: { pppoeIdx: idx } });
      if (!proxy) {
        errors.push(`Chưa có proxy cho pppoe-out${idx}: ${line}`);
        continue;
      }
      updates.push({ id: proxy.id, username, password });
    }

    if (!updates.length) {
      throw new Error(errors[0] || 'Không có dòng hợp lệ');
    }
    return { updates, errors };
  }

  private async syncCredentialsAfterBulk(proxyIds: number[]) {
    const proxies = await prisma.proxyUser.findMany({
      where: { id: { in: proxyIds } },
      orderBy: { pppoeIdx: 'asc' },
    });
    if (!proxies.length) return;

    if (isHubMode()) {
      await syncHubConfig();
      const shardIds = [...new Set(proxies.map(p => hubShardId(p.pppoeIdx)))];
      for (const sid of shardIds) {
        await hubProxyService.reloadHubShard(sid);
      }
      return;
    }

    for (const proxy of proxies) {
      await this.syncUsersJsonForProxy(proxy);
    }
  }

  private async syncUsersJsonForProxy(proxy: ProxyUser) {
    const mik = getMikrotikService();
    const users = [
      {
        i: proxy.pppoeIdx,
        ip: '',
        user: proxy.username,
        pass: proxy.password,
        enabled: proxy.enabled,
      },
    ];
    const content = JSON.stringify(users);
    await this.removeUsersJsonArtifact(proxy.pppoeIdx);
    const escaped = this.escapeRouterOsFileContents(content);
    const out = await mik.sshExec(
      `/file/add name=disk1/users-${proxy.pppoeIdx}.json contents="${escaped}"`,
      30_000,
    );
    if (out.includes('failure:')) {
      throw new Error(`users-${proxy.pppoeIdx}.json write failed: ${out.trim().slice(0, 200)}`);
    }
    await this.ensureMountDefinition(proxy.pppoeIdx);
  }

  // ============ RELOAD IP ============
  async reloadIp(id: number) {
    const proxy = await prisma.proxyUser.findUnique({ where: { id } });
    if (!proxy) throw new Error('Proxy not found');
    realtimeHub.broadcast({ type: 'proxy.reloading', payload: { id, pppoeIdx: proxy.pppoeIdx } });

    const result = await routerQueue.enqueue(async () => {
      const mik = getMikrotikService();
      const reloadIf = resolveProxyEgress(proxy);
      const newIp = await mik.reloadPppoeIp(reloadIf, 60_000);
      if (newIp === 'TIMEOUT') {
        throw new Error('PPPoE reconnect timeout - không lấy được IP mới');
      }
      if (!newIp || newIp.startsWith('169.254.')) {
        throw new Error(`PPPoE ${reloadIf} nhận IP không hợp lệ (${newIp || 'none'})`);
      }

      await prisma.ipHistory.create({
        data: {
          proxyId: proxy.id,
          oldIp: proxy.publicIp,
          newIp,
          source: 'pppoe-reconnect',
        },
      }).catch(() => {});

      if (isHubMode()) {
        await hubProxyService.finalizeHubSlotIp(proxy.pppoeIdx, reloadIf, newIp);
      } else {
        await this.updateSrcnatIp(proxy.pppoeIdx, newIp);
        await this.updateDstnatIp(proxy.pppoeIdx, newIp);
      }

      const updated = await prisma.proxyUser.update({
        where: { id },
        data: {
          publicIp: newIp,
          statusMessage: isHubMode()
            ? `hub slot ${proxy.pppoeIdx} · ${reloadIf} · ${newIp} (reload)`
            : `reload IP · ${newIp}`,
        },
      });

      realtimeHub.broadcast({
        type: 'proxy.ip-changed',
        payload: { id, pppoeIdx: proxy.pppoeIdx, newIp, oldIp: proxy.publicIp, egress: reloadIf },
      });
      return updated;
    });
    return result;
  }

  // ============ HEALTH CHECK ============
  private async isProxyContainerHealthy(proxy: ProxyUser): Promise<boolean> {
    const mik = getMikrotikService();
    const containers = await mik.getContainers();
    const ctn = containers.find(c => c.name === proxy.containerName);
    if (!ctn) return false;
    if (ctn.healthy) return true;
    const hc = (ctn.healthcheckStatus || '').toLowerCase();
    if (hc.startsWith('good')) return true;
    const st = (ctn.status || '').toLowerCase();
    // Hub: portcheck bind slot IP fail; kiểm tra shard container đang chạy
    if (isHubMode() && isHubContainerName(proxy.containerName)) {
      const sid = hubShardId(proxy.pppoeIdx);
      const shardCtn = containers.find(c => c.name === hubContainerName(sid));
      if (!shardCtn) return false;
      const shardSt = (shardCtn.status || '').toLowerCase();
      return ['running', 'r', 'healthy', 'h'].includes(shardSt);
    }
    return ['running', 'r', 'healthy', 'h'].includes(st);
  }

  /** Ping thật qua interface PPPoE (RouterOS /tool ping) — dùng cho Test + auto monitor. */
  async pingEgress(id: number, opts?: { persist?: boolean; broadcast?: boolean }) {
    const persist = opts?.persist !== false;
    const broadcast = opts?.broadcast !== false;
    const proxy = await prisma.proxyUser.findUnique({ where: { id } });
    if (!proxy) throw new Error('Proxy not found');

    const egress = proxy.egressPppoeName || proxy.pppoeName || `pppoe-out${proxy.pppoeIdx}`;
    const exitIp = proxy.publicIp;
    if (!exitIp || exitIp.startsWith('169.254.')) {
      const err = `WAN IP không hợp lệ (${exitIp || 'none'})`;
      if (persist) {
        await prisma.proxyUser.update({
          where: { id },
          data: { lastCheckAt: new Date(), statusMessage: err },
        });
      }
      if (broadcast) {
        realtimeHub.broadcast({
          type: 'proxy.health',
          payload: { id, ok: false, latencyMs: null, pingMs: null, exitIp, error: err, pppoeIdx: proxy.pppoeIdx },
        });
      }
      return { ok: false, latencyMs: null, pingMs: null, exitIp, error: err };
    }

    if (!config.wan.pingEnabled) {
      const latencyMs = 0;
      if (persist) {
        await prisma.proxyUser.update({
          where: { id },
          data: { lastCheckAt: new Date(), lastLatencyMs: latencyMs, statusMessage: `egress ${exitIp} (ping tắt)` },
        });
      }
      if (broadcast) {
        realtimeHub.broadcast({
          type: 'proxy.health',
          payload: { id, ok: true, latencyMs, pingMs: latencyMs, exitIp, error: null, pppoeIdx: proxy.pppoeIdx },
        });
      }
      return { ok: true, latencyMs, pingMs: latencyMs, exitIp, error: null };
    }

    const mik = getMikrotikService();
    const ping = await mik.pingViaInterface(egress, config.wan.pingTarget, config.wan.pingCount);
    const ok = ping.ok;
    const pingMs = ping.avgRttMs;
    const latencyMs = pingMs ?? null;
    const error = ok ? null : `Ping ${config.wan.pingTarget} qua ${egress} fail (received=${ping.received})`;

    if (persist) {
      await prisma.proxyUser.update({
        where: { id },
        data: {
          lastCheckAt: new Date(),
          lastLatencyMs: latencyMs,
          statusMessage: ok
            ? (pingMs != null ? `ping ${pingMs}ms · ${exitIp}` : `ping OK · ${exitIp}`)
            : error,
        },
      });
    }

    if (broadcast) {
      realtimeHub.broadcast({
        type: 'proxy.health',
        payload: { id, ok, latencyMs, pingMs, exitIp, error, pppoeIdx: proxy.pppoeIdx },
      });
    }

    return { ok, latencyMs, pingMs, exitIp, error };
  }

  async healthCheck(id: number) {
    const proxy = await prisma.proxyUser.findUnique({ where: { id } });
    if (!proxy) throw new Error('Proxy not found');

    let ok = false;
    let exitIp: string | null = null;
    let error: string | null = null;
    let latencyMs: number | null = null;
    let pingMs: number | null = null;

    const containerOk = await this.isProxyContainerHealthy(proxy);

    try {
      const result = await this.testProxyThroughMikrotik(proxy, containerOk);
      ok = result.ok;
      exitIp = result.exitIp;
      if (!ok) error = result.error;
    } catch (e: any) {
      error = e.message;
    }

    if (ok) {
      const ping = await this.pingEgress(id, { persist: false, broadcast: false });
      pingMs = ping.pingMs ?? null;
      latencyMs = ping.latencyMs;
      if (!ping.ok) {
        ok = false;
        error = ping.error || error;
      }
    }

    const check = await prisma.healthCheck.create({
      data: {
        proxyId: proxy.id,
        ok,
        latencyMs: ok ? latencyMs : null,
        exitIp,
        error,
      },
    });

    const showRunning = ok || (containerOk && proxy.enabled);
    await prisma.proxyUser.update({
      where: { id },
      data: {
        lastCheckAt: new Date(),
        lastLatencyMs: ok ? latencyMs : null,
        status: showRunning ? 'running' : (proxy.enabled ? 'error' : 'stopped'),
        statusMessage: ok
          ? (pingMs != null
            ? `ping ${pingMs}ms · egress ${exitIp}`
            : exitIp
              ? `healthy · egress ${exitIp}`
              : `container healthy`)
          : containerOk
            ? `container OK · egress ${proxy.publicIp}:${proxy.extHttpPort}`
            : `unhealthy: ${error?.slice(0, 180) || 'unknown'}`,
      },
    });

    realtimeHub.broadcast({
      type: 'proxy.health',
      payload: { id, ok, latencyMs, pingMs, exitIp, error, pppoeIdx: proxy.pppoeIdx },
    });

    return { ok, latencyMs, pingMs, exitIp, error };
  }

  // ============ MIKROTIK OPERATIONS ============

  /**
   * Public: đảm bảo proxy đã được apply đầy đủ trên Mikrotik
   * (veth, routing, NAT, container, start). Dùng lại cho cả
   * create-flow và auto-apply sau khi enable PPPoE từ WebUI.
   */
  async ensureApplied(proxyId: number, opts?: ApplyProxyOpts): Promise<ProxyUser> {
    return routerQueue.enqueue(async () => {
      await this.applyToMikrotik(proxyId, opts);
      const fresh = await prisma.proxyUser.findUnique({ where: { id: proxyId } });
      if (!fresh) throw new Error('Proxy not found after apply');
      return fresh;
    });
  }

  /**
   * Public: tạo proxy + apply ngay lập tức (sync, dùng cho WebUI flow).
   * Khác create() ở chỗ: KHÔNG return sớm khi apply chưa xong —
   * đợi apply xong để caller biết thành công/thất bại.
   */
  async createAndApply(input: CreateProxyInput): Promise<ProxyUser> {
    const parsed = createProxySchema.parse(input);
    const pppoeName = `pppoe-out${parsed.pppoeIdx}`;
    assertProxyPoolPppoe(pppoeName, parsed.pppoeIdx);
    if (input.note) (input as CreateProxyInput & { note?: string }).note = sanitizeNote(input.note);

    const existing = await prisma.proxyUser.findUnique({ where: { pppoeIdx: parsed.pppoeIdx } });
    if (existing) throw new Error(`Proxy for pppoe-out${parsed.pppoeIdx} already exists`);

    const ports = computePorts(parsed.pppoeIdx);
    const username = parsed.username || randomUsername('u');
    const password = parsed.password || randomPassword(12);
    const hub = isHubMode();

    const proxy = await prisma.proxyUser.create({
      data: {
        pppoeIdx: parsed.pppoeIdx,
        pppoeName: ports.pppoeName,
        egressPppoeName: ports.pppoeName,
        vethName: hub ? hubVethName(hubShardId(parsed.pppoeIdx)) : ports.vethName,
        vethIp: hub ? `${hubSlotIp(parsed.pppoeIdx)}/32` : ports.vethIp,
        gatewayIp: hub ? `${hubShardGw(hubShardId(parsed.pppoeIdx))}/24` : ports.gatewayIp,
        proxyType: parsed.proxyType || 'both',
        httpPort: parsed.httpPort || ports.httpPort,
        socksPort: parsed.socksPort || ports.socksPort,
        extHttpPort: parsed.extHttpPort || ports.extHttpPort,
        extSocksPort: parsed.extSocksPort || ports.extSocksPort,
        containerName: hub ? hubContainerName(hubShardId(parsed.pppoeIdx)) : ports.containerName,
        username,
        password,
        note: parsed.note || null,
        enabled: true,
        status: 'pending',
        statusMessage: 'applying…',
      },
    });

    realtimeHub.broadcast({ type: 'proxy.created', payload: { id: proxy.id, pppoeIdx: proxy.pppoeIdx } });

    const applyOpts: ApplyProxyOpts | undefined = input.wanIp !== undefined
      ? { wanIp: input.wanIp }
      : undefined;

    return routerQueue.enqueue(async () => {
      try {
        await this.applyToMikrotik(proxy.id, applyOpts);
        const fresh = await prisma.proxyUser.findUnique({ where: { id: proxy.id } });
        if (!fresh) throw new Error('Proxy not found after apply');
        if (fresh.status === 'error') {
          throw new Error(fresh.statusMessage || 'Proxy apply lỗi');
        }
        // pending = slot đã apply, chờ IP WAN (fast provision)
        return fresh;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'apply failed';
        await prisma.proxyUser.update({
          where: { id: proxy.id },
          data: { status: 'error', statusMessage: msg.slice(0, 200) },
        }).catch(() => {});
        realtimeHub.broadcast({ type: 'proxy.status', payload: { id: proxy.id, status: 'error', error: msg } });
        throw e;
      }
    });
  }

  private async applyToMikrotik(proxyId: number, opts?: ApplyProxyOpts) {
    const proxy = await prisma.proxyUser.findUnique({ where: { id: proxyId } });
    if (!proxy) throw new Error('Proxy not found');

    if (isHubMode()) {
      const { publicIp } = await hubProxyService.applyHubProxy(proxyId, { wanIp: opts?.wanIp });
      if (publicIp && publicIp !== proxy.publicIp) {
        await prisma.ipHistory.create({
          data: { proxyId: proxy.id, oldIp: proxy.publicIp, newIp: publicIp, source: 'sync' },
        }).catch(() => {});
      }
      realtimeHub.broadcast({ type: 'proxy.applied', payload: { id: proxyId, mode: 'hub' } });
      return;
    }

    const mik = getMikrotikService();

    // 1. Ensure PPPoE IP exists (don't disable, just check)
    const pppoes = await mik.getPppoeInterfaces();
    const pppoe = pppoes.find(p => p.index === proxy.pppoeIdx);
    if (!pppoe) throw new Error(`pppoe-out${proxy.pppoeIdx} không tồn tại trên router`);
    if (!pppoe.running) throw new Error(`pppoe-out${proxy.pppoeIdx} không RUNNING`);
    if (!pppoe.publicIp || pppoe.publicIp.startsWith('169.254.')) {
      throw new Error(`pppoe-out${proxy.pppoeIdx} chưa có IP public hợp lệ (${pppoe.publicIp || 'none'}) — không provision để tránh ảnh hưởng WAN khác`);
    }

    // 2. Users file + mount definition TRƯỚC khi tạo container (tránh users-N.json thành directory)
    await this.removeUsersJsonArtifact(proxy.pppoeIdx);
    await this.syncUsersJson(proxyId);
    await this.ensureMountDefinition(proxy.pppoeIdx);

    // 3. Veth, routing, NAT, firewall
    await this.ensureVethForIdx(proxy.pppoeIdx);
    await this.ensureRoutingForIdx(proxy.pppoeIdx);
    await this.ensureDstnatForIdx(proxy.pppoeIdx);
    await this.ensureFirewallForIdx(proxy.pppoeIdx);

    // 4. Container — recreate nếu envlist/port sai (RouterOS không hot-reload env)
    const expectedHttp = config.network.httpPortBase + proxy.pppoeIdx;
    const currentPort = await this.getContainerProxyPort(proxy.pppoeIdx);
    const containers = await mik.getContainers();
    const exists = containers.find(c => c.name === proxy.containerName);
    if (exists && currentPort !== null && currentPort !== expectedHttp) {
      logger.warn({ idx: proxy.pppoeIdx, currentPort, expectedHttp }, 'recreate container — wrong PROXY_PORT');
      await this.removeProxyContainer(proxy.pppoeIdx);
    }

    const afterRemove = await mik.getContainers();
    const stillExists = afterRemove.find(c => c.name === proxy.containerName);
    if (!stillExists) {
      try {
        const rootDir = `disk1/3proxy-p${proxy.pppoeIdx}`;
        const env = this.buildProxyEnv(proxy.pppoeIdx);
        const addOut = await mik.sshExec(
          `/container/add file=${config.threeProxy.tarball} interface=${proxy.vethName} root-dir=${rootDir} name=${proxy.containerName} mountlists=MOUNT_PROXY_${proxy.pppoeIdx} env=${env} logging=yes start-on-boot=no`,
          30_000,
        );
        if (addOut.includes('failure:')) {
          throw new Error(addOut.trim().slice(0, 200));
        }
        logger.info({ name: proxy.containerName }, 'container added via SSH');
        for (let i = 0; i < 12; i++) {
          await new Promise(r => setTimeout(r, 5000));
          const fresh = await mik.getContainers();
          const c = fresh.find(x => x.name === proxy.containerName);
          if (c && c.status !== 'stopped' && c.status !== 'error') break;
          if (i === 11) await new Promise(r => setTimeout(r, 5000));
        }
      } catch (e: any) {
        throw new Error(`Container create failed: ${e.message}`);
      }
    }

    await this.ensureContainerEnv(proxy.pppoeIdx);

    // Start (SSH — REST /container/start also flaky with id on some RouterOS builds)
    try {
      const all = await mik.getContainers();
      const me = all.find(c => c.name === proxy.containerName);
      if (me && me.status !== 'running') {
        await mik.sshExec(`/container/start [find name=${proxy.containerName}]`, 15_000);
        for (let i = 0; i < 10; i++) {
          await new Promise(r => setTimeout(r, 3000));
          const fresh = await mik.getContainers();
          const me2 = fresh.find(c => c.name === proxy.containerName);
          if (me2?.status === 'running') break;
          if (me2?.status === 'error' || me2?.status === 'stopped') {
            throw new Error(`Container start failed (status=${me2?.status})`);
          }
        }
      }
    } catch (e: any) {
      throw new Error(`Container start failed: ${e.message}`);
    }

    // 7. Update DB status
    await prisma.proxyUser.update({
      where: { id: proxyId },
      data: {
        status: 'running',
        publicIp: pppoe.publicIp,
        statusMessage: pppoe.publicIp ? `running, exit IP ${pppoe.publicIp}` : 'running (no IP)',
      },
    });

    if (pppoe.publicIp && pppoe.publicIp !== proxy.publicIp) {
      await prisma.ipHistory.create({
        data: { proxyId: proxy.id, oldIp: proxy.publicIp, newIp: pppoe.publicIp, source: 'sync' },
      }).catch(() => {});
    }

    realtimeHub.broadcast({ type: 'proxy.applied', payload: { id: proxyId } });
  }

  private async removeUsersJsonArtifact(idx: number) {
    const mik = getMikrotikService();
    const fname = `disk1/users-${idx}.json`;
    await mik.sshExec(`:do {/container/mounts/remove [find list=MOUNT_PROXY_${idx}]} on-error={}`, 10_000);
    await mik.sshExec(`:foreach f in=[/file/find where name="${fname}"] do={/file/remove $f}`, 10_000);
  }

  private async ensureMountDefinition(idx: number) {
    const mik = getMikrotikService();
    await mik.sshExec(`:do {/container/mounts/remove [find list=MOUNT_PROXY_${idx}]} on-error={}`, 10_000);
    await mik.sshExec(`/container/mounts/add list=MOUNT_PROXY_${idx} src=disk1/users-${idx}.json dst=/etc/3proxy/users.json`, 10_000);
  }

  private async getContainerProxyPort(idx: number): Promise<number | null> {
    const mik = getMikrotikService();
    try {
      const out = await mik.sshExec(`/container/print detail where name=proxy3p-${idx}`, 10_000);
      const m = out.match(/PROXY_PORT=(\d+)/);
      return m ? parseInt(m[1], 10) : null;
    } catch {
      return null;
    }
  }

  private async removeProxyContainer(idx: number) {
    const mik = getMikrotikService();
    const ctnName = `proxy3p-${idx}`;
    await mik.sshExec(`:do {/container/stop [find name=${ctnName}]} on-error={}`, 30_000);
    await new Promise(r => setTimeout(r, 5000));
    await mik.sshExec(`:do {/container/remove [find name=${ctnName}]} on-error={}`, 30_000);
  }

  /** One-line :if — RouterOS ssh-cmd fails on multi-line `do={ ... }` blocks. */
  private rosIf(cond: string, body: string, elseBody?: string): string {
    return elseBody
      ? `:if (${cond}) do={${body}} else={${elseBody}}`
      : `:if (${cond}) do={${body}}`;
  }

  /** Escape JSON for RouterOS /file/add contents="..." (no type= — RouterOS 7.23 rejects type=text). */
  private escapeRouterOsFileContents(content: string): string {
    return content
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '');
  }

  private async syncUsersJson(proxyId: number) {
    const proxy = await prisma.proxyUser.findUnique({ where: { id: proxyId } });
    if (!proxy) throw new Error('Proxy not found');

    if (isHubMode()) {
      const sid = hubShardId(proxy.pppoeIdx);
      await syncHubConfig();
      await hubProxyService.reloadHubShard(sid);
      return;
    }

    await this.syncUsersJsonForProxy(proxy);
  }

  private async ensureVethForIdx(idx: number) {
    const mik = getMikrotikService();
    const vethName = `veth-3p-${idx}`;
    const bridge = config.network.bridgeName;
    const { containerIp: ctnIp, gatewayIp: gw, gatewayIpCidr: cidr } = vethIpsForIdx(idx);

    // SSH-first: RouterOS REST rejects bridge/port + container "interface" on some builds
    await mik.sshExec(
      this.rosIf(
        `[:len [/interface/veth/find name=${vethName}]] = 0`,
        `/interface/veth/add name=${vethName} address=${ctnIp}/30 gateway=${gw}`,
      ),
      15_000,
    );

    await new Promise(r => setTimeout(r, 2000));

    await mik.sshExec(
      this.rosIf(
        `[:len [/interface/bridge/port/find where bridge=${bridge} interface=${vethName}]] = 0`,
        `/interface/bridge/port/add bridge=${bridge} interface=${vethName} comment=bp-${vethName}`,
      ),
      10_000,
    );

    await mik.sshExec(
      this.rosIf(
        `[:len [/ip/address/find where comment=gw-${vethName}]] = 0`,
        `/ip/address/add address=${cidr} interface=${bridge} comment=gw-${vethName}`,
      ),
      10_000,
    );
  }

  private async ensureRoutingForIdx(idx: number) {
    const mik = getMikrotikService();
    const ifName = `pppoe-out${idx}`;
    const rmark = `to_pppoe${idx}`;
    const { containerIp: ctnIp } = vethIpsForIdx(idx);
    const pppoes = await mik.getPppoeInterfaces();
    const pppoe = pppoes.find(p => p.index === idx);
    const wanIp = pppoe?.publicIp;
    if (!wanIp || wanIp.startsWith('169.254.')) {
      throw new Error(`${ifName} IP không hợp lệ (${wanIp || 'none'})`);
    }

    await mik.sshExec(
      this.rosIf(`[:len [/routing/table/find name=${rmark}]] = 0`, `/routing/table/add name=${rmark} fib`),
      10_000,
    );
    await mik.sshExec(
      this.rosIf(
        `[:len [/ip/route/find where routing-table=${rmark} dst-address=0.0.0.0/0]] = 0`,
        `/ip/route/add dst-address=0.0.0.0/0 gateway=${ifName} routing-table=${rmark} comment=multi-ip-${ifName}`,
      ),
      10_000,
    );
    await mik.sshExec(
      this.rosIf(
        `[:len [/ip/firewall/mangle/find where comment=ctn-mangle-${ifName}]] = 0`,
        `/ip/firewall/mangle/add chain=prerouting src-address=${ctnIp} action=mark-routing new-routing-mark=${rmark} passthrough=yes comment=ctn-mangle-${ifName}`,
      ),
      10_000,
    );
    await mik.sshExec(
      this.rosIf(
        `[:len [/ip/firewall/nat/find where comment=ctn-${ifName}]] = 0`,
        `/ip/firewall/nat/add chain=srcnat src-address=${ctnIp}/32 out-interface=${ifName} action=src-nat to-addresses=${wanIp} comment=ctn-${ifName}`,
        `/ip/firewall/nat/set [find comment=ctn-${ifName}] to-addresses=${wanIp}`,
      ),
      10_000,
    );
  }

  private async ensureDstnatForIdx(idx: number) {
    const mik = getMikrotikService();
    const ports = computePorts(idx);
    const ctnIp = ports.containerIp;
    const ifName = `pppoe-out${idx}`;
    assertProxyPoolPppoe(ifName, idx);

    await mik.sshExec(
      this.rosIf(
        `[:len [/ip/firewall/nat/find where comment=ctn-${ifName}-HTTP]] = 0`,
        `/ip/firewall/nat/add chain=dstnat in-interface=${ifName} dst-port=${ports.extHttpPort} protocol=tcp action=dst-nat to-addresses=${ctnIp} to-ports=${ports.httpPort} comment=ctn-${ifName}-HTTP`,
        `/ip/firewall/nat/set [find comment=ctn-${ifName}-HTTP] in-interface=${ifName}`,
      ),
      10_000,
    );
    await mik.sshExec(
      this.rosIf(
        `[:len [/ip/firewall/nat/find where comment=ctn-${ifName}-SOCKS]] = 0`,
        `/ip/firewall/nat/add chain=dstnat in-interface=${ifName} dst-port=${ports.extSocksPort} protocol=tcp action=dst-nat to-addresses=${ctnIp} to-ports=${ports.socksPort} comment=ctn-${ifName}-SOCKS`,
        `/ip/firewall/nat/set [find comment=ctn-${ifName}-SOCKS] in-interface=${ifName}`,
      ),
      10_000,
    );
  }

  private async removeLegacyFirewallRanges() {
    if (legacyFirewallRangesRemoved) return;
    legacyFirewallRangesRemoved = true;
    const mik = getMikrotikService();
    try {
      const filters = await mik.restGet('/rest/ip/firewall/filter');
      if (Array.isArray(filters)) {
        for (const f of filters) {
          if (f.comment && (LEGACY_FIREWALL_COMMENTS as readonly string[]).includes(f.comment) && f['.id']) {
            await mik.restRequest('DELETE', `/rest/ip/firewall/filter/${f['.id']}`).catch(() => {});
          }
        }
      }
      const rawRules = await mik.restGet('/rest/ip/firewall/raw');
      if (Array.isArray(rawRules)) {
        for (const r of rawRules) {
          if (r.comment && (LEGACY_PROXY_RAW_COMMENTS as readonly string[]).includes(r.comment) && r['.id']) {
            await mik.restRequest('DELETE', `/rest/ip/firewall/raw/${r['.id']}`).catch(() => {});
          }
        }
      }
      await mik.sshExec(
        ':foreach id in=[/ip/firewall/raw/find where in-interface=pppoe-wan comment~"proxy gateway"] do={/ip/firewall/raw/remove $id}',
        10_000,
      ).catch(() => {});
    } catch {}
  }

  private async ensureFirewallForIdx(idx: number) {
    const mik = getMikrotikService();
    await this.removeLegacyFirewallRanges();
    const ports = computePorts(idx);
    const ifName = `pppoe-out${idx}`;
    assertProxyPoolPppoe(ifName, idx);
    const httpComment = firewallCommentHttp(idx);
    const socksComment = firewallCommentSocks(idx);
    const inputHttpComment = firewallCommentInputHttp(idx);
    const inputSocksComment = firewallCommentInputSocks(idx);

    // Proxy inbound chỉ trên pppoe-outX — không mở cổng proxy trên pppoe-wan.
    await mik.sshExec(`:do {/ip/firewall/filter/remove [find comment=${httpComment}]} on-error={}`, 10_000);
    await mik.sshExec(`:do {/ip/firewall/filter/remove [find comment=${socksComment}]} on-error={}`, 10_000);
    await mik.sshExec(
      this.rosIf(
        `[:len [/ip/firewall/filter/find where comment=${inputHttpComment}]] = 0`,
        `/ip/firewall/filter/add chain=input connection-state=new in-interface=${ifName} dst-port=${ports.extHttpPort} protocol=tcp action=accept comment=${inputHttpComment}`,
        `/ip/firewall/filter/set [find comment=${inputHttpComment}] in-interface=${ifName}`,
      ),
      10_000,
    );
    await mik.sshExec(
      this.rosIf(
        `[:len [/ip/firewall/filter/find where comment=${inputSocksComment}]] = 0`,
        `/ip/firewall/filter/add chain=input connection-state=new in-interface=${ifName} dst-port=${ports.extSocksPort} protocol=tcp action=accept comment=${inputSocksComment}`,
        `/ip/firewall/filter/set [find comment=${inputSocksComment}] in-interface=${ifName}`,
      ),
      10_000,
    );
  }

  private async removeFirewallForIdx(idx: number) {
    const mik = getMikrotikService();
    const comments = [
      firewallCommentHttp(idx),
      firewallCommentSocks(idx),
      firewallCommentInputHttp(idx),
      firewallCommentInputSocks(idx),
    ];
    const script = comments
      .map(c => `:do {/ip/firewall/filter/remove [find comment=${c}]} on-error={}`)
      .join('\n');
    try {
      await mik.sshExec(script, 10_000);
    } catch {}
  }

  private buildProxyEnv(idx: number): string {
    const httpPort = config.network.httpPortBase + idx;
    const socksPort = config.network.socksPortBase + idx;
    return `PROXY_PORT=${httpPort},SOCKS_PORT=${socksPort}`;
  }

  /** RouterOS builds without /container/envlist — dùng env= inline trên container */
  private async ensureContainerEnv(idx: number) {
    const mik = getMikrotikService();
    const ctnName = `proxy3p-${idx}`;
    const containers = await mik.getContainers();
    if (!containers.find(c => c.name === ctnName)) return;
    const env = this.buildProxyEnv(idx);
    await mik.sshExec(
      `/container/set [find name=${ctnName}] env=${env} mountlists=MOUNT_PROXY_${idx}`,
      15_000,
    );
  }

  private async startContainer(idx: number) {
    const mik = getMikrotikService();
    const ctnName = `proxy3p-${idx}`;
    const containers = await mik.getContainers();
    const c = containers.find(x => x.name === ctnName);
    if (!c) throw new Error(`Container ${ctnName} not found`);
    if (c.status === 'running') return;
    await mik.restPost('/rest/container/start', { id: c.id });
    // Verify it's actually running within 15s
    for (let i = 0; i < 5; i++) {
      await new Promise(r => setTimeout(r, 3000));
      const fresh = await mik.getContainers();
      const me = fresh.find(x => x.name === ctnName);
      if (me?.status === 'running') return;
      if (me?.status === 'stopped' || me?.status === 'error') {
        throw new Error(`Container ${ctnName} không start được (status=${me?.status})`);
      }
    }
    throw new Error(`Container ${ctnName} không healthy sau 15s`);
  }

  private async stopContainer(ctnName: string) {
    const mik = getMikrotikService();
    const containers = await mik.getContainers();
    const c = containers.find(x => x.name === ctnName);
    if (!c) return;
    if (c.status !== 'running') return;
    await mik.restPost('/rest/container/stop', { id: c.id });
  }

  /** Hub: cập nhật srcnat theo slot idx. Legacy: theo pppoe-out idx. */
  async updateSrcnatIp(idx: number, newIp: string, egressName?: string) {
    const mik = getMikrotikService();
    if (isHubMode() && egressName) {
      try {
        await hubProxyService.finalizeHubSlotIp(idx, egressName, newIp);
        return;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.warn({ err: msg, idx, egressName, newIp }, 'updateSrcnatIp hub finalize failed');
      }
    }
    const ifName = `pppoe-out${idx}`;
    const comment = isHubMode() ? hubSrcnatComment(idx) : `ctn-${ifName}`;
    try {
      const cmd = `:local rid [/ip/firewall/nat/find comment="${comment}"]; :if ([:len $rid] > 0) do={/ip/firewall/nat/set $rid to-addresses=${newIp}; :put "srcnat updated ${comment} -> ${newIp}"}`;
      await mik.sshExec(cmd, 10_000);
      logger.info({ idx, newIp, comment }, 'updateSrcnatIp OK');
    } catch (e: any) {
      logger.warn({ err: e.message, idx, newIp }, 'updateSrcnatIp failed');
    }
  }

  async updateDstnatIp(idx: number, newIp: string) {
    // Hub: dst-nat theo in-interface egress, không theo dst-address PPPoE IP
    if (isHubMode()) return;
    // dst-nat uses Mikrotik WAN IP, not PPPoE IP, so no update needed
    // (dst-nat rules are matched on interface, not dst-address)
    // But for completeness, we could update dst-address if it was set to PPPoE IP
    const mik = getMikrotikService();
    const ifName = `pppoe-out${idx}`;
    try {
      // Check if dst-nat has a stale dst-address (shouldn't normally, but defensive)
      const cmd = `:local rid [/ip/firewall/nat/find comment="ctn-pppoe-out${idx}-HTTP"]; :if ([:len $rid] > 0) do={:local cur [/ip/firewall/nat/get $rid dst-address]; :if ([:len $cur] > 0 && $cur != "${newIp}") do={:put "dstnat dst-address=$cur differs from new IP ${newIp} (manual review needed)"}}`;
      await mik.sshExec(cmd, 5_000);
    } catch (e: any) {
      // Non-fatal
    }
  }

  private async cleanupOnMikrotik(idx: number) {
    const mik = getMikrotikService();
    const ifName = `pppoe-out${idx}`;
    const vethName = `veth-3p-${idx}`;
    const ctnName = `proxy3p-${idx}`;
    const mountName = `MOUNT_PROXY_${idx}`;
    const httpComment = firewallCommentHttp(idx);
    const socksComment = firewallCommentSocks(idx);
    const inputComment = firewallCommentInputHttp(idx);

    // SSH-first — REST container/NAT thường fail im lặng trên RouterOS builds
    try {
      await mik.sshExec(
        `:do {/container/stop [find name=${ctnName}]} on-error={}
:delay 5s
:do {/container/remove [find name=${ctnName}]} on-error={}`,
        60_000,
      );
    } catch (e: any) { warn(this, 'stop/remove container', e); }

    try {
      await mik.sshExec(
        `:do {/ip/firewall/filter/remove [find comment=${httpComment}]} on-error={}
:do {/ip/firewall/filter/remove [find comment=${socksComment}]} on-error={}
:do {/ip/firewall/filter/remove [find comment=${inputComment}]} on-error={}
:do {/ip/firewall/nat/remove [find comment~"ctn-pppoe-out${idx}"]} on-error={}
:do {/ip/firewall/nat/remove [find comment="ctn-${ifName}"]} on-error={}
:do {/ip/firewall/mangle/remove [find comment="ctn-mangle-${ifName}"]} on-error={}
:do {/ip/route/remove [find routing-table=to_pppoe${idx}]} on-error={}
:do {/routing/table/remove [find name=to_pppoe${idx}]} on-error={}
:do {/interface/bridge/port/remove [find interface=${vethName}]} on-error={}
:do {/interface/veth/remove [find name=${vethName}]} on-error={}
:do {/ip/address/remove [find comment=gw-${vethName}]} on-error={}
:do {/container/mounts/remove [find list=${mountName}]} on-error={}
:do {/container/envlist/remove [find name=ENV_3PROXY_${idx}]} on-error={}
:do {/file/remove [find name=disk1/users-${idx}.json]} on-error={}
:do {/disk/remove [find name=3proxy-p${idx}]} on-error={}`,
        30_000,
      );
    } catch (e: any) { warn(this, 'ssh cleanup bundle', e); }

    logger.info({ idx, ctnName, vethName }, 'mikrotik proxy resources cleaned');
  }

  private async testProxyThroughMikrotik(
    proxy: any,
    containerOk = false,
  ): Promise<{ ok: boolean; exitIp: string | null; error: string | null }> {
    // RouterOS 7.23: /tool fetch qua proxy/loopback/dst-nat không hoạt động từ router.
    // WebUI container cũng không route được tới 172.18.x.x.
    // Tin cậy healthcheck nội bộ của container (portcheck) + IP egress PPPoE.
    const extIp = proxy.publicIp;
    if (!extIp || extIp.startsWith('169.254.')) {
      return { ok: false, exitIp: null, error: `WAN IP không hợp lệ (${extIp || 'none'})` };
    }

    if (containerOk) {
      return { ok: true, exitIp: extIp, error: null };
    }

    const port = proxy.extHttpPort || proxy.httpPort;
    if (!port) return { ok: false, exitIp: null, error: 'Chưa cấu hình port proxy' };

    return {
      ok: false,
      exitIp: null,
      error: `Container ${proxy.containerName || 'proxy3p'} chưa healthy — kiểm tra /container trên router`,
    };
  }
}

export const proxyService = new ProxyService();