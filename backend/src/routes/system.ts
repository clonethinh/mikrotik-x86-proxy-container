// System routes - dashboard, WAN status, audit log
import type { FastifyInstance } from 'fastify';
import { prisma } from '../db/prisma';
import { getMikrotikService } from '../services/mikrotik/MikrotikService';
import { realtimeHub } from '../realtime/hub';
import { config, managementUrl } from '../lib/config';
import { maxPppoeIdx, safeComputePorts } from '../lib/networkUtils';
import { isManagedPppoeName } from '../lib/pppoeUtils';
import { audit } from '../services/audit';
import { deriveQuayipStatus, QUAYIP_STATUS_LABELS } from '../lib/quayipUtils';
import { classifyPublicIp } from '../lib/ipQualityUtils';
import {
  getRouterScriptService,
  MANAGED_ROUTER_SCRIPTS,
  type ManagedRouterScriptName,
} from '../services/mikrotik/RouterScriptService';
import { runRollupOnce } from '../services/metrics/RollupAggregator';
import { runLogTailOnce } from '../services/logs/LogTailer';
import { runDomainAggregateOnce } from '../services/logs/TopDomainAggregator';
import { syncClocks, getClockStatus } from '../services/system/ClockSyncService';
import { getRouterMonitor } from '../services/metrics/RouterMonitorService';
import { buildDashboardSnapshot } from '../services/metrics/DashboardRealtimeService';

