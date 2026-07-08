// Main Fastify server
import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';

import websocket from '@fastify/websocket';
import * as path from 'path';
import * as fs from 'fs';

import { config } from './lib/config';
import { logger } from './lib/logger';
import { initDb, closeDb } from './db/prisma';
import { authService } from './services/auth/AuthService';
import authPlugin from './middleware/auth';
import authRoutes from './routes/auth';
import proxyRoutes from './routes/proxies';
import systemRoutes from './routes/system';
import auditRoutes from './routes/audit';
import wanRoutes from './routes/wan';
import deviceRoutes from './routes/devices';
import settingsRoutes from './routes/settings';
import proxyMetricsRoutes from './routes/proxyMetrics';
import proxyLogsRoutes from './routes/proxyLogs';
import wsHandler from './ws/handler';
import { startHealthMonitor, stopHealthMonitor } from './services/realtime/HealthMonitor';
import { startProxyMetricsCollector, stopProxyMetricsCollector } from './services/metrics/ProxyMetricsCollector';
import { startRollupAggregator, stopRollupAggregator } from './services/metrics/RollupAggregator';
import { startRouterResourceCollector, stopRouterResourceCollector } from './services/metrics/RouterResourceCollector';
import { startRouterTrafficCollector, stopRouterTrafficCollector } from './services/metrics/RouterTrafficService';
import { startLanDeviceTrafficCollector, stopLanDeviceTrafficCollector } from './services/metrics/LanDeviceTrafficService';
import { startLogTailer, stopLogTailer } from './services/logs/LogTailer';
import { startTopDomainAggregator, stopTopDomainAggregator } from './services/logs/TopDomainAggregator';
import { startClockSyncOnBoot } from './services/system/ClockSyncService';
import { startWanWatcher, stopWanWatcher } from './services/auto/WanWatcherService';
import { routerQueue } from './lib/queue';

async function buildServer() {
  const app = Fastify({
    loggerInstance: logger,
    trustProxy: true,
    bodyLimit: 1024 * 1024 * 1024,
  });

  // Docker image upload (redeploy-webui) — stream raw body
  app.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer', bodyLimit: 1024 * 1024 * 1024 },
    (_req, body, done) => done(null, body),
  );

  // POST không body (vd. /api/wan/2/enable) — frontend fetch không gửi JSON;
  // tránh FST_ERR_CTP_EMPTY_JSON_BODY khi client vẫn set Content-Type: application/json
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    if (!body || (typeof body === 'string' && body.trim() === '')) return done(null, {});
    try {
      done(null, JSON.parse(body as string));
    } catch (e: any) {
      done(e, undefined);
    }
  });

  // Plugins
  await app.register(cors, {
    origin: (origin, cb) => cb(null, true),
    credentials: true,
  });
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cookie);
  await app.register(jwt, {
    secret: config.jwtSecret,
    cookie: { cookieName: 'token', signed: false },
  });
  await app.register(websocket);

  // Serve frontend static files (when bundled together)
  const publicDir = path.resolve(__dirname, '../public');
  if (fs.existsSync(publicDir)) {
    const staticPlugin = require('@fastify/static');
    await app.register(staticPlugin, {
      root: publicDir,
      prefix: '/',
    });
    // SPA fallback
    app.setNotFoundHandler((req, reply) => {
      const indexFile = path.join(publicDir, 'index.html');
      if (fs.existsSync(indexFile) && req.method === 'GET' && !req.url.startsWith('/api')) {
        return reply.type('text/html').send(fs.createReadStream(indexFile));
      }
      return reply.code(404).send({ error: 'Not found' });
    });
  }

  // Auth middleware (must be registered before routes)
  await app.register(authPlugin);

  // Routes
  await app.register(authRoutes);
  await app.register(proxyRoutes);
  await app.register(systemRoutes);
  await app.register(auditRoutes);
  await app.register(wanRoutes);
  await app.register(deviceRoutes);
  await app.register(settingsRoutes);
  await app.register(proxyMetricsRoutes);
  await app.register(proxyLogsRoutes);
  await app.register(wsHandler);

  // Health check (public)
  app.get('/api/health', async () => ({
    ok: true,
    uptime: process.uptime(),
    realtimeClients: require('./realtime/hub').realtimeHub.size(),
    deployTarget: config.deployTarget,
    timestamp: Date.now(),
  }));

  return app;
}

