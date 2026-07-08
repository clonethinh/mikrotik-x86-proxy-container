#!/usr/bin/env node
/**
 * PR-3 verification (thorough): clock sync + realtime ingest + logs API.
 * Usage: node scripts/test-pr3.js [--proxy-user u4899] [--skip-traffic] [--skip-clock]
 */
const { execSync } = require('child_process');
const { loadConfig } = require('../setup/lib/config');
const { connect, exec } = require('../setup/lib/ssh');
const { request, login } = require('../setup/lib/http');
const { step } = require('../setup/lib/logger');

const PROXY_USER = process.argv.find((_, i, a) => a[i - 1] === '--proxy-user') || 'u4899';
const SKIP_TRAFFIC = process.argv.includes('--skip-traffic');
const SKIP_CLOCK = process.argv.includes('--skip-clock');

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function requestWithTimeout(method, url, body, token, timeoutMs) {
  return new Promise((resolve, reject) => {
    const http = require('http');
    const https = require('https');
    const u = new URL(url);
    const payload = body != null ? JSON.stringify(body) : null;
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method,
      headers,
      timeout: timeoutMs,
    }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        let parsed = data;
        try { parsed = JSON.parse(data); } catch {}
        resolve({ status: res.statusCode, data: parsed, raw: data });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error(`HTTP timeout ${method} ${url}`)); });
    if (payload) req.write(payload);
    req.end();
  });
}

function shellQuote(cmd) {
  return `/bin/sh -c '${cmd.replace(/'/g, "'\\''")}'`;
}

function parseRouterClock(isoOrRouter) {
  if (!isoOrRouter) return null;
  const d = new Date(isoOrRouter);
  return Number.isNaN(d.getTime()) ? null : d;
}

function hoursSince(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return Infinity;
  return Math.abs(Date.now() - d.getTime()) / 3_600_000;
}

async function generateTraffic(cfg, proxy, token) {
  const host = proxy.publicIp || cfg.wan?.host || cfg.router.host;
  const port = proxy.extHttpPort;
  const user = proxy.username;
  let pass = proxy.password;
  if (!pass) {
    const pw = await request('GET', `${cfg.webuiUrl}/api/proxies/${proxy.id}/password`, null, token);
    pass = pw.data?.password;
  }
  if (!pass) throw new Error(`No password for proxy ${user}`);
  step('traffic', `curl via ${user}@${host}:${port} (3 requests)...`);
  const urls = [
    'http://httpbin.org/ip',
    'http://httpbin.org/bytes/30000',
    'https://api.ipify.org?format=json',
  ];
  for (const url of urls) {
    try {
      execSync(
        `curl -sS -m 30 -x http://${user}:${pass}@${host}:${port} "${url}" -o /dev/null -w "%{http_code}"`,
        { stdio: ['ignore', 'pipe', 'pipe'], timeout: 35000 },
      );
    } catch (e) {
      step('traffic', `warn ${url}: ${e.message?.slice(0, 80)}`);
    }
    await sleep(1500);
  }
}

async function countRequestLogsViaApi(token, proxyId) {
  const res = await request(
    'GET',
    `${cfg.webuiUrl}/api/proxies/${proxyId}/logs/requests?limit=200`,
    null,
    token,
  );
  return Array.isArray(res.data) ? res.data.length : -1;
}

async function pollIngest(token, proxyId, beforeCount, maxWaitMs = 25000) {
  const start = Date.now();
  let inserted = 0;
  while (Date.now() - start < maxWaitMs) {
    const tail = await request('POST', `${cfg.webuiUrl}/api/system/logs/tail`, {}, token);
    inserted = tail.data?.inserted ?? 0;
    if (inserted > 0) return { inserted, waitedMs: Date.now() - start };

    const reqs = await request('GET', `${cfg.webuiUrl}/api/proxies/${proxyId}/logs/requests?limit=1`, null, token);
    const after = Array.isArray(reqs.data) ? reqs.data.length : 0;
    if (after > 0 && beforeCount >= 0) {
      // can't easily diff without DB — rely on tail inserted
    }
    await sleep(3000);
  }
  return { inserted: 0, waitedMs: Date.now() - start };
}

let cfg;

