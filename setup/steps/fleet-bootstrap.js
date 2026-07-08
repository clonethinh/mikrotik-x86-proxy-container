/**
 * Hoàn thiện hệ thống proxy sau khi WebUI chạy:
 * - Router scripts (DuckDNS, quayip, pool isolation, gateway)
 * - Sync giờ VN
 * - Auto-provision mọi pppoe-out đang RUNNING
 */
const { connect, exec } = require('../lib/ssh');
const { request, login } = require('../lib/http');
const { step, warn } = require('../lib/logger');

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function waitForHealth(webuiUrl, attempts = 36, intervalMs = 5000) {
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await request('GET', `${webuiUrl}/api/health`);
      if (r.status === 200) return true;
    } catch { /* retry */ }
    await sleep(intervalMs);
  }
  return false;
}

async function waitForWanDiscovery(webuiUrl, token, maxSec = 120) {
  const tries = Math.ceil(maxSec / 5);
  for (let i = 0; i < tries; i++) {
    const r = await request('GET', `${webuiUrl}/api/wan/discovery`, null, token);
    const rows = Array.isArray(r.data) ? r.data : [];
    if (rows.length > 0) return rows;
    if (i === 0) step('70-fleet', 'Chờ WanWatcher quét PPPoE lần đầu...');
    await sleep(5000);
  }
  return [];
}

async function run(cfg) {
  if (cfg.setup?.fullSystem === false) {
    step('70-fleet', 'Skipped (setup.fullSystem=false)');
    return { ok: true, skipped: true };
  }

  if (cfg.setup?.importRouterScripts !== false) {
    const conn = await connect(cfg);
    try {
      step('70-fleet', 'Cài router scripts (DuckDNS, quayip, pool, gateway)...');
      const out = await exec(conn, '/import file=disk1/webuiproxymikrotik/ensure-router-scripts.rsc', 120_000);
      const tail = out.split('\n').filter(Boolean).slice(-8).join('\n');
      if (tail) step('70-fleet', tail);
    } finally {
      conn.end();
    }
  }

  step('70-fleet', 'Chờ WebUI sẵn sàng...');
  const healthy = await waitForHealth(cfg.webuiUrl);
  if (!healthy) throw new Error('WebUI health timeout — kiểm tra container webuiproxymikrotik');

  const token = await login(cfg.webuiUrl, cfg.webui.adminUser, cfg.webui.adminPass);
  step('70-fleet', 'Login WebUI OK');

  if (cfg.setup?.ensureRouterScriptsApi !== false) {
    const rs = await request('POST', `${cfg.webuiUrl}/api/system/router-scripts/ensure`, {}, token);
    if (rs.status !== 200) warn(`router-scripts/ensure: ${rs.status} ${JSON.stringify(rs.data).slice(0, 120)}`);
    else step('70-fleet', 'Router scripts (API) OK');
  }

  if (cfg.setup?.syncClock !== false) {
    const clk = await request('POST', `${cfg.webuiUrl}/api/mikrotik/sync-time`, {}, token);
    if (clk.status === 200) step('70-fleet', 'Đồng bộ giờ VN OK');
    else warn(`sync-time: ${clk.status}`);
  }

  let provisioned = 0;
  let runningWan = 0;
  let runningProxies = 0;
  const initialN = cfg.setup?.initialProxyCount || 0;

  if (initialN > 0) {
    const indices = Array.from({ length: initialN }, (_, i) => i + 1);
    step('70-fleet', `Bật + tạo ${initialN} proxy ban đầu (pppoe-out1..${initialN})...`);
    for (let i = 0; i < indices.length; i += 50) {
      const batch = indices.slice(i, i + 50);
      const en = await request('POST', `${cfg.webuiUrl}/api/wan/bulk-enable`, { indices: batch }, token);
      if (en.status !== 200) {
        warn(`bulk-enable: ${en.status} ${JSON.stringify(en.data).slice(0, 150)}`);
      } else {
        const sum = en.data?.summary;
        step('70-fleet', `bulk-enable batch: ${sum?.succeeded ?? '?'}/${sum?.total ?? batch.length} OK`);
      }
    }
    await sleep(10_000);
  }

  if (cfg.setup?.autoProvisionRunningWan !== false) {
    await waitForWanDiscovery(cfg.webuiUrl, token, cfg.setup?.wanDiscoveryWaitSec || 120);

    const wanRes = await request('GET', `${cfg.webuiUrl}/api/wan`, null, token);
    const wans = Array.isArray(wanRes.data) ? wanRes.data : [];
    const targets = wans.filter(w =>
      w.running && !w.disabled && w.index >= 1 && w.proxyStatus !== 'running',
    );
    runningWan = wans.filter(w => w.running && !w.disabled).length;

    if (!targets.length) {
      step('70-fleet', `Không có pppoe-out RUNNING cần provision (${runningWan} WAN up, proxy đã có hoặc chưa bật PPPoE pool)`);
    } else {
      step('70-fleet', `Auto-provision ${targets.length} pppoe-out đang RUNNING...`);
      const delayMs = cfg.setup?.provisionDelayMs || 12_000;
      for (const w of targets) {
        step('70-fleet', `Provision pppoe-out${w.index}...`);
        const pr = await request('POST', `${cfg.webuiUrl}/api/wan/${w.index}/provision/now`, {}, token);
        if (pr.status === 200) {
          provisioned++;
        } else {
          warn(`provision out${w.index}: ${pr.status} ${JSON.stringify(pr.data).slice(0, 100)}`);
        }
        await sleep(delayMs);
      }
    }

    const waitSec = cfg.setup?.maxProvisionWaitSec || 900;
    const deadline = Date.now() + waitSec * 1000;
    step('70-fleet', `Chờ proxy running (tối đa ${waitSec}s)...`);
    while (Date.now() < deadline) {
      const pr = await request('GET', `${cfg.webuiUrl}/api/proxies`, null, token);
      const proxies = Array.isArray(pr.data) ? pr.data : [];
      runningProxies = proxies.filter(p => p.status === 'running').length;
      const pending = proxies.filter(p => ['pending', 'stopped'].includes(p.status || '')).length;
      step('70-fleet', `Proxy: ${runningProxies} running, ${pending} pending (${Math.round((deadline - Date.now()) / 1000)}s còn lại)`);
      const target = Math.max(provisioned, initialN);
      if (target > 0 && runningProxies >= target) break;
      if (!target && runningProxies > 0) break;
      if (target > 0 && pending === 0 && runningProxies >= target) break;
      await sleep(15_000);
    }
  }

  return {
    ok: true,
    runningWan,
    provisioned,
    runningProxies,
  };
}

module.exports = { run };