async function main() {
  try {
    // Always run prisma db push to ensure schema is up-to-date
    // (idempotent, safe to run on every startup; picks up new fields added in code)
    try {
      const { execFileSync } = require('child_process');
      const path = require('path');
      const prismaBin = path.resolve(__dirname, '../node_modules/.bin/prisma');
      execFileSync(prismaBin, ['db', 'push', '--skip-generate', '--accept-data-loss'], {
        env: { ...process.env, DATABASE_URL: config.databaseUrl },
        stdio: 'pipe',
        timeout: 60_000,
      });
      logger.info('Prisma db push OK (schema synced)');
    } catch (e: any) {
      logger.warn({ err: e.message?.slice(0, 200) }, 'prisma db push failed (will try to connect anyway)');
    }

    await initDb();

    // Seed admin user from env (first run)
    const adminUser = process.env.ADMIN_USERNAME || 'admin';
    const adminPass = process.env.ADMIN_PASSWORD || 'changeme123';
    await authService.ensureAdminUser(adminUser, adminPass);

    const app = await buildServer();
    await app.listen({ host: config.host, port: config.port });

    logger.info(`webuiproxymikrotik backend listening on ${config.host}:${config.port}`);
    logger.info(`Deploy target: ${config.deployTarget}`);
    logger.info(`Mikrotik: ${config.mikrotik.host}:${config.mikrotik.restPort} (REST) / :${config.mikrotik.sshPort} (SSH)`);
    if (config.lowCpu) {
      logger.warn(
        {
          hubRequestLog: config.logs.hubRequestLog,
          tailEnabled: config.logs.tailEnabled,
          aggregateEnabled: config.logs.aggregateEnabled,
          metricsEnabled: config.metrics.enabled,
          containerLogging: config.logs.containerLogging,
          logLevel: config.logLevel,
        },
        'LOW_CPU_MODE: logs/metrics reduced to lower MikroTik CPU',
      );
    }

    startHealthMonitor();
    startProxyMetricsCollector();
    startRouterResourceCollector();
    startRouterTrafficCollector();
    startLanDeviceTrafficCollector();
    startRollupAggregator();
    startLogTailer();
    startTopDomainAggregator();
    startClockSyncOnBoot();
    if (config.deployTarget === 'router') {
      startWanWatcher();
      const { getRouterScriptService } = await import('./services/mikrotik/RouterScriptService');
      getRouterScriptService().ensureInstalled().catch((e: Error) => {
        logger.warn({ err: e.message }, 'router-scripts ensure on startup failed (retry from Settings)');
      });
      const { sshBlacklistService } = await import('./services/mikrotik/SshBlacklistService');
      sshBlacklistService.ensure().catch((e: Error) => {
        logger.warn({ err: e.message }, 'ssh blacklist ensure on startup failed');
      });
      const { getMikrotikService } = await import('./services/mikrotik/MikrotikService');
      getMikrotikService().ensurePoolPppoeIsolation().catch((e: Error) => {
        logger.warn({ err: e.message }, 'pool PPPoE isolation ensure failed');
      });
      const { deviceRoutingService } = await import('./services/device/DeviceRoutingService');
      deviceRoutingService.repairAll().catch((e: Error) => {
        logger.warn({ err: e.message }, 'device routes repair on startup failed');
      });
      if (config.proxy.deployMode === 'hub') {
        const { ensureHubShardMounts } = await import('./services/proxy/HubConfigService');
        const { hubProxyService } = await import('./services/proxy/HubProxyService');
        logger.info(
          {
            shardCount: config.hub.shardCount,
            shardSize: config.hub.shardSize,
            maxPppoeOut: config.hub.maxPppoeOut,
          },
          'hub scale bootstrap',
        );
        for (let sid = 0; sid < config.hub.shardCount; sid++) {
          ensureHubShardMounts(sid).catch((e: Error) => {
            logger.warn({ err: e.message, shardId: sid }, 'hub shard mount bootstrap failed');
          });
        }
        hubProxyService.ensureAllHubShards().catch((e: Error) => {
          logger.warn({ err: e.message }, 'hub veth bootstrap failed');
        });
        hubProxyService.ensureHubLanAccess().catch((e: Error) => {
          logger.warn({ err: e.message }, 'hub LAN access bootstrap failed');
        });
      }
    }

    // Self-watchdog: nếu chính container này bị stop (do reload-IP flap, OOM, etc),
    // tự động gọi /container/start lại qua Mikrotik SSH.
    // Lý do cần: khi reload PPPoE, Mikrotik tạm mất default route → container mất network
    // → systemd/init không restart được. Self-watchdog bypass điều đó.
    if (process.env.DEPLOY_TARGET === 'router') {
      const selfName = 'webuiproxymikrotik';
      const { getMikrotikService } = require('./services/mikrotik/MikrotikService');
      const mik = getMikrotikService();
      const watchdog = async () => {
        try {
          // Không restart WebUI khi đang apply proxy — tránh gián đoạn mạng chính
          if (routerQueue.size > 0) return;

          const containers = await mik.getContainers();
          const me = containers.find((c: any) => c.name === selfName);
          const st = (me?.status || '').toLowerCase();
          const running = me && ['running', 'r', 'healthy', 'h', 'starting', 'n', 'extracting', 'e', ''].includes(st);
          if (running) return;

          if (!me || st === 'stopped' || st === 'failed' || st === 'error') {
            logger.warn({ status: me?.status || 'missing' }, 'self-watchdog: webui down, restarting via SSH');
            await mik.sshExec(`/container/start [find name=${selfName}]`, 15_000);
          }
        } catch (e: any) {
          logger.warn({ err: e.message?.slice(0, 100) }, 'self-watchdog check failed');
        }
      };
      setInterval(watchdog, 60_000);
      logger.info('self-watchdog enabled (15s interval)');
    }

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info({ signal }, 'shutting down');
      stopHealthMonitor();
      stopProxyMetricsCollector();
      stopRouterResourceCollector();
      stopRouterTrafficCollector();
      stopLanDeviceTrafficCollector();
      stopRollupAggregator();
      stopLogTailer();
      stopTopDomainAggregator();
      stopWanWatcher();
      await app.close();
      await closeDb();
      process.exit(0);
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  } catch (e: any) {
    logger.error({ err: e }, 'startup failed');
    process.exit(1);
  }
}

main();