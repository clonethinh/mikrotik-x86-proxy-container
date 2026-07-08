#!/usr/bin/env node
/**
 * Load test proxies + monitor MikroTik CPU/profile during traffic.
 */
const { spawn } = require('child_process');
const { loadConfig } = require('../setup/lib/config');
const { connect, exec } = require('../setup/lib/ssh');
const { request, login } = require('../setup/lib/http');

const DURATION_SEC = 45;
const PARALLEL = 16;
const TEST_URLS = [
  'http://speedtest.tele2.net/10MB.zip',
  'http://ipv4.download.thinkbroadband.com/5MB.zip',
  'http://cachefly.cachefly.net/10mb.test',
];

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

function parseCpu(text) {
  const loads = [...text.matchAll(/cpu\d+\s+(\d+)%/g)].map(m => +m[1]);
  return loads.length ? { loads, avg: loads.reduce((a, b) => a + b, 0) / loads.length } : { loads: [], avg: null };
}

function parseProfile(text) {
  const rows = [];
  for (const line of text.split('\n')) {
    const m = line.trim().match(/^(\S+)\s+([\d.]+%)\s*$/);
    if (m && m[1] !== 'Columns:') rows.push({ name: m[1], usage: m[2] });
  }
  return rows.sort((a, b) => parseFloat(b.usage) - parseFloat(a.usage)).slice(0, 12);
}

async function getProxies(cfg, conn) {
  const token = await login(cfg.webuiUrl, cfg.webui.adminUser, cfg.webui.adminPass);
  const res = await request('GET', `${cfg.webuiUrl}/api/proxies`, null, token);
  const byUser = Object.fromEntries((res.data || []).map(p => [p.username, p]));
  const raw = await exec(conn, ':put [/file get disk1/hub-3proxy.cfg contents]', 30000);
  const extBase = cfg.network?.extHttpPortBase || 30055;
  return parseCfg(raw)
    .filter(p => p.port >= extBase && p.pass)
    .map(p => {
      const meta = byUser[p.user];
      if (!meta?.publicIp || meta.publicIp.startsWith('169.254.')) return null;
      return {
        publicIp: meta.publicIp,
        extHttpPort: p.port,
        username: p.user,
        password: p.pass,
        pppoeIdx: meta.pppoeIdx,
      };
    })
    .filter(Boolean);
}

