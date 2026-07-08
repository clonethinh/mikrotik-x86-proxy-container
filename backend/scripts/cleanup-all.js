/**
 * Dọn dẹp toàn bộ proxy cũ trên router + DB WebUI
 * Giữ: pppoe-out1, pppoe-wan, webuiproxymikrotik
 */
const { Client } = require('ssh2');
const http = require('http');

const HOST = '113.22.235.54';
const USER = 'admin';
const PASS = 'toanthinh';

function sshExec(conn, cmd, ms = 120000) {
  return new Promise((resolve, reject) => {
    let out = '';
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    conn.exec(cmd, (err, stream) => {
      if (err) { clearTimeout(t); return reject(err); }
      stream.on('close', () => { clearTimeout(t); resolve(out); });
      stream.on('data', d => { out += d; });
      stream.stderr.on('data', d => { out += d; });
    });
  });
}

async function apiCall(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(`http://${HOST}:8088${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
      timeout: 20000,
    }, res => {
      let d = '';
      res.on('data', c => { d += c; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(JSON.parse(d || '{}'));
        else reject(new Error(`${method} ${path} ${res.statusCode}: ${d.slice(0, 200)}`));
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  const conn = new Client();
  await new Promise((res, rej) => {
    conn.on('ready', res);
    conn.on('error', rej);
    conn.connect({ host: HOST, port: 22, username: USER, password: PASS, readyTimeout: 20000 });
  });
  console.log('=== ROUTER CLEANUP ===\n');

  // 1. Stop + remove all proxy3p containers
  console.log('1. Remove proxy3p containers...');
  let out = await sshExec(conn, `:foreach c in=[/container/find where name~"proxy3p"] do={
    :local n [/container/get $c name]
    :do {/container/stop $c} on-error={}
    :delay 2s
    :do {/container/remove $c} on-error={:put ("FAIL remove " . $n)}
    :put ("removed " . $n)
  }`);
  console.log(out.trim() || '  (none)');

  // 2. Cleanup idx 2..120 (idempotent)
  console.log('2. Cleanup proxy resources idx 2-120...');
  for (let idx = 2; idx <= 120; idx++) {
    const ifName = `pppoe-out${idx}`;
    const vethName = `veth-3p-${idx}`;
    const rmark = `to_pppoe${idx}`;
    await sshExec(conn, `
:do {/ip/firewall/nat/remove [find comment~"ctn-pppoe-out${idx}"]} on-error={}
:do {/ip/firewall/nat/remove [find comment="ctn-${ifName}"]} on-error={}
:do {/ip/firewall/mangle/remove [find comment="ctn-mangle-${ifName}"]} on-error={}
:do {/ip/firewall/filter/remove [find comment="webuiproxymikrotik-fwd-http-${idx}"]} on-error={}
:do {/ip/firewall/filter/remove [find comment="webuiproxymikrotik-fwd-socks-${idx}"]} on-error={}
:do {/ip/firewall/filter/remove [find comment="webuiproxymikrotik-in-http-${idx}"]} on-error={}
:do {/ip/route/remove [find routing-table=${rmark}]} on-error={}
:do {/routing/table/remove [find name=${rmark}]} on-error={}
:do {/ip/address/remove [find comment="gw-${vethName}"]} on-error={}
:do {/interface/bridge/port/remove [find interface=${vethName}]} on-error={}
:do {/interface/veth/remove [find name=${vethName}]} on-error={}
:do {/container/mounts/remove [find list=MOUNT_PROXY_${idx}]} on-error={}
:do {/container/envlist/remove [find name=ENV_3PROXY_${idx}]} on-error={}
:do {/file/remove [find name=disk1/users-${idx}.json]} on-error={}
`, 15000).catch(() => {});
  }
  console.log('  done');

  // 3. Orphan veths
  console.log('3. Remove orphan veths...');
  out = await sshExec(conn, `:foreach v in=[/interface/veth/find where name!="veth-webui"] do={
    :local n [/interface/veth/get $v name]
    :do {/interface/bridge/port/remove [find interface=$n]} on-error={}
    :do {/interface/veth/remove $v} on-error={:put ("FAIL " . $n)}
    :put ("removed veth " . $n)
  }`);
  console.log(out.trim() || '  (none)');

  // 4. Legacy firewall ranges
  console.log('4. Remove legacy firewall rules...');
  const legacyComments = [
    'webuiproxymikrotik-accept-proxy-range',
    'webuiproxymikrotik-accept-proxy-range-socks',
    'webuiproxymikrotik-accept-input-proxy',
    'webuiproxymikrotik-accept-input-proxy-internal',
    'webuiproxymikrotik-accept-input-proxy-socks-internal',
    'webuiproxymikrotik-accept-input-proxy-loopback',
    'webuiproxymikrotik-accept-input-proxy-loopback-socks',
    'WAN-pppoe-wan-allow-proxy-http',
    'WAN-pppoe-wan-allow-proxy-socks',
    'WAN-pppoe-wan-fwd-proxy',
  ];
  for (const c of legacyComments) {
    await sshExec(conn, `:do {/ip/firewall/filter/remove [find comment="${c}"]} on-error={}`).catch(() => {});
  }
  console.log('  removed', legacyComments.length, 'legacy rule types');

  // 5. Old 3proxy root dirs + orphan container stores (not webuiproxymikrotik-root4)
  console.log('5. Remove old 3proxy disks...');
  out = await sshExec(conn, `:foreach d in=[/disk/find where name~"3proxy-p"] do={
    :do {/disk/remove $d} on-error={}
  }
:foreach d in=[/disk/find where name~"webuiproxymikrotik-root" and name!="webuiproxymikrotik-root4"] do={
    :do {/disk/remove $d} on-error={:put ("skip " . [/disk/get $d name])}
    :put ("removed " . [/disk/get $d name])
  }`);
  console.log(out.trim() || '  (none)');

  // 6. Old duplicate 3proxy tarballs (giữ 3proxy.tar)
  console.log('6. Remove duplicate 3proxy tars...');
  const oldTars = ['3proxy-v2.tar', '3proxy-v3.tar', '3proxy-busybox.tar', '3proxy-iponly.tar', '3proxy-v2.tar.txt'];
  for (const f of oldTars) {
    await sshExec(conn, `:do {/file/remove [find name=disk1/${f}]} on-error={}`).catch(() => {});
  }
  console.log('  done');

  // 7. Summary
  console.log('\n7. Final state:');
  for (const cmd of [
    '/interface pppoe-client print count-only',
    '/container print',
    '/interface veth print count-only',
    '/ip firewall nat print count-only',
    '/ip firewall mangle print count-only',
  ]) {
    const r = await sshExec(conn, cmd);
    console.log(`  ${cmd}: ${r.trim()}`);
  }

  conn.end();

  // 8. Purge WebUI DB
  console.log('\n=== WEBUI DB CLEANUP ===');
  const login = await apiCall('POST', '/api/auth/login', { username: 'admin', password: 'admin123' });
  const token = login.token;
  const fleet = await apiCall('POST', '/api/system/purge-fleet', null, token);
  const wan = await apiCall('POST', '/api/system/purge-wan-state', null, token);
  console.log('  purge-fleet:', fleet);
  console.log('  purge-wan-state:', wan);

  const settings = await apiCall('GET', '/api/settings/auto-proxy', null, token);
  console.log('\n=== DONE ===');
  console.log('  PPPoE: pppoe-out1 + pppoe-wan');
  console.log('  WebUI: RUNNING, auto-proxy:', settings.mode);
  console.log('  URL: http://ntpcproxy.duckdns.org:8088');
}

main().catch(e => { console.error('CLEANUP FAILED:', e.message); process.exit(1); });