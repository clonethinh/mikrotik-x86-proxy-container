#!/usr/bin/env node
/** Heavy traffic + rollup verification for PR-2 */
const { execSync } = require('child_process');
const { loadConfig } = require('../setup/lib/config');
const { connect, exec } = require('../setup/lib/ssh');
const { request, login } = require('../setup/lib/http');

function shellQuote(cmd) {
  return `/bin/sh -c '${cmd.replace(/'/g, "'\\''")}'`;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  const cfg = loadConfig();
  const token = await login(cfg.webuiUrl, cfg.webui.adminUser, cfg.webui.adminPass);
  const pw = await request('GET', `${cfg.webuiUrl}/api/proxies/18/password`, null, token);
  const proxy = `http://u4899:${pw.data.password}@118.71.190.250:30057`;

  console.log('Traffic 90s...');
  const end = Date.now() + 90_000;
  let ok = 0;
  while (Date.now() < end) {
    try {
      execSync(`curl -sS -m 15 -x ${proxy} http://httpbin.org/bytes/30000 -o /dev/null`, { stdio: 'ignore' });
      ok++;
    } catch {}
    await sleep(4000);
  }
  console.log(`curl ok: ${ok}`);
  console.log('Wait 40s flush...');
  await sleep(40_000);

  const conn = await connect(cfg);
  const cnt = await exec(
    conn,
    `/container/shell webuiproxymikrotik cmd="${shellQuote('sqlite3 /data/proxy.db "SELECT COUNT(*), MAX(ts) FROM ProxyTrafficSample WHERE proxyId=18;"')}"`,
    30000,
  );
  console.log('DB:', cnt.trim());

  const admin = await exec(
    conn,
    `/container/shell webuiproxymikrotik cmd="${shellQuote('wget -qO- --user=_webui_mon --password=$(grep _webui_mon:CL: /data/hub-3proxy.cfg 2>/dev/null | head -1 | cut -d: -f3) http://172.18.0.3:31800/S 2>&1 | head -c 400')}"`,
    20000,
  ).catch(e => e.message);
  console.log('admin /S snippet:', String(admin).slice(0, 300));
  conn.end();

  const rollup = await request('POST', `${cfg.webuiUrl}/api/system/metrics/rollup`, {}, token);
  console.log('rollup:', JSON.stringify(rollup.data));

  const hist = await request('GET', `${cfg.webuiUrl}/api/proxies/18/metrics/history?period=hour`, null, token);
  console.log('history hour:', hist.data?.length, 'buckets');
  if (hist.data?.length) {
    const last = hist.data[hist.data.length - 1];
    console.log('last bucket:', last);
  }

  const live = await request('GET', `${cfg.webuiUrl}/api/proxies/18/metrics/live`, null, token);
  console.log('live:', JSON.stringify(live.data));
}

main().catch(e => { console.error(e); process.exit(1); });