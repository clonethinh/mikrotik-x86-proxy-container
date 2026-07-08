#!/usr/bin/env node
/**
 * PR-2 verification: RollupAggregator + history API + live metrics cache.
 * Usage: node scripts/test-pr2.js [--proxy-user u4899] [--skip-traffic]
 */
const { execSync } = require('child_process');
const { loadConfig } = require('../setup/lib/config');
const { connect, exec } = require('../setup/lib/ssh');
const { request, login } = require('../setup/lib/http');
const { step } = require('../setup/lib/logger');

const PROXY_USER = process.argv.find((_, i, a) => a[i - 1] === '--proxy-user') || 'u4899';
const SKIP_TRAFFIC = process.argv.includes('--skip-traffic');

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function shellQuote(cmd) {
  return `/bin/sh -c '${cmd.replace(/'/g, "'\\''")}'`;
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
    'http://httpbin.org/bytes/50000',
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
    await sleep(2000);
  }
}

async function countSamplesOnRouter(conn, proxyId) {
  const out = await exec(
    conn,
    `/container/shell webuiproxymikrotik cmd="${shellQuote(`sqlite3 /data/proxy.db "SELECT COUNT(*) FROM ProxyTrafficSample WHERE proxyId=${proxyId};" 2>/dev/null || echo -1`)}`,
    30000,
  ).catch(() => '');
  const m = out.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : -1;
}

async function main() {
  const cfg = loadConfig();
  const token = await login(cfg.webuiUrl, cfg.webui.adminUser, cfg.webui.adminPass);
  const results = {};

  const proxies = await request('GET', `${cfg.webuiUrl}/api/proxies`, null, token);
  if (proxies.status !== 200 || !proxies.data?.length) {
    throw new Error('Cannot fetch proxies');
  }
  const proxy = proxies.data.find(p => p.username === PROXY_USER && p.enabled)
    || proxies.data.find(p => p.enabled)
    || proxies.data[0];
  step('pr2', `Testing proxy id=${proxy.id} user=${proxy.username}`);

  if (!SKIP_TRAFFIC) {
    await generateTraffic(cfg, proxy, token);
    step('pr2', 'Waiting 45s for metrics poll + flush...');
    await sleep(45000);
  }

  const live1 = await request('GET', `${cfg.webuiUrl}/api/proxies/${proxy.id}/metrics/live`, null, token);
  results.live_api = live1.status === 200;
  results.live_shape = live1.data?.rxBps !== undefined && live1.data?.txBps !== undefined;

  const rollup = await request('POST', `${cfg.webuiUrl}/api/system/metrics/rollup`, {}, token);
  results.rollup_api = rollup.status === 200;
  results.rollup_ok = rollup.data?.ok === true;
  if (rollup.status === 200) {
    step('pr2', `rollup: hour=${rollup.data.hourBuckets} day=${rollup.data.dayBuckets} wm=${rollup.data.watermark}`);
  } else {
    step('pr2', `rollup failed: ${rollup.status} ${JSON.stringify(rollup.data).slice(0, 120)}`);
  }

  await sleep(3000);

  for (const period of ['hour', 'day', 'week', 'month']) {
    const hist = await request(
      'GET',
      `${cfg.webuiUrl}/api/proxies/${proxy.id}/metrics/history?period=${period}`,
      null,
      token,
    );
    results[`history_${period}_api`] = hist.status === 200;
    results[`history_${period}_array`] = Array.isArray(hist.data);
    const hasBytes = Array.isArray(hist.data) && hist.data.some(
      r => BigInt(r.rxBytes || '0') > 0n || BigInt(r.txBytes || '0') > 0n,
    );
    if (period === 'hour' || period === 'day') {
      results[`history_${period}_data`] = hasBytes;
    }
    if (period === 'hour') {
      step('pr2', `history hour: ${hist.data?.length || 0} buckets, hasBytes=${hasBytes}`);
    }
  }

  const conn = await connect(cfg);
  try {
    const samples = await countSamplesOnRouter(conn, proxy.id);
    results.db_samples = samples >= 0;
    results.db_samples_gt0 = samples > 0;
    step('pr2', `DB samples for proxy ${proxy.id}: ${samples}`);
  } finally {
    conn.end();
  }

  const health = await request('GET', `${cfg.webuiUrl}/api/health`);
  results.webui_health = health.status === 200;

  console.log('\n=== PR-2 Test Results ===');
  const required = [
    'webui_health', 'live_api', 'live_shape', 'rollup_api', 'rollup_ok',
    'history_hour_api', 'history_hour_array',
    'history_day_api', 'history_week_api', 'history_month_api',
  ];
  const soft = ['history_hour_data', 'history_day_data', 'db_samples', 'db_samples_gt0', 'history_week_data', 'history_month_data'];

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
  if (!results.history_hour_data && !SKIP_TRAFFIC) {
    console.log('  hint: hour rollup empty — wait longer or re-run after more traffic');
  }
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('PR-2 test failed:', e.message);
  process.exit(1);
});