function curlThrough(proxy, url) {
  const { publicIp, extHttpPort, username, password } = proxy;
  const proxyUrl = `http://${username}:${password}@${publicIp}:${extHttpPort}`;
  return new Promise(resolve => {
    const t0 = Date.now();
    const child = spawn('curl', [
      '-sS', '-m', String(DURATION_SEC + 10),
      '-x', proxyUrl,
      url, '-o', '/dev/null',
      '-w', '%{http_code}:%{size_download}:%{speed_download}',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.on('close', code => {
      const elapsed = (Date.now() - t0) / 1000;
      const parts = out.trim().split(':');
      const httpCode = parseInt(parts[0] || '0', 10) || 0;
      const bytes = parseInt(parts[1] || '0', 10) || 0;
      const speed = parseFloat(parts[2] || '0') || 0;
      resolve({ code: httpCode === 200 ? 0 : (code || httpCode), bytes, speed, elapsed, proxy: `${publicIp}:${extHttpPort}`, httpCode });
    });
    child.on('error', e => resolve({ code: -1, bytes: 0, speed: 0, elapsed: 0, err: e.message, proxy: `${publicIp}:${extHttpPort}` }));
  });
}

async function sampleRouter(conn, label) {
  const [cpu, res, prof, conns, hubCpu] = await Promise.all([
    exec(conn, '/system resource cpu print', 8000).catch(() => ''),
    exec(conn, '/system resource print', 8000).catch(() => ''),
    exec(conn, '/tool profile duration=5', 12000).catch(() => ''),
    exec(conn, '/ip firewall connection print count-only', 8000).catch(() => '0'),
    exec(conn, '/container print detail where name=proxy3p-hub', 10000).catch(() => ''),
  ]);
  const cpuInfo = parseCpu(cpu);
  const hubMatch = hubCpu.match(/cpu-usage=([^\s]+)/);
  const memMatch = hubCpu.match(/memory-current=([^\s]+)/);
  return {
    label,
    cpuLoads: cpuInfo.loads,
    cpuAvg: cpuInfo.avg,
    hubCpu: hubMatch ? hubMatch[1] : '?',
    hubMem: memMatch ? memMatch[1] : '?',
    conntrack: parseInt(conns.trim(), 10) || 0,
    profile: parseProfile(prof),
    uptime: (res.match(/uptime:\s*([^\n]+)/) || [])[1]?.trim(),
  };
}

async function vethDelta(conn, iface, sec = 10) {
  const parse = s => {
    const m = s.match(new RegExp(`${iface}\\s+([\\d ]+)\\s+([\\d ]+)`, 'i'));
    if (m) {
      return {
        rx: parseInt(m[1].replace(/\s/g, ''), 10),
        tx: parseInt(m[2].replace(/\s/g, ''), 10),
      };
    }
    return null;
  };
  const b = await exec(conn, `/interface print stats without-paging where name=${iface}`, 10000);
  const b1 = parse(b);
  await new Promise(r => setTimeout(r, sec * 1000));
  const a = await exec(conn, `/interface print stats without-paging where name=${iface}`, 10000);
  const a1 = parse(a);
  if (!b1 || !a1) return { iface, error: 'parse fail', raw: b.slice(0, 300) };
  const drx = a1.rx - b1.rx;
  const dtx = a1.tx - b1.tx;
  return {
    iface,
    sec,
    rxMbps: ((drx * 8) / sec / 1e6).toFixed(2),
    txMbps: ((dtx * 8) / sec / 1e6).toFixed(2),
    rxMiB: (drx / 1024 / 1024).toFixed(2),
    txMiB: (dtx / 1024 / 1024).toFixed(2),
  };
}

async function main() {
  const cfg = loadConfig();
  const conn = await connect(cfg);
  const proxies = await getProxies(cfg, conn);
  if (proxies.length < 3) throw new Error(`Not enough proxies: ${proxies.length}`);

  const picks = proxies.slice(0, PARALLEL);
  console.log(`\n=== LOAD TEST: ${PARALLEL} parallel x ${DURATION_SEC}s ===`);
  console.log('proxies:', picks.map(p => `${p.publicIp}:${p.extHttpPort}`).join(', '));

  const baseline = await sampleRouter(conn, 'baseline');
  console.log('\n--- BASELINE ---');
  console.log(JSON.stringify(baseline, null, 2));

  const vethPromise = vethDelta(conn, 'veth-3p-hub', 20);

  const workers = [];
  for (let i = 0; i < picks.length; i++) {
    const p = picks[i];
    for (let r = 0; r < 3; r++) {
      workers.push(curlThrough(p, TEST_URLS[(i + r) % TEST_URLS.length]));
    }
  }
  console.log(`workers: ${workers.length} curl streams`);

  await new Promise(r => setTimeout(r, 8000));
  const mid = await sampleRouter(conn, 'under-load-8s');
  console.log('\n--- UNDER LOAD (+8s) ---');
  console.log(JSON.stringify(mid, null, 2));

  await new Promise(r => setTimeout(r, 12000));
  const mid2 = await sampleRouter(conn, 'under-load-20s');
  console.log('\n--- UNDER LOAD (+20s) ---');
  console.log(JSON.stringify(mid2, null, 2));

  const results = await Promise.all(workers);
  const veth = await vethPromise;

  const ok = results.filter(r => r.code === 0);
  const totalBytes = ok.reduce((s, r) => s + r.bytes, 0);
  const totalMbps = ok.reduce((s, r) => s + r.speed * 8, 0) / 1e6;

  const after = await sampleRouter(conn, 'after-load');
  console.log('\n--- AFTER LOAD ---');
  console.log(JSON.stringify(after, null, 2));

  console.log('\n--- CURL RESULTS ---');
  console.log(`ok: ${ok.length}/${results.length}, total downloaded: ${(totalBytes / 1024 / 1024).toFixed(2)} MiB`);
  console.log(`sum curl speed: ${totalMbps.toFixed(2)} Mbps (client-side)`);
  for (const r of results.slice(0, 8)) {
    console.log(`  ${r.proxy} code=${r.code} ${(r.bytes / 1024).toFixed(0)}KiB ${(r.speed * 8 / 1e6).toFixed(2)}Mbps ${r.err || ''}`);
  }

  console.log('\n--- VETH THROUGHPUT ---');
  console.log(JSON.stringify(veth, null, 2));

  console.log('\n=== SUMMARY ===');
  console.log(`CPU baseline: ${baseline.cpuLoads.join('% / ')}%  avg=${baseline.cpuAvg?.toFixed(1)}%`);
  console.log(`CPU peak:     ${mid2.cpuLoads.join('% / ')}%  avg=${mid2.cpuAvg?.toFixed(1)}%`);
  console.log(`hub cpu:      ${baseline.hubCpu} → ${mid2.hubCpu} → ${after.hubCpu}`);
  console.log(`conntrack:    ${baseline.conntrack} → ${mid2.conntrack} → ${after.conntrack}`);
  console.log(`top profile:  ${mid2.profile.slice(0, 5).map(p => `${p.name}=${p.usage}`).join(', ')}`);

  conn.end();
}

main().catch(e => { console.error(e); process.exit(1); });