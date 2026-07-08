#!/usr/bin/env node
/**
 * Kiểm tra kỹ sau deploy: container, API, hub cfg, HTTP+SOCKS5 toàn bộ proxy.
 * Usage: node scripts/test-deploy-full.js
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { loadConfig } = require('../setup/lib/config');
const { connect, exec } = require('../setup/lib/ssh');
const { request, login } = require('../setup/lib/http');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'backend', 'proxy_test_deploy.json');
const ROUTER_IP = process.env.TEST_ROUTER_IP || '113.22.235.54';
const HUB_CFGS = ['disk1/hub-3proxy.cfg', 'disk1/hub-3proxy-2.cfg'];

function parseCfg(content) {
  const users = {};
  const um = content.match(/^users (.+)$/m);
  if (um) {
    for (const part of um[1].split(' ')) {
      const x = part.match(/^([^:]+):CL:(.+)$/);
      if (x && !x[1].startsWith('_webui_mon')) users[x[1]] = x[2];
    }
  }
  const slots = [];
  let u = null;
  for (const line of content.split('\n')) {
    const t = line.trim();
    if (t.startsWith('allow ') && !t.includes('ADMIN') && !t.includes('*')) u = t.split(/\s+/)[1];
    const hm = t.match(/^proxy -n -a -p(\d+) -i([\d.]+)/);
    const sm = t.match(/^socks -n -a -p(\d+) -i([\d.]+)/);
    if (hm) slots.push({ type: 'http', intPort: +hm[1], slotIp: hm[2], user: u, pass: users[u] });
    if (sm) slots.push({ type: 'socks', intPort: +sm[1], slotIp: sm[2], user: u, pass: users[u] });
  }
  return { users, slots };
}

function dedupeUsersFromCfg(slots) {
  const byUser = {};
  for (const s of slots) {
    if (!s.user || !s.pass) continue;
    if (!byUser[s.user]) byUser[s.user] = { user: s.user, pass: s.pass, slotIp: s.slotIp };
  }
  return byUser;
}

function curlProxy(proxyUrl, timeoutSec = 12) {
  const r = spawnSync('curl', [
    '-sS', '-m', String(timeoutSec),
    '-x', proxyUrl,
    'http://api.ipify.org?format=json',
    '-w', '\n%{http_code}',
  ], { encoding: 'utf8', timeout: (timeoutSec + 3) * 1000 });
  const out = (r.stdout || '').trim();
  const lines = out.split('\n');
  const code = parseInt(lines.pop() || '0', 10) || 0;
  const body = lines.join('\n').trim();
  if (code === 200) {
    try {
      const ip = JSON.parse(body).ip;
      return { ok: true, code, ip, ms: null };
    } catch {
      return { ok: false, code, err: 'bad json' };
    }
  }
  const err = (r.stderr || body || 'curl fail').trim().slice(0, 150);
  return { ok: false, code, err: code ? `HTTP ${code}` : err };
}

async function fetchPppoeIps(conn) {
  const raw = await exec(conn, '/interface/pppoe-client/print detail without-paging', 30000);
  const byName = {};
  let cur = null;
  for (const line of raw.split('\n')) {
    const nameM = line.match(/^\s*name=([^\s]+)/);
    if (nameM) cur = nameM[1];
    const runM = line.match(/^\s*running=(yes|true)/i);
    if (cur && runM) byName[cur] = { ...(byName[cur] || {}), running: true };
    const ipM = line.match(/^\s*address=([\d.]+)/);
    if (cur && ipM) byName[cur] = { ...(byName[cur] || {}), ip: ipM[1] };
  }
  // fallback REST-style from /ip/address
  const addrRaw = await exec(conn, '/ip/address/print detail where dynamic=yes without-paging', 30000);
  let iface = null;
  for (const line of addrRaw.split('\n')) {
    const ifM = line.match(/^\s*interface=([^\s]+)/);
    if (ifM) iface = ifM[1];
    const aM = line.match(/^\s*address=([\d.]+)/);
    if (iface && aM && iface.startsWith('pppoe-out')) {
      const ip = aM[1];
      if (!ip.startsWith('169.254.')) {
        byName[iface] = { ...(byName[iface] || {}), ip, running: true };
      }
    }
  }
  return byName;
}

async function main() {
  const cfg = loadConfig();
  const t0 = Date.now();
  const report = { ts: new Date().toISOString(), checks: {}, proxies: [], summary: {} };

  console.log('=== 1. SSH: container status ===');
  const conn = await connect(cfg);
  const ctnOut = await exec(conn, '/container/print detail where name~"webuiproxymikrotik|proxy3p-hub"', 20000);
  const webuiRunning = /name=webuiproxymikrotik[\s\S]*?status=running/i.test(ctnOut) || ctnOut.includes('webuiproxymikrotik');
  const hubRunning = /name=proxy3p-hub[\s\S]*?status=running/i.test(ctnOut) || (ctnOut.match(/proxy3p-hub/g) || []).length > 0;
  report.checks.containers = { raw: ctnOut.slice(0, 800), webui: webuiRunning, hub: hubRunning };
  console.log(webuiRunning ? '  webuiproxymikrotik: OK' : '  webuiproxymikrotik: CHECK');
  console.log(hubRunning ? '  proxy3p-hub: OK' : '  proxy3p-hub: CHECK');

  console.log('\n=== 2. Hub config (no request log?) ===');
  const allSlots = [];
  for (const cfgFile of HUB_CFGS) {
    try {
      const raw = await exec(conn, `:put [/file get ${cfgFile} contents]`, 30000);
      if (!raw || raw.includes('no such item')) continue;
      const hasLog = /^log /m.test(raw);
      const parsed = parseCfg(raw);
      report.checks[cfgFile] = { hasRequestLog: hasLog, users: Object.keys(parsed.users).length, slots: parsed.slots.length };
      console.log(`  ${cfgFile}: slots=${parsed.slots.length} requestLog=${hasLog ? 'YES(bad)' : 'no(good)'}`);
      for (const s of parsed.slots) {
        if (s.type === 'http') allSlots.push({ ...s, cfgFile });
      }
    } catch (e) {
      console.log(`  ${cfgFile}: skip (${e.message})`);
    }
  }

  const pppoeMap = await fetchPppoeIps(conn);
  const pppoeUp = Object.entries(pppoeMap).filter(([, v]) => v.ip && !v.ip.startsWith('169.254.')).length;
  report.checks.pppoe = { total: Object.keys(pppoeMap).length, withIp: pppoeUp };
  console.log(`  PPPoE có IP: ${pppoeUp}`);

  conn.end();

  console.log('\n=== 3. WebUI API ===');
  let token;
  try {
    token = await login(cfg.webuiUrl, cfg.webui.adminUser, cfg.webui.adminPass);
    const dash = await request('GET', `${cfg.webuiUrl}/api/dashboard`, null, token);
    const proxies = await request('GET', `${cfg.webuiUrl}/api/proxies`, null, token);
    report.checks.api = {
      dashboard: !!dash,
      proxyCount: (proxies.data || proxies || []).length,
      enabled: (proxies.data || proxies || []).filter(p => p.enabled).length,
    };
    console.log(`  API OK — proxies: ${report.checks.api.proxyCount} (enabled ${report.checks.api.enabled})`);
  } catch (e) {
    report.checks.api = { error: e.message };
    console.log(`  API FAIL: ${e.message}`);
  }

  console.log('\n=== 4. Test HTTP + SOCKS5 qua IP WAN từng PPPoE ===');
  const credsByUser = dedupeUsersFromCfg(allSlots);
  const apiRows = [];
  if (token) {
    try {
      const proxies = await request('GET', `${cfg.webuiUrl}/api/proxies`, null, token);
      apiRows.push(...(proxies.data || proxies || []));
    } catch {}
  }

  const enabled = apiRows.filter(p => p.enabled);
  let httpPass = 0, httpFail = 0, socksPass = 0, socksFail = 0;

  for (const p of enabled.sort((a, b) => a.pppoeIdx - b.pppoeIdx)) {
    const cred = credsByUser[p.username];
    const pass = cred?.pass || p.password;
    const wanIp = p.publicIp && !p.publicIp.startsWith('169.254.') ? p.publicIp : null;
    const extHttp = p.extHttpPort;
    const extSocks = p.extSocksPort;
    const row = {
      user: p.username,
      pppoeIdx: p.pppoeIdx,
      pppoeName: p.pppoeName,
      wanIp,
      extHttp,
      extSocks,
      http: null,
      socks: null,
    };

    if (wanIp && extHttp && pass) {
      const proxy = `http://${p.username}:${pass}@${wanIp}:${extHttp}`;
      row.http = curlProxy(proxy);
      if (row.http.ok) {
        httpPass++;
        row.http.egressMatch = row.http.ip === wanIp;
      } else httpFail++;
    } else {
      row.http = { ok: false, err: wanIp ? 'no cred/port' : 'no valid WAN IP' };
      httpFail++;
    }

    if (wanIp && extSocks && pass) {
      const proxy = `socks5h://${p.username}:${pass}@${wanIp}:${extSocks}`;
      row.socks = curlProxy(proxy);
      if (row.socks.ok) {
        socksPass++;
        row.socks.egressMatch = row.socks.ip === wanIp;
      } else socksFail++;
    } else {
      row.socks = { ok: false, err: wanIp ? 'no cred/port' : 'no valid WAN IP' };
      socksFail++;
    }

    const h = row.http.ok ? `HTTP PASS ${row.http.ip}${row.http.egressMatch ? '' : ' (egress mismatch!)'}` : `HTTP FAIL ${row.http.err}`;
    const s = row.socks.ok ? `SOCKS PASS ${row.socks.ip}` : `SOCKS FAIL ${row.socks.err}`;
    console.log(`  out${p.pppoeIdx} ${p.username} @ ${wanIp || '?'} — ${h} | ${s}`);
    report.proxies.push(row);
  }
  const users = enabled;

  const egressMismatch = report.proxies.filter(r => r.http?.ok && r.http.egressMatch === false).length;
  report.summary = {
    total: users.length,
    httpPass,
    httpFail,
    socksPass,
    socksFail,
    egressMismatch,
    durationMs: Date.now() - t0,
  };

  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\n========== TONG KET ==========');
  console.log(`Proxy users: ${users.length}`);
  console.log(`HTTP:  ${httpPass} PASS / ${httpFail} FAIL`);
  console.log(`SOCKS: ${socksPass} PASS / ${socksFail} FAIL`);
  console.log(`Saved: ${OUT}`);
  console.log(`Time: ${report.summary.durationMs}ms`);

  const apiOk = !report.checks.api?.error;
  const passRate = users.length ? (httpPass + socksPass) / (users.length * 2) : 0;
  const testsOk = passRate >= 0.85 && httpPass > 0;
  process.exit(apiOk && webuiRunning && testsOk ? 0 : 1);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});