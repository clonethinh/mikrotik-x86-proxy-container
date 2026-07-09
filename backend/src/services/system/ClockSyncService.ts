// Sync RouterOS + container clocks from network time (NTP + HTTP fallback)
import * as https from 'https';
import * as http from 'http';
import { execFileSync } from 'child_process';
import { prisma } from '../../db/prisma';
import { config } from '../../lib/config';
import { hubContainerName, HUB_SHARD_COUNT } from '../../lib/hubUtils';
import { logger } from '../../lib/logger';
import { getMikrotikService } from '../mikrotik/MikrotikService';
import { hubProxyService } from '../proxy/HubProxyService';
import { runLogTailOnce } from '../logs/LogTailer';

const LAST_SYNC_KEY = 'clock.lastSyncAt';
const MIN_RESYNC_MS = parseInt(process.env.CLOCK_SYNC_MIN_MS || String(6 * 60 * 60 * 1000), 10);
const CLOCK_TZ = config.clock.timezone;

export interface ClockSyncResult {
  ok: boolean;
  source: string;
  syncedAt: string;
  timezone: string;
  router?: { date: string; time: string };
  containers: string[];
  ntpEnabled: boolean;
  skipped?: boolean;
  error?: string;
}

function formatRouterDateTime(d: Date): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: CLOCK_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (type: string) => parts.find(p => p.type === type)?.value || '00';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}:${get('second')}`,
  };
}

function fetchJson(url: string, timeoutMs = 8000): Promise<any> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.get(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        timeout: timeoutMs,
        headers: { 'User-Agent': 'webuiproxymikrotik/1.0' },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch {
            reject(new Error('invalid JSON'));
          }
        });
      },
    );
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
  });
}

/** Fetch authoritative time for configured timezone (default Vietnam). */
export async function fetchNetworkTime(): Promise<{ date: Date; source: string }> {
  const tzEnc = encodeURIComponent(CLOCK_TZ);
  const sources: Array<{ name: string; url: string; parse: (j: any) => Date }> = [
    {
      name: 'worldtimeapi-vn',
      url: `https://worldtimeapi.org/api/timezone/${tzEnc}`,
      parse: j => new Date((j.datetime as string) || ((j.unixtime as number) * 1000)),
    },
    {
      name: 'timeapi-vn',
      url: `https://timeapi.io/api/Time/current/zone?timeZone=${tzEnc}`,
      parse: j => new Date(j.dateTime as string),
    },
    {
      name: 'worldtimeapi-utc',
      url: 'https://worldtimeapi.org/api/timezone/Etc/UTC',
      parse: j => new Date((j.unixtime as number) * 1000),
    },
  ];

  for (const src of sources) {
    try {
      const j = await fetchJson(src.url);
      const d = src.parse(j);
      if (!Number.isNaN(d.getTime())) return { date: d, source: src.name };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'fetch failed';
      logger.debug({ source: src.name, err: msg }, 'network time source failed');
    }
  }
  throw new Error('all network time sources failed');
}

