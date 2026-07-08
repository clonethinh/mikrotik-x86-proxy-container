#!/usr/bin/env node
/** PR-0 verification only (no build/deploy). */
const { loadConfig } = require('../setup/lib/config');
const { connect, exec } = require('../setup/lib/ssh');
const { request, login } = require('../setup/lib/http');
const { step } = require('../setup/lib/logger');

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function hubShardSpec(shardId) {
  if (shardId === 0) {
    return { name: 'proxy3p-hub', adminPort: 31800 };
  }
  return { name: `proxy3p-hub-${shardId + 1}`, adminPort: 31800 + shardId };
}

function shellQuote(cmd) {
  return `/bin/sh -c '${cmd.replace(/'/g, "'\\''")}'`;
}

async function getMonitorPassword(conn) {
  const cfg = await exec(conn, '/file/print detail where name=disk1/hub-3proxy.cfg', 30000);
  const m = cfg.match(/_webui_mon:CL:([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

async function syncViaReapply(cfg, token) {
  const proxies = await request('GET', `${cfg.webuiUrl}/api/proxies`, null, token);
  if (proxies.status !== 200) return;
  const enabled = proxies.data.filter(p => p.enabled);
  const seen = new Set();
  for (const p of enabled) {
    const shard = Math.floor((p.pppoeIdx - 1) / 50);
    if (seen.has(shard)) continue;
    seen.add(shard);
    step('sync', `reapply proxy ${p.id} shard ${shard + 1}...`);
    try {
      await new Promise((resolve, reject) => {
        const http = require('http');
        const u = new URL(`${cfg.webuiUrl}/api/proxies/${p.id}/reapply`);
        const req = http.request({
          hostname: u.hostname,
          port: u.port,
          path: u.pathname,
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Length': 0 },
          timeout: 180000,
        }, res => {
          let d = '';
          res.on('data', c => { d += c; });
          res.on('end', () => resolve({ status: res.statusCode, data: d }));
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
        req.end();
      });
    } catch (e) {
      step('sync', `reapply ${p.id} warn: ${e.message}`);
    }
    await sleep(5000);
  }
}

async function main() {
  const cfg = loadConfig();
  const doSync = process.argv.includes('--sync');
  const token = await login(cfg.webuiUrl, cfg.webui.adminUser, cfg.webui.adminPass);
  if (doSync) await syncViaReapply(cfg, token);

  const conn = await connect(cfg);
  const results = {};
  try {
    const monPass = await getMonitorPassword(conn);
    results.monitor_password = !!monPass;

    for (let sid = 0; sid < (cfg.hub?.shardCount || 2); sid++) {
      const s = hubShardSpec(sid);
      const st = await exec(conn, `/container/print where name=${s.name}`);
      const running = /\s[RCUH]\s/.test(st) || st.includes('RUNNING') || st.includes('HEALTHY');
      results[`${s.name}_running`] = running;
      if (!running) {
        if (sid > 0) results[`${s.name}_optional`] = true;
        continue;
      }

      const cfgOut = await exec(
        conn,
        `/container/shell ${s.name} cmd="/bin/sh -c 'grep -E \\\"^(admin|log |logformat|counter)\\\" /etc/3proxy/3proxy.cfg | head -8'"`,
        20000,
      );
      results[`cfg_admin_s${sid + 1}`] = cfgOut.includes('admin -s');
      results[`cfg_log_s${sid + 1}`] = cfgOut.includes('/var/log/3proxy/');
      results[`cfg_logformat_s${sid + 1}`] = cfgOut.includes('logformat');

      const lsLog = await exec(
        conn,
        `/container/shell ${s.name} cmd="${shellQuote(`ls /var/log/3proxy/shard${sid + 1}-*.log 2>/dev/null | head -1`)}`,
        15000,
      );
      const logFile = (lsLog.match(/shard\d+-\d+\.log/) || [])[0];
      if (logFile) {
        const adminLog = await exec(
          conn,
          `/container/shell ${s.name} cmd="${shellQuote(`tail -1 /var/log/3proxy/${logFile}`)}"`,
          15000,
        );
        results[`admin_logged_s${sid + 1}`] = adminLog.includes('_webui_mon') && adminLog.includes('ADMIN');
      }

      const logOut = await exec(
        conn,
        `/container/shell ${s.name} cmd="/bin/sh -c 'ls -la /var/log/3proxy/ 2>&1; ls /var/log/3proxy/shard${sid + 1}-*.log 2>/dev/null | head -1'"`,
        15000,
      );
      results[`log_dir_s${sid + 1}`] = logOut.includes('total') || logOut.includes('drwx');
      results[`log_file_s${sid + 1}`] = new RegExp(`shard${sid + 1}-\\d{6}\\.log`).test(logOut);

      const pidOut = await exec(conn, `/container/shell ${s.name} cmd="${shellQuote('pidof 3proxy')}"`, 15000).catch(() => '');
      const pid = (pidOut.match(/\d+/) || [])[0];
      if (pid) {
        await exec(conn, `/container/shell ${s.name} cmd="${shellQuote(`kill -USR1 ${pid}`)}"`, 10000).catch(() => {});
        await sleep(2000);
        const alive = await exec(conn, `/container/shell ${s.name} cmd="${shellQuote(`kill -0 ${pid} && echo RELOAD_OK`)}"`, 10000).catch(() => '');
        results[`sigusr1_s${sid + 1}`] = alive.includes('RELOAD_OK');
      } else {
        results[`sigusr1_s${sid + 1}`] = false;
      }
    }
  } finally {
    conn.end();
  }

  const health = await request('GET', `${cfg.webuiUrl}/api/health`);
  results.webui_health = health.status === 200;

  const proxies = await request('GET', `${cfg.webuiUrl}/api/proxies`, null, token);
  if (proxies.status === 200 && proxies.data?.length) {
    const p = proxies.data.find(x => x.enabled) || proxies.data[0];
    const live = await request('GET', `${cfg.webuiUrl}/api/proxies/${p.id}/metrics/live`, null, token);
    results.metrics_api = live.status === 200;
    if (live.status === 200) {
      results.metrics_has_data = live.data?.clients !== undefined;
    }
  }

  const optional = new Set(['proxy3p-hub-2_running']);
  console.log('\n=== PR-0 Test Results ===');
  let pass = 0;
  let fail = 0;
  for (const [k, v] of Object.entries(results)) {
    if (k.endsWith('_optional')) continue;
    const ok = optional.has(k) ? true : v;
    const mark = optional.has(k) ? '○' : (v ? '✓' : '✗');
    console.log(`  ${mark} ${k}: ${v}${optional.has(k) ? ' (optional — no proxies on shard 2)' : ''}`);
    if (ok) pass++; else fail++;
  }
  console.log(`\n${pass}/${pass + fail} required checks passed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('Test failed:', e.message);
  process.exit(1);
});