export default async function systemRoutes(app: FastifyInstance) {
  // Dashboard stats
  app.get('/api/dashboard', { preHandler: [app.authenticate] }, async () => {
    return buildDashboardSnapshot();
  });

  app.get('/api/dashboard/router-monitor', { preHandler: [app.authenticate] }, async (req) => {
    const hours = Math.min(24, Math.max(1, parseInt(String((req.query as { hours?: string }).hours || '4'), 10) || 4));
    return getRouterMonitor(hours, { fresh: true });
  });

  // WAN status list — merged với container thực tế trên router
  app.get('/api/wan', { preHandler: [app.authenticate] }, async () => {
    const mik = getMikrotikService();
    const [pppoes, containers, dbProxies, discoveries] = await Promise.all([
      mik.getPppoeInterfaces().catch(() => []),
      mik.getContainers().catch(() => []),
      prisma.proxyUser.findMany(),
      prisma.wanDiscovery.findMany().catch(() => []),
    ]);
    const dbByIdx = new Map(dbProxies.map(p => [p.pppoeIdx, p]));
    const containerByName = new Map(containers.map(c => [c.name, c]));
    const discByIdx = new Map(discoveries.map(d => [d.pppoeIdx, d]));

    return pppoes
      .filter(p => isManagedPppoeName(p.name))
      .map(p => {
        const db = dbByIdx.get(p.index);
        const disc = discByIdx.get(p.index);
        const hubMode = config.proxy.deployMode === 'hub';
        const containerName = hubMode ? 'proxy3p-hub' : `proxy3p-${p.index}`;
        const container = containerByName.get(containerName);
        const ports = safeComputePorts(p.index);
        const hubContainer = containerByName.get('proxy3p-hub');
        const quayipStatus = deriveQuayipStatus(p.name, {
          disabled: p.disabled,
          running: p.running,
          comment: p.comment,
        });
        const ipInfo = classifyPublicIp(p.publicIp);
        return {
          ...p,
          comment: p.comment || '',
          quayipStatus,
          quayipLabel: QUAYIP_STATUS_LABELS[quayipStatus],
          ipQuality: ipInfo.quality,
          ipQualityLabel: ipInfo.label,
          ipUsable: ipInfo.usable,
          ipQualityHint: ipInfo.hint,
          extHttpPort: ports?.extHttpPort ?? config.network.extHttpPortBase + p.index,
          extSocksPort: ports?.extSocksPort ?? config.network.extSocksPortBase + p.index,
          containerIp: hubMode ? (db?.vethIp?.split('/')[0] ?? null) : (ports?.containerIp ?? null),
          containerName: hubMode ? 'proxy3p-hub' : containerName,
          egressPppoeName: db?.egressPppoeName ?? null,
          hasContainer: hubMode ? !!hubContainer : !!container,
          hubSlot: hubMode ? p.index : null,
          containerStatus: container?.status || null,
          // Hub: 1 container chung — chỉ coi là có proxy khi có row DB cho slot này
          hasProxy: hubMode ? !!db : (!!db || !!container),
          proxyId: db?.id || null,
          proxyStatus: db?.status || (hubMode ? null : (container ? 'running' : null)),
          proxyEnabled: db?.enabled ?? (hubMode ? false : !!container),
          username: db?.username || null,
          proxyType: db?.proxyType || 'both',
          lastLatencyMs: db?.lastLatencyMs ?? null,
          lastCheckAt: db?.lastCheckAt ?? null,
          vethName: db?.vethName || `veth-3p-${p.index}`,
          workflowState: disc?.workflowState || null,
          countdownEnds: disc?.countdownEnds?.toISOString() || null,
          discoveryError: disc?.error || null,
        };
      });
  });

  // Mikrotik system info
  app.get('/api/mikrotik/system', { preHandler: [app.authenticate] }, async () => {
    const mik = getMikrotikService();
    const [resource, containers] = await Promise.all([
      mik.getSystemResource().catch(() => ({})),
      mik.getContainers().catch(() => []),
    ]);
    return { resource, containers };
  });

  // Deploy target info
  app.get('/api/deploy-info', { preHandler: [app.authenticate] }, async () => {
    return {
      target: config.deployTarget,
      mikrotik: {
        host: config.mikrotik.host,
        wanHost: config.mikrotik.wanHost || null,
        managementUrl: managementUrl() || null,
      },
      threeProxy: {
        image: config.threeProxy.image,
        tarball: config.threeProxy.tarball,
      },
      network: {
        ...config.network,
        maxPppoeIdx: maxPppoeIdx(),
        portFormula: 'extHttp=30055+X, extSocks=31055+X',
        vethIpFormula: '172.(18+floor((X-1)/255)).((X-1)%255+1).2',
      },
      proxy: {
        deployMode: config.proxy.deployMode,
        hubContainer: 'proxy3p-hub',
      },
    };
  });

  // Firewall reconcile — audit orphan/duplicate, repair hub slots
  app.get('/api/system/firewall/reconcile', { preHandler: [app.authenticate] }, async (req, reply) => {
    const u = req.user as { role?: string };
    if (u.role !== 'admin') return reply.code(403).send({ error: 'admin only' });
    const { getFirewallReconcileStatus } = await import('../services/mikrotik/FirewallReconcileService');
    return getFirewallReconcileStatus();
  });

  app.post('/api/system/firewall/reconcile', { preHandler: [app.authenticate] }, async (req, reply) => {
    const u = req.user as { uid?: number; username?: string; role?: string };
    if (u.role !== 'admin') return reply.code(403).send({ error: 'admin only' });
    const body = (req.body || {}) as { dryRun?: boolean; repair?: boolean; repairAll?: boolean };
    try {
      const { enqueueFirewallReconcile } = await import('../services/mikrotik/FirewallReconcileService');
      const result = await enqueueFirewallReconcile({
        dryRun: body.dryRun === true,
        repair: body.repair !== false,
        repairAll: body.repairAll === true,
      });
      await audit({
        userId: u.uid,
        username: u.username || 'admin',
        action: 'firewall-reconcile',
        ip: req.ip,
        details: {
          dryRun: result.dryRun,
          removed: result.removed,
          repaired: result.repaired,
          orphans: result.audit.orphans.length,
          missing: result.audit.missing.length,
        },
      });
      return { ok: true, ...result };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return reply.code(400).send({ error: msg });
    }
  });

  // SSH brute-force blacklist status
  app.get('/api/system/ssh-blacklist', { preHandler: [app.authenticate] }, async () => {
    const { sshBlacklistService } = await import('../services/mikrotik/SshBlacklistService');
    const status = await sshBlacklistService.getStatus();
    return { ...status, maxFailures: config.sshBlacklist.maxFailures };
  });

  app.post('/api/system/ssh-blacklist/ensure', { preHandler: [app.authenticate] }, async (req, reply) => {
    const u = req.user as any;
    if (u.role !== 'admin') return reply.code(403).send({ error: 'admin only' });
    try {
      const { sshBlacklistService } = await import('../services/mikrotik/SshBlacklistService');
      await sshBlacklistService.ensure();
      const status = await sshBlacklistService.getStatus();
      await audit({ userId: u.uid, username: u.username, action: 'ssh-blacklist-ensure', ip: req.ip });
      return { ok: true, status };
    } catch (e: any) {
      return reply.code(400).send({ error: e.message });
    }
  });

  // RouterOS system scripts (quayip, duckdns, protect)
  app.get('/api/system/router-scripts', { preHandler: [app.authenticate] }, async () => {
    const svc = getRouterScriptService();
    const scripts = await svc.listStatus();
    return { scripts, managed: MANAGED_ROUTER_SCRIPTS.map(s => s.name) };
  });

  app.post('/api/system/router-scripts/ensure', { preHandler: [app.authenticate] }, async (req, reply) => {
    const u = req.user as any;
    if (u.role !== 'admin') return reply.code(403).send({ error: 'admin only' });
    try {
      await getRouterScriptService().ensureInstalled();
      const scripts = await getRouterScriptService().listStatus();
      await audit({ userId: u.uid, username: u.username, action: 'router-scripts-ensure', ip: req.ip });
      return { ok: true, scripts };
    } catch (e: any) {
      return reply.code(400).send({ error: e.message });
    }
  });

  app.post<{ Params: { name: string } }>(
    '/api/system/router-scripts/:name/run',
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const u = req.user as any;
      if (u.role !== 'admin') return reply.code(403).send({ error: 'admin only' });
      const name = req.params.name as ManagedRouterScriptName;
      if (!MANAGED_ROUTER_SCRIPTS.some(s => s.name === name)) {
        return reply.code(404).send({ error: 'unknown script' });
      }
      try {
        const result = await getRouterScriptService().run(name);
        await audit({ userId: u.uid, username: u.username, action: 'router-script-run', ip: req.ip, details: { name } });
        const scripts = await getRouterScriptService().listStatus();
        return { ...result, scripts };
      } catch (e: any) {
        return reply.code(400).send({ error: e.message });
      }
    },
  );

  // Redeploy WebUI container (upload tar qua HTTP, SSH nội bộ container→router)
  app.post('/api/system/redeploy-webui', { preHandler: [app.authenticate] }, async (req, reply) => {
    const u = req.user as { role?: string };
    if (u.role !== 'admin') return reply.code(403).send({ error: 'admin only' });
    const ctype = String(req.headers['content-type'] || '');
    let tar: Buffer;
    if (ctype.includes('application/json')) {
      const body = req.body as { tarUrl?: string };
      if (!body?.tarUrl) return reply.code(400).send({ error: 'tarUrl required' });
      const { downloadTarFromUrl, redeployWebuiFromTarBuffer } = await import('../services/system/RedeployWebuiService');
      tar = await downloadTarFromUrl(body.tarUrl);
      const result = await redeployWebuiFromTarBuffer(tar);
      return { ok: true, ...result };
    }
    if (Buffer.isBuffer(req.body) && req.body.length > 0) {
      tar = req.body;
    } else {
      const chunks: Buffer[] = [];
      for await (const chunk of req.raw) chunks.push(Buffer.from(chunk));
      tar = Buffer.concat(chunks);
    }
    try {
      const { redeployWebuiFromTarBuffer } = await import('../services/system/RedeployWebuiService');
      const result = await redeployWebuiFromTarBuffer(tar);
      return { ok: true, ...result };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return reply.code(500).send({ error: msg.slice(0, 300) });
    }
  });

  // Test Mikrotik connection (REST + SSH)
  app.post('/api/mikrotik/test', { preHandler: [app.authenticate] }, async (req, reply) => {
    const mik = getMikrotikService();
    const result: any = { rest: false, ssh: false };
    try {
      const t0 = Date.now();
      await mik.restGet('/rest/system/identity');
      result.rest = true;
      result.restLatencyMs = Date.now() - t0;
    } catch (e: any) {
      result.restError = e.message?.slice(0, 100);
    }
    try {
      const t0 = Date.now();
      await mik.sshExec('/system/identity/print', 5_000);
      result.ssh = true;
      result.sshLatencyMs = Date.now() - t0;
    } catch (e: any) {
      result.sshError = e.message?.slice(0, 100);
    }
    const u = req.user as any;
    await audit({ userId: u.uid, username: u.username, action: 'mikrotik-test', ip: req.ip, details: result });
    return result;
  });

  app.get('/api/system/clock', { preHandler: [app.authenticate] }, async () => {
    return getClockStatus();
  });

  // Sync RouterOS + hub + WebUI clocks from network UTC (NTP enabled)
  app.post('/api/mikrotik/sync-time', { preHandler: [app.authenticate] }, async (req, reply) => {
    const u = req.user as { uid?: number; username?: string; role?: string };
    if (u.role !== 'admin') return reply.code(403).send({ error: 'admin only' });
    try {
      const result = await syncClocks(true);
      if (!result.ok) return reply.code(502).send({ error: result.error || 'sync failed' });
      await audit({ userId: u.uid, username: u.username || 'admin', action: 'sync-time', ip: req.ip, details: result });
      return result;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'sync failed';
      return reply.code(400).send({ error: msg });
    }
  });

  // Dọn sạch fleet DB (không gọi Mikrotik — dùng sau SSH cleanup)
  app.post('/api/system/purge-fleet', { preHandler: [app.authenticate] }, async (req, reply) => {
    const u = req.user as any;
    if (u.role !== 'admin') return reply.code(403).send({ error: 'admin only' });
    const proxies = await prisma.proxyUser.deleteMany({});
    const disc = await prisma.wanDiscovery.deleteMany({});
    const wan = await prisma.wanStatus.deleteMany({});
    const routes = await prisma.deviceRoute.deleteMany({});
    await audit({ userId: u.uid, username: u.username, action: 'purge-fleet', ip: req.ip, details: { proxies, disc, wan, routes } });
    realtimeHub.broadcast({ type: 'fleet.purged', payload: { proxies: proxies.count } });
    return { ok: true, deleted: { proxies: proxies.count, wanDiscovery: disc.count, wanStatus: wan.count, deviceRoutes: routes.count } };
  });

  // Purge WAN discovery/state sau reset pool (pppoe-wan không nằm trong bảng out)
  app.post('/api/system/purge-wan-state', { preHandler: [app.authenticate] }, async (req, reply) => {
    const u = req.user as any;
    if (u.role !== 'admin') return reply.code(403).send({ error: 'admin only' });
    const [disc, wan, routes] = await Promise.all([
      prisma.wanDiscovery.deleteMany({}),
      prisma.wanStatus.deleteMany({}),
      prisma.deviceRoute.deleteMany({}),
    ]);
    await audit({ userId: u.uid, username: u.username, action: 'purge-wan-state', ip: req.ip, details: { disc, wan, routes } });
    realtimeHub.broadcast({ type: 'wan.purged', payload: { disc, wan, routes } });
    return { ok: true, deleted: { wanDiscovery: disc.count, wanStatus: wan.count, deviceRoutes: routes.count } };
  });

  // Manual log tail + domain aggregate (testing)
  app.post('/api/system/logs/tail', { preHandler: [app.authenticate] }, async (req, reply) => {
    const u = req.user as { role?: string };
    if (u.role !== 'admin') return reply.code(403).send({ error: 'admin only' });
    try {
      const result = await runLogTailOnce();
      return { ok: true, ...result };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'tail failed';
      return reply.code(500).send({ error: msg });
    }
  });

  app.post('/api/system/logs/aggregate', { preHandler: [app.authenticate] }, async (req, reply) => {
    const u = req.user as { role?: string };
    if (u.role !== 'admin') return reply.code(403).send({ error: 'admin only' });
    try {
      const result = await runDomainAggregateOnce();
      return { ok: true, ...result };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'aggregate failed';
      return reply.code(500).send({ error: msg });
    }
  });

  // Manual rollup trigger (testing / backfill)
  app.post('/api/system/metrics/rollup', { preHandler: [app.authenticate] }, async (req, reply) => {
    const u = req.user as { role?: string };
    if (u.role !== 'admin') return reply.code(403).send({ error: 'admin only' });
    try {
      const result = await runRollupOnce();
      return { ok: true, ...result };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'rollup failed';
      return reply.code(500).send({ error: msg });
    }
  });

  // Debug: test connectivity từ webui container tới proxy containers
  app.get('/api/debug/network', { preHandler: [app.authenticate] }, async (req, reply) => {
    const u = req.user as any;
    if (u.role !== 'admin') return reply.code(403).send({ error: 'admin only' });
    const net = require('net');
    const fs = require('fs');
    const result: any = { tests: [] };
    // TCP tests
    for (const target of [
      { name: 'mikrotik-rest', host: '172.17.0.1', port: 80 },
      { name: 'mikrotik-ssh', host: '172.17.0.1', port: 22222 },
      { name: 'mikrotik-wan', host: '113.22.235.54', port: 80 },
      { name: 'proxy3p-2-direct', host: '172.18.2.2', port: 20002 },
      { name: 'proxy3p-2-via-wan', host: '113.22.235.54', port: 30057 },
      { name: 'google', host: '8.8.8.8', port: 53 },
    ]) {
      const t0 = Date.now();
      try {
        await new Promise<void>((resolve, reject) => {
          const sock = net.createConnection({ host: target.host, port: target.port, timeout: 4000 }, () => {
            sock.destroy();
            resolve();
          });
          sock.on('error', reject);
          sock.on('timeout', () => { sock.destroy(); reject(new Error('timeout')); });
        });
        result.tests.push({ ...target, ok: true, latencyMs: Date.now() - t0 });
      } catch (e: any) {
        result.tests.push({ ...target, ok: false, error: e.message?.slice(0, 100), latencyMs: Date.now() - t0 });
      }
    }
    // Container info
    const os = require('os');
    result.containerHost = os.hostname();
    result.containerIps = Object.values(os.networkInterfaces()).flat().filter((i: any) => !i.internal).map((i: any) => `${i.address}/${i.family}`);
    // Routing table
    try {
      const routeRaw = fs.readFileSync('/proc/net/route', 'utf8');
      result.routes = routeRaw.split('\n').slice(1).filter((l: string) => l.trim()).map((l: string) => {
        const parts = l.split(/\s+/);
        return { dest: parts[0], gw: parts[1], flags: parts[2], iface: parts[7] };
      }).slice(0, 20);
    } catch (e: any) {
      result.routes = `read error: ${e.message}`;
    }
    return result;
  });
}