function shellQuote(inner: string): string {
  return inner.replace(/'/g, "'\\''");
}

async function setLocalContainerTime(d: Date): Promise<void> {
  const epoch = Math.floor(d.getTime() / 1000);
  try {
    execFileSync('date', ['-s', `@${epoch}`], { stdio: 'pipe', timeout: 5000 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'date failed';
    if (/not permitted|cannot set date/i.test(msg)) {
      logger.debug('local container date -s skipped (no CAP_SYS_TIME — router/hub vẫn được sync)');
      return;
    }
    logger.warn({ err: msg.slice(0, 80) }, 'local container date -s failed');
  }
}

async function setHubContainerTime(shardId: number, d: Date): Promise<void> {
  const ctn = hubContainerName(shardId);
  const epoch = Math.floor(d.getTime() / 1000);
  const mik = getMikrotikService();
  await mik.containerShell(ctn, `date -s @${epoch}`, 12_000);
}

async function hubContainerExists(name: string): Promise<boolean> {
  const mik = getMikrotikService();
  const out = await mik.sshExec(`/container/print count-only where name=${name}`, 8000).catch(() => '0');
  return parseInt(out.trim(), 10) > 0;
}

async function configureRouterTimezone(mik: ReturnType<typeof getMikrotikService>): Promise<void> {
  await mik.sshExec(
    `/system/clock/set time-zone-autodetect=no time-zone-name=${CLOCK_TZ}`,
    10_000,
  );
}

async function configureRouterNtp(mik: ReturnType<typeof getMikrotikService>): Promise<boolean> {
  const servers = config.clock.ntpServers;
  await mik.sshExec(
    `/system/ntp/client/set enabled=yes mode=unicast servers=${servers}`,
    10_000,
  );
  return true;
}

async function getLastSyncAt(): Promise<Date | null> {
  const row = await prisma.setting.findUnique({ where: { key: LAST_SYNC_KEY } });
  if (!row?.value) return null;
  const d = new Date(row.value);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function markSynced(d: Date): Promise<void> {
  await prisma.setting.upsert({
    where: { key: LAST_SYNC_KEY },
    create: { key: LAST_SYNC_KEY, value: d.toISOString() },
    update: { value: d.toISOString() },
  });
}

export async function getClockStatus(): Promise<{
  local: string;
  router: string | null;
  hub: string | null;
  lastSyncAt: string | null;
  ntpEnabled: boolean | null;
  timezone: string;
  timezoneLabel: string;
}> {
  const local = new Date().toLocaleString('vi-VN', { timeZone: CLOCK_TZ });
  let router: string | null = null;
  let hub: string | null = null;
  let ntpEnabled: boolean | null = null;
  if (config.deployTarget === 'router') {
    try {
      const mik = getMikrotikService();
      const [clk, ntp, hubDate] = await Promise.all([
        mik.sshExec('/system/clock/print', 8000),
        mik.sshExec('/system/ntp/client/print', 8000).catch(() => ''),
        hubShellDate(0).catch(() => null),
      ]);
      const dateM = clk.match(/date:\s*(\S+)/);
      const timeM = clk.match(/time:\s*(\S+)/);
      const offsetM = clk.match(/gmt-offset:\s*(\S+)/);
      const offset = offsetM?.[1] || '+07:00';
      if (dateM && timeM) router = `${dateM[1]}T${timeM[1]}${offset}`;
      ntpEnabled = /enabled:\s*yes/i.test(ntp);
      hub = hubDate;
    } catch {
      // ignore
    }
  }
  const last = await getLastSyncAt();
  return {
    local,
    router,
    hub,
    lastSyncAt: last?.toISOString() ?? null,
    ntpEnabled,
    timezone: CLOCK_TZ,
    timezoneLabel: config.clock.timezoneLabel,
  };
}

async function getRouterClockDate(): Promise<string | null> {
  const mik = getMikrotikService();
  const clk = await mik.sshExec('/system/clock/print', 8000);
  const m = clk.match(/date:\s*(\S+)/);
  return m?.[1] ?? null;
}

async function hubShellDate(shardId: number): Promise<string> {
  const ctn = hubContainerName(shardId);
  if (!(await hubContainerExists(ctn))) return '';
  const mik = getMikrotikService();
  const out = await mik.containerShell(ctn, 'date -Is', 10_000);
  return out.trim().split('\n').pop()?.trim() || '';
}

/**
 * Sync RouterOS + hub + local WebUI container to network time (Vietnam TZ).
 * @param force skip min-interval guard
 */
export async function syncClocks(force = false): Promise<ClockSyncResult> {
  if (config.deployTarget !== 'router') {
    return {
      ok: false,
      source: 'none',
      syncedAt: new Date().toISOString(),
      timezone: CLOCK_TZ,
      containers: [],
      ntpEnabled: false,
      error: 'not router deploy',
    };
  }

  if (!force) {
    const last = await getLastSyncAt();
    if (last && Date.now() - last.getTime() < MIN_RESYNC_MS) {
      return {
        ok: true,
        source: 'cached',
        syncedAt: last.toISOString(),
        timezone: CLOCK_TZ,
        containers: [],
        ntpEnabled: true,
        skipped: true,
      };
    }
  }

  try {
    const { date, source } = await fetchNetworkTime();
    const { date: routerDate, time: routerTime } = formatRouterDateTime(date);
    const mik = getMikrotikService();
    const prevRouterDate = await getRouterClockDate();

    await configureRouterTimezone(mik);
    await mik.sshExec(`/system/clock/set time=${routerTime} date=${routerDate}`, 10_000);

    let ntpEnabled = false;
    try {
      ntpEnabled = await configureRouterNtp(mik);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'ntp enable failed';
      logger.warn({ err: msg.slice(0, 80) }, 'ntp client enable failed');
    }

    await setLocalContainerTime(date);

    const containers: string[] = ['webuiproxymikrotik'];
    const shardCount = config.hub.shardCount || HUB_SHARD_COUNT;
    for (let shardId = 0; shardId < shardCount; shardId++) {
      const name = hubContainerName(shardId);
      if (!(await hubContainerExists(name))) continue;
      try {
        await setHubContainerTime(shardId, date);
        containers.push(name);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'hub date failed';
        logger.warn({ shardId, name, err: msg.slice(0, 80) }, 'hub clock sync failed');
      }
    }

    await markSynced(date);

    const dateChanged = prevRouterDate !== routerDate;
    if (dateChanged) {
      const yymmdd = routerDate.slice(2).replace(/-/g, '');
      const { listTailableHubShardIds } = await import('../proxy/HubConfigService');
      const reloadShards = await listTailableHubShardIds();
      await Promise.all(
        reloadShards.map((shardId) =>
          hubProxyService.reloadHubShard(shardId).catch((e: unknown) => {
            const msg = e instanceof Error ? e.message : 'reload failed';
            logger.warn({ shardId, err: msg.slice(0, 80) }, 'hub reload after clock sync failed');
          }),
        ),
      );
      await Promise.all(
        Array.from({ length: shardCount }, async (_, shardId) => {
          const shardNum = shardId + 1;
          const logFile = `/var/log/3proxy/shard${shardNum}-${yymmdd}.log`;
          await prisma.setting.upsert({
            where: { key: `logs.tail.shard${shardId}.file` },
            create: { key: `logs.tail.shard${shardId}.file`, value: logFile },
            update: { value: logFile },
          });
          await prisma.setting.upsert({
            where: { key: `logs.tail.shard${shardId}.offset` },
            create: { key: `logs.tail.shard${shardId}.offset`, value: '0' },
            update: { value: '0' },
          });
        }),
      );
      runLogTailOnce().catch(() => {});
    }

    logger.info({ source, timezone: CLOCK_TZ, routerDate, routerTime, containers: containers.length }, 'clock sync OK');
    return {
      ok: true,
      source,
      syncedAt: date.toISOString(),
      timezone: CLOCK_TZ,
      router: { date: routerDate, time: routerTime },
      containers,
      ntpEnabled,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'sync failed';
    logger.warn({ err: msg }, 'clock sync failed');
    return {
      ok: false,
      source: 'error',
      syncedAt: new Date().toISOString(),
      timezone: CLOCK_TZ,
      containers: [],
      ntpEnabled: false,
      error: msg,
    };
  }
}

export function startClockSyncOnBoot(): void {
  if (config.deployTarget !== 'router') return;
  setTimeout(() => {
    syncClocks(true).catch(() => {});
  }, 12_000);
  logger.info({ timezone: CLOCK_TZ }, 'clock sync on boot scheduled');
}