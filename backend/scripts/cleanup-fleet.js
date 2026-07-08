/**
 * Dọn sạch toàn bộ proxy fleet — giữ pppoe-out1 + pppoe-wan + webuiproxymikrotik
 * Chạy khi reset pool PPPoE, chỉ còn management WAN
 */
const { Client } = require('ssh2');
const http = require('http');

const HOST = process.env.MIKROTIK_HOST || '113.22.235.54';
const USER = process.env.MIKROTIK_SSH_USER || 'admin';
const PASS = process.env.MIKROTIK_SSH_PASS || 'toanthinh';
const WEBUI = process.env.WEBUI_URL || `http://${HOST}:8088`;
const ADMIN_USER = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'admin123';

function sshExec(conn, cmd, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    let out = '';
    const t = setTimeout(() => reject(new Error(`timeout: ${cmd.slice(0, 80)}`)), timeoutMs);
    conn.exec(cmd, (err, stream) => {
      if (err) { clearTimeout(t); return reject(err); }
      stream.on('close', () => { clearTimeout(t); resolve(out); });
      stream.on('data', d => { out += d; process.stdout.write(d); });
      stream.stderr.on('data', d => { out += d; process.stderr.write(d); });
    });
  });
}

function httpJson(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const u = new URL(path, WEBUI);
    const payload = body ? JSON.stringify(body) : null;
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

async function cleanupMikrotik(conn) {
  console.log('\n=== MIKROTIK: stop/remove proxy3p-* containers ===');
  await sshExec(conn, '/container/stop [find where name~"^proxy3p-"]').catch(() => {});
  await new Promise(r => setTimeout(r, 8000));
  await sshExec(conn, '/container/remove [find where name~"^proxy3p-"]').catch(() => {});
  await new Promise(r => setTimeout(r, 3000));

  console.log('\n=== MIKROTIK: remove veth + bridge ports ===');
  await sshExec(conn, `:foreach i in=[/interface/veth/find where name~"^veth-3p-"] do={
  :local n [/interface/veth/get $i name]
  :do {/interface/bridge/port/remove [find interface=$n]} on-error={}
  /interface/veth/remove $i
}`).catch(() => {});

  console.log('\n=== MIKROTIK: remove gateway IPs on bridge ===');
  await sshExec(conn, `:foreach i in=[/ip/address/find where comment~"^gw-veth-3p-"] do={/ip/address/remove $i}`).catch(() => {});

  console.log('\n=== MIKROTIK: remove NAT (srcnat + dstnat proxy) ===');
  await sshExec(conn, `:foreach i in=[/ip/firewall/nat/find where comment~"^ctn-pppoe-out"] do={/ip/firewall/nat/remove $i}
:foreach i in=[/ip/firewall/nat/find where comment~"^ctn-pppoe-out"] do={/ip/firewall/nat/remove $i}`).catch(() => {});

  console.log('\n=== MIKROTIK: remove mangle ===');
  await sshExec(conn, `:foreach i in=[/ip/firewall/mangle/find where comment~"^ctn-mangle-pppoe-out"] do={/ip/firewall/mangle/remove $i}`).catch(() => {});

  console.log('\n=== MIKROTIK: remove routes + routing tables to_pppoe* ===');
  await sshExec(conn, `:foreach t in=[/routing/table/find where name~"^to_pppoe"] do={
  :local tn [/routing/table/get $t name]
  :foreach r in=[/ip/route/find where routing-table=$tn] do={/ip/route/remove $r}
  /routing/table/remove $t
}`).catch(() => {});

  console.log('\n=== MIKROTIK: remove mounts, envlist, users.json, 3proxy roots ===');
  await sshExec(conn, `:foreach i in=[/container/mounts/find where list~"^MOUNT_PROXY_"] do={/container/mounts/remove $i}
:foreach i in=[/container/envlist/find where name~"^ENV_3PROXY_"] do={/container/envlist/remove $i}
:foreach i in=[/file/find where name~"disk1/users-"] do={/file/remove $i}
:do {/disk/remove [find name~"3proxy-p"]} on-error={}`).catch(() => {});

  const left = await sshExec(conn, '/container/print where name~"proxy3p"');
  console.log('\nContainers proxy3p còn lại:\n', left.trim() || '(none)');
  const pppoe = await sshExec(conn, '/interface/pppoe-client/print where name~"pppoe-out"');
  console.log('\nPPPoE hiện tại:\n', pppoe);
}

async function purgeDb(token) {
  console.log('\n=== DB: purge fleet (proxies + wan state) ===');
  let purge = await httpJson('POST', '/api/system/purge-fleet', {}, token);
  if (purge.status === 200) {
    console.log('purge-fleet:', purge.data);
    return;
  }
  if (purge.status === 404) {
    console.log('purge-fleet chưa deploy — fallback xóa từng proxy...');
    const list = await httpJson('GET', '/api/proxies', null, token);
    if (list.status === 200 && Array.isArray(list.data)) {
      for (const p of list.data.filter(x => x.pppoeIdx >= 2)) {
        const r = await httpJson('DELETE', `/api/proxies/${p.id}`, null, token);
        console.log(`  delete pppoe-out${p.pppoeIdx}:`, r.status === 200 ? 'OK' : r.data);
      }
    }
    purge = await httpJson('POST', '/api/system/purge-wan-state', {}, token);
    if (purge.status === 200) console.log('purge-wan-state:', purge.data);
    return;
  }
  console.log('purge-fleet error:', purge.status, purge.data);
}

async function main() {
  console.log('============================================================');
  console.log('  CLEANUP FLEET — giữ pppoe-out1 + webuiproxymikrotik');
  console.log('============================================================');

  const conn = new Client();
  await new Promise((res, rej) => {
    conn.on('ready', res);
    conn.on('error', rej);
    conn.connect({ host: HOST, port: 22222, username: USER, password: PASS, readyTimeout: 30000 });
  });
  console.log('SSH connected');

  await cleanupMikrotik(conn);
  conn.end();

  console.log('\n=== WEBUI API ===');
  const login = await httpJson('POST', '/api/auth/login', { username: ADMIN_USER, password: ADMIN_PASS });
  if (login.status !== 200 || !login.data?.token) {
    throw new Error(`Login failed: ${login.status} ${JSON.stringify(login.data)}`);
  }
  await purgeDb(login.data.token);

  const fleet = await httpJson('GET', '/api/wan', null, login.data.token);
  const count = Array.isArray(fleet.data) ? fleet.data.length : 0;
  console.log('\n============================================================');
  console.log(`  CLEANUP DONE — Fleet hiện ${count} WAN (chỉ pppoe-out1)`);
  console.log('============================================================');
}

main().catch(e => { console.error('\nCLEANUP FAILED:', e.message); process.exit(1); });