async function main() {
  cfg = loadConfig();
  const token = await login(cfg.webuiUrl, cfg.webui.adminUser, cfg.webui.adminPass);
  const results = {};

  // --- Clock sync ---
  if (!SKIP_CLOCK) {
    const clockBefore = await request('GET', `${cfg.webuiUrl}/api/system/clock`, null, token);
    results.clock_api = clockBefore.status === 200;
    if (clockBefore.status === 200) {
      step('clock', `before: router=${clockBefore.data?.router} ntp=${clockBefore.data?.ntpEnabled}`);
    }

    const sync = await requestWithTimeout('POST', `${cfg.webuiUrl}/api/mikrotik/sync-time`, {}, token, 120000);
    results.clock_sync_api = sync.status === 200;
    results.clock_sync_ok = sync.data?.ok === true && !sync.data?.skipped;
    if (sync.status === 200) {
      step('clock', `sync: source=${sync.data.source} at=${sync.data.syncedAt} ntp=${sync.data.ntpEnabled}`);
    } else {
      step('clock', `sync failed: ${sync.status} ${JSON.stringify(sync.data).slice(0, 120)}`);
    }

    await sleep(3000);
    const clockAfter = await request('GET', `${cfg.webuiUrl}/api/system/clock`, null, token);
    results.clock_after_api = clockAfter.status === 200;
    if (clockAfter.status === 200) {
      const routerTs = clockAfter.data?.router;
      const routerDate = parseRouterClock(routerTs);
      const driftH = routerDate ? hoursSince(routerDate) : Infinity;
      results.clock_drift_under_2h = driftH < 2;
      results.ntp_enabled = clockAfter.data?.ntpEnabled === true;
      step('clock', `after: router=${routerTs} driftH=${driftH.toFixed(2)} ntp=${clockAfter.data?.ntpEnabled}`);
    }

    const conn = await connect(cfg);
    try {
      const ros = await exec(conn, '/system/clock/print', 15000);
      const hub = await exec(conn, '/container/shell proxy3p-hub cmd="date -Is"', 15000).catch(() => '');
      const mDate = ros.match(/date:\s*(\S+)/);
      const mTime = ros.match(/time:\s*(\S+)/);
      results.ssh_router_clock = !!(mDate && mTime);
      results.ssh_hub_clock = hub.includes('T');
      step('clock', `ssh router ${mDate?.[1]} ${mTime?.[1]} | hub ${hub.trim().split('\n').pop()}`);
    } finally {
      conn.end();
    }
  }

  const proxies = await request('GET', `${cfg.webuiUrl}/api/proxies`, null, token);
  if (proxies.status !== 200 || !proxies.data?.length) {
    throw new Error('Cannot fetch proxies');
  }
  const proxy = proxies.data.find(p => p.username === PROXY_USER && p.enabled)
    || proxies.data.find(p => p.enabled)
    || proxies.data[0];
  step('pr3', `Testing proxy id=${proxy.id} user=${proxy.username}`);

  const dbBefore = await countRequestLogsViaApi(token, proxy.id);
  step('pr3', `Request logs before (API max 200): ${dbBefore}`);

  if (!SKIP_TRAFFIC) {
    await generateTraffic(cfg, proxy, token);
    step('pr3', 'Polling realtime ingest (max 25s)...');
    const ingest = await pollIngest(token, proxy.id, dbBefore, 25000);
    results.realtime_ingest = ingest.inserted > 0;
    results.realtime_wait_ms = ingest.waitedMs;
    step('pr3', `ingest poll: inserted=${ingest.inserted} waited=${ingest.waitedMs}ms`);
  }

  const tailTrigger = await request('POST', `${cfg.webuiUrl}/api/system/logs/tail`, {}, token);
  results.tail_trigger_api = tailTrigger.status === 200;
  results.tail_trigger_ok = tailTrigger.data?.ok === true;
  results.tail_shards_gt0 = (tailTrigger.data?.shards ?? 0) > 0;
  if (tailTrigger.status === 200) {
    step('pr3', `tail trigger: inserted=${tailTrigger.data.inserted} shards=${tailTrigger.data.shards}`);
  }

  await sleep(1500);

  const reqs1 = await request(
    'GET',
    `${cfg.webuiUrl}/api/proxies/${proxy.id}/logs/requests?limit=20`,
    null,
    token,
  );
  results.requests_api = reqs1.status === 200;
  results.requests_array = Array.isArray(reqs1.data);
  results.requests_has_rows = Array.isArray(reqs1.data) && reqs1.data.length > 0;
  if (reqs1.status === 200 && reqs1.data?.[0]) {
    const r = reqs1.data[0];
    results.requests_shape = !!(r.ts && r.destHost && r.clientIp);
    results.latest_ts_fresh = hoursSince(r.ts) < 2;
    step('pr3', `latest: ${r.destHost}:${r.destPort} ts=${r.ts} ageH=${hoursSince(r.ts).toFixed(2)}`);
  }

  const agg = await request('POST', `${cfg.webuiUrl}/api/system/logs/aggregate`, {}, token);
  results.aggregate_api = agg.status === 200;
  results.aggregate_ok = agg.data?.ok === true;

  await sleep(1000);

  const domains = await request(
    'GET',
    `${cfg.webuiUrl}/api/proxies/${proxy.id}/logs/domains?limit=10`,
    null,
    token,
  );
  results.domains_api = domains.status === 200;
  results.domains_array = Array.isArray(domains.data);
  results.domains_has_rows = Array.isArray(domains.data) && domains.data.length > 0;

  const tailRaw = await request(
    'GET',
    `${cfg.webuiUrl}/api/proxies/${proxy.id}/logs/tail?lines=30`,
    null,
    token,
  );
  results.tail_raw_api = tailRaw.status === 200;
  results.tail_raw_lines = Array.isArray(tailRaw.data?.lines);
  results.tail_raw_has_lines = Array.isArray(tailRaw.data?.lines) && tailRaw.data.lines.length >= 3;

  const hostFilter = await request(
    'GET',
    `${cfg.webuiUrl}/api/proxies/${proxy.id}/logs/requests?host=httpbin&limit=10`,
    null,
    token,
  );
  results.host_filter_api = hostFilter.status === 200;
  if (hostFilter.status === 200 && Array.isArray(hostFilter.data)) {
    results.host_filter_match = hostFilter.data.length === 0
      || hostFilter.data.every(r => (r.destHost || '').toLowerCase().includes('httpbin'));
  }

  const dbAfter = await countRequestLogsViaApi(token, proxy.id);
  results.db_request_logs = dbAfter >= 0;
  results.db_request_logs_gt0 = dbAfter > 0;
  if (!SKIP_TRAFFIC && dbBefore >= 0 && dbAfter >= 0) {
    results.db_count_increased = dbAfter > dbBefore;
  }
  step('pr3', `Request logs after: ${dbAfter} (before ${dbBefore})`);

  const health = await request('GET', `${cfg.webuiUrl}/api/health`);
  results.webui_health = health.status === 200;

  console.log('\n=== PR-3 Test Results (thorough) ===');
  const required = [
    'webui_health',
    'tail_trigger_api', 'tail_trigger_ok', 'tail_shards_gt0',
    'requests_api', 'requests_array',
    'aggregate_api', 'aggregate_ok',
    'domains_api', 'domains_array',
    'tail_raw_api', 'tail_raw_lines',
    'host_filter_api',
  ];
  if (!SKIP_CLOCK) {
    required.push(
      'clock_api', 'clock_sync_api', 'clock_sync_ok',
      'clock_after_api', 'clock_drift_under_2h', 'ntp_enabled',
      'ssh_router_clock', 'ssh_hub_clock',
    );
  }
  const soft = [
    'requests_has_rows', 'requests_shape', 'latest_ts_fresh',
    'realtime_ingest', 'domains_has_rows', 'tail_raw_has_lines',
    'host_filter_match', 'db_request_logs', 'db_request_logs_gt0', 'db_count_increased',
  ];

  let pass = 0;
  let fail = 0;
  for (const [k, v] of Object.entries(results)) {
    const isSoft = soft.includes(k);
    const mark = isSoft ? (v ? '✓' : '○') : (v ? '✓' : '✗');
    console.log(`  ${mark} ${k}: ${v}${isSoft ? ' (soft)' : ''}`);
    if (required.includes(k)) {
      if (v) pass++; else fail++;
    }
  }
  console.log(`\n${pass}/${pass + fail} required checks passed`);
  if (!results.realtime_ingest && !SKIP_TRAFFIC) {
    console.log('  hint: realtime ingest slow — check LOGS_TAIL_MS or hub log write delay');
  }
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('PR-3 test failed:', e.message);
  process.exit(1);
});