#!/usr/bin/env node
const { spawnSync } = require('child_process');
const { loadConfig } = require('../setup/lib/config');
const { connect, exec } = require('../setup/lib/ssh');
const { request, login } = require('../setup/lib/http');

function parseCfg(content) {
  const users = {};
  const m = content.match(/^users (.+)$/m);
  if (m) {
    for (const part of m[1].split(' ')) {
      const x = part.match(/^([^:]+):CL:(.+)$/);
      if (x) users[x[1]] = x[2];
    }
  }
  const out = [];
  let u = null;
  for (const line of content.split('\n')) {
    const t = line.trim();
    if (t.startsWith('allow ') && !t.includes('ADMIN') && !t.includes('*')) u = t.split(/\s+/)[1];
    const pm = t.match(/^proxy -n -a -p(\d+) -i/);
    if (pm) out.push({ port: +pm[1], user: u, pass: users[u] });
  }
  return out;
}

function testCurl(ip, port, user, pass) {
  const proxy = `http://${user}:${pass}@${ip}:${port}`;
  const r = spawnSync('curl', [
    '-sS', '-m', '10',
    '-x', proxy,
    'http://api.ipify.org?format=json',
    '-o', '/tmp/proxy-test-body.txt',
    '-w', '%{http_code}',
  ], { encoding: 'utf8', timeout: 12000 });

  const code = parseInt((r.stdout || '').trim(), 10) || 0;
  let body = '';
  try { body = require('fs').readFileSync('/tmp/proxy-test-body.txt', 'utf8'); } catch {}

  if (code === 200) {
    let egress = null;
    try { egress = JSON.parse(body).ip; } catch {}
    return { ok: true, code, egress };
  }
  if (code === 407) return { ok: false, code, err: '407 sai user/pass' };
  const err = (r.stderr || r.stdout || body || 'unknown').trim().slice(0, 120);
  return { ok: false, code, err: code ? `HTTP ${code}` : err };
}

async function main() {
  const cfg = loadConfig();
  const token = await login(cfg.webuiUrl, cfg.webui.adminUser, cfg.webui.adminPass);
  const res = await request('GET', `${cfg.webuiUrl}/api/proxies`, null, token);
  const byUser = Object.fromEntries((res.data || []).map(p => [p.username, p]));
  const conn = await connect(cfg);
  const raw = await exec(conn, ':put [/file get disk1/hub-3proxy.cfg contents]', 30000);
  conn.end();

  const extBase = cfg.network?.extHttpPortBase || 30055;
  const list = parseCfg(raw).filter(p => p.port >= extBase);
  const results = [];

  for (const p of list) {
    const meta = byUser[p.user];
    const ip = meta?.publicIp;
    if (!ip) {
      results.push({ ...p, ip: null, r: { ok: false, err: 'no publicIp' } });
      continue;
    }
    const r = testCurl(ip, p.port, p.user, p.pass);
    results.push({ ...p, ip, r });
    process.stderr.write(`${r.ok ? 'PASS' : 'FAIL'} ${ip}:${p.port} ${p.user}\n`);
  }

  const ok = results.filter(x => x.r.ok);
  const authFail = results.filter(x => x.r.code === 407);
  const netFail = results.filter(x => !x.r.ok && x.r.code !== 407);

  console.log('\n========== KET QUA TEST HTTP PROXY ==========');
  console.log(`Tong: ${results.length} | PASS: ${ok.length} | FAIL: ${results.length - ok.length}`);
  console.log(`  - Sai pass (407): ${authFail.length}`);
  console.log(`  - Loi mang/port: ${netFail.length}`);

  console.log('\n--- PASS (user/pass OK) ---');
  for (const x of ok) {
    const match = x.ip === x.r.egress ? 'ip-khop' : `egress=${x.r.egress}`;
    console.log(`${x.ip}:${x.port}:${x.user}:${x.pass} (${match})`);
  }

  console.log('\n--- FAIL ---');
  for (const x of netFail) {
    console.log(`${x.ip}:${x.port}:${x.user}:${x.pass} -> ${x.r.err}`);
  }
  for (const x of authFail) {
    console.log(`${x.ip}:${x.port}:${x.user}:${x.pass} -> SAI PASS`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });