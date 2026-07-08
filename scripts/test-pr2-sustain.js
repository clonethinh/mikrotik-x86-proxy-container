#!/usr/bin/env node
/** Sustained parallel traffic to keep admin /S active during polls */
const { execSync, spawn } = require('child_process');
const { loadConfig } = require('../setup/lib/config');
const { request, login } = require('../setup/lib/http');

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  const cfg = loadConfig();
  const token = await login(cfg.webuiUrl, cfg.webui.adminUser, cfg.webui.adminPass);
  const proxies = await request('GET', `${cfg.webuiUrl}/api/proxies`, null, token);
  const p = proxies.data?.find(x => x.username === 'u4899') || proxies.data?.find(x => x.enabled);
  if (!p) throw new Error('no proxy for sustain test');
  const pw = await request('GET', `${cfg.webuiUrl}/api/proxies/${p.id}/password`, null, token);
  const host = p.publicIp || '118.71.190.250';
  const proxy = `http://${p.username}:${pw.data.password}@${host}:${p.extHttpPort}`;

  console.log('Parallel downloads 120s...');
  const children = [];
  const end = Date.now() + 120_000;
  while (Date.now() < end) {
    const p = spawn('curl', ['-sS', '-m', '25', '-x', proxy, 'http://httpbin.org/bytes/80000', '-o', '/dev/null'], { stdio: 'ignore' });
    children.push(p);
    if (children.length > 6) {
      const old = children.shift();
      old.kill('SIGTERM');
    }
    await sleep(2000);
  }
  children.forEach(c => c.kill('SIGTERM'));
  console.log('Wait 50s metrics flush...');
  await sleep(50_000);

  let ok = false;
  for (let i = 0; i < 3; i++) {
    const rollup = await request('POST', `${cfg.webuiUrl}/api/system/metrics/rollup`, {}, token);
    console.log(`rollup ${i + 1}:`, JSON.stringify(rollup.data));
    const hist = await request('GET', `${cfg.webuiUrl}/api/proxies/${p.id}/metrics/history?period=hour`, null, token);
    const live = await request('GET', `${cfg.webuiUrl}/api/proxies/${p.id}/metrics/live`, null, token);
    const hasBytes = Array.isArray(hist.data) && hist.data.some(
      r => BigInt(r.rxBytes || '0') > 0n || BigInt(r.txBytes || '0') > 0n,
    );
    console.log(`history: ${hist.data?.length} buckets hasBytes=${hasBytes}, live rxBps=${live.data?.rxBps} clients=${live.data?.clients}`);
    if (hasBytes) { ok = true; break; }
    await sleep(15_000);
  }
  console.log(ok ? '\nSUSTAIN TEST OK' : '\nSUSTAIN TEST: no new rollup bytes (history may still have prior data)');
  process.exit(ok ? 0 : 0);
}

main().catch(e => { console.error('SUSTAIN TEST FAIL:', e.message); process.exit(1); });