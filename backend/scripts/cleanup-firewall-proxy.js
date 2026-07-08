/**
 * Dọn firewall + proxy fleet orphan — giữ webuiproxymikrotik + pppoe-out1/wan
 */
const { Client } = require('ssh2');
const http = require('http');

const HOST = process.env.MIKROTIK_HOST || '113.22.235.54';
const USER = process.env.MIKROTIK_SSH_USER || 'admin';
const PASS = process.env.MIKROTIK_SSH_PASS || 'toanthinh';
const WEBUI = process.env.WEBUI_URL || `http://${HOST}:8088`;

function ssh(conn, cmd, ms = 120000) {
  return new Promise((resolve, reject) => {
    let out = '';
    const t = setTimeout(() => reject(new Error(`timeout: ${cmd.slice(0, 60)}`)), ms);
    conn.exec(cmd, (err, s) => {
      if (err) { clearTimeout(t); return reject(err); }
      s.on('close', () => { clearTimeout(t); resolve(out); });
      s.on('data', d => { out += d; });
      s.stderr.on('data', d => { out += d; });
    });
  });
}

function httpJson(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const u = new URL(path, WEBUI);
    const payload = body != null ? JSON.stringify(body) : undefined;
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (payload) headers['Content-Type'] = 'application/json';
    const req = http.request({
      hostname: u.hostname, port: u.port || 80, path: u.pathname, method, headers,
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        let j = d;
        try { j = JSON.parse(d); } catch {}
        resolve({ status: res.statusCode, data: j });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

const FILTER_ORPHAN = [
  'webuiproxymikrotik-fwd-http-',
  'webuiproxymikrotik-fwd-socks-',
  'webuiproxymikrotik-in-http-',
  'webuiproxymikrotik-accept-proxy-range',
  'webuiproxymikrotik-accept-input-proxy',
  'WAN-pppoe-wan-allow-proxy-',
  'WAN-pppoe-wan-fwd-proxy',
];

async function main() {
  const conn = new Client();
  await new Promise((res, rej) => {
    conn.on('ready', res);
    conn.on('error', rej);
    conn.connect({ host: HOST, port: 22222, username: USER, password: PASS, readyTimeout: 30000 });
  });
  console.log('SSH OK\n');

  console.log('=== STOP/REMOVE proxy3p containers ===');
  await ssh(conn, '/container/stop [find where name~"^proxy3p-"]');
  await sleep(8000);
  const rmCtn = await ssh(conn, '/container/remove [find where name~"^proxy3p-"]');
  console.log(rmCtn.trim() || '(removed)');

  console.log('\n=== REMOVE veth-3p + orphan veth8/veth9 ===');
  for (const v of ['veth-3p-2', 'veth-3p-3', 'veth8', 'veth9']) {
    await ssh(conn, `:do {/interface/bridge/port/remove [find interface=${v}]} on-error={}`);
    await ssh(conn, `:do {/interface/veth/remove [find name=${v}]} on-error={}`);
    console.log(`  ${v}: removed`);
  }

  console.log('\n=== REMOVE gateway IPs ===');
  await ssh(conn, ':do {/ip/address/remove [find comment~"^gw-veth-3p-"]} on-error={}');

  console.log('\n=== FIREWALL: NAT orphan ===');
  await ssh(conn, ':do {/ip/firewall/nat/remove [find comment~"ctn-pppoe-out"]} on-error={}');
  await ssh(conn, ':do {/ip/firewall/nat/remove [find comment~"ctn-pppoe-out"]} on-error={}');

  console.log('=== FIREWALL: mangle orphan ===');
  await ssh(conn, ':do {/ip/firewall/mangle/remove [find comment~"ctn-mangle-pppoe-out"]} on-error={}');

  console.log('=== FIREWALL: filter orphan (per idx + legacy) ===');
  for (let i = 2; i <= 99; i++) {
    await ssh(conn, `:do {/ip/firewall/filter/remove [find comment=webuiproxymikrotik-fwd-http-${i}]} on-error={}`);
    await ssh(conn, `:do {/ip/firewall/filter/remove [find comment=webuiproxymikrotik-fwd-socks-${i}]} on-error={}`);
    await ssh(conn, `:do {/ip/firewall/filter/remove [find comment=webuiproxymikrotik-in-http-${i}]} on-error={}`);
  }
  for (const prefix of FILTER_ORPHAN) {
    await ssh(conn, `:do {/ip/firewall/filter/remove [find comment~"${prefix}"]} on-error={}`);
  }

  console.log('\n=== ROUTING: to_pppoe* ===');
  for (let i = 2; i <= 99; i++) {
    const t = `to_pppoe${i}`;
    await ssh(conn, `:do {/ip/route/remove [find routing-table=${t}]} on-error={}`);
    await ssh(conn, `:do {/routing/table/remove [find name=${t}]} on-error={}`);
  }

  console.log('\n=== MOUNTS / ENV / FILES ===');
  await ssh(conn, ':do {/container/mounts/remove [find list~"^MOUNT_PROXY_"]} on-error={}');
  await ssh(conn, ':do {/container/envlist/remove [find name~"^ENV_3PROXY_"]} on-error={}');
  await ssh(conn, ':do {/file/remove [find name~"disk1/users-"]} on-error={}');
  await ssh(conn, ':do {/disk/remove [find name~"3proxy-p"]} on-error={}');

  console.log('\n=== AUDIT AFTER CLEAN ===');
  for (const cmd of [
    '/container/print',
    '/interface/veth/print',
    '/ip/firewall/filter/print where comment~"webuiproxymikrotik"',
    '/ip/firewall/nat/print',
    '/ip/firewall/mangle/print',
    '/routing/table/print where name~"to_pppoe"',
  ]) {
    console.log(`\n--- ${cmd} ---`);
    console.log((await ssh(conn, cmd)).trim() || '(empty)');
  }

  conn.end();

  console.log('\n=== WEBUI purge-fleet ===');
  const login = await httpJson('POST', '/api/auth/login', { username: 'admin', password: 'admin123' });
  if (login.status === 200 && login.data?.token) {
    const purge = await httpJson('POST', '/api/system/purge-fleet', {}, login.data.token);
    const proxies = await httpJson('GET', '/api/proxies', null, login.data.token);
    console.log('purge-fleet:', purge.data);
    console.log('proxies:', Array.isArray(proxies.data) ? proxies.data.length : proxies.data);
  }

  console.log('\n=== CLEANUP FIREWALL PROXY DONE ===');
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });