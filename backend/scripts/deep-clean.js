/**
 * Dọn sạch hoàn toàn: MikroTik fleet + reset DB writable + verify 0 proxies
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
      stream.stderr.on('data', d => { out += d; });
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

async function cleanupMikrotik(conn) {
  console.log('\n=== MIKROTIK: proxy fleet ===');
  await sshExec(conn, '/container/stop [find where name~"^proxy3p-"]').catch(() => {});
  await sleep(8000);
  await sshExec(conn, '/container/remove [find where name~"^proxy3p-"]').catch(() => {});
  await sleep(3000);

  for (let i = 1; i <= 99; i++) {
    const n = `veth-3p-${i}`;
    await sshExec(conn, `:do {/interface/bridge/port/remove [find interface=${n}]} on-error={}`).catch(() => {});
    await sshExec(conn, `:do {/interface/veth/remove [find name=${n}]} on-error={}`).catch(() => {});
    await sshExec(conn, `:do {/ip/address/remove [find comment=gw-veth-3p-${i}]} on-error={}`).catch(() => {});
    const t = `to_pppoe${i}`;
    await sshExec(conn, `:do {/ip/route/remove [find routing-table=${t}]} on-error={}`).catch(() => {});
    await sshExec(conn, `:do {/routing/table/remove [find name=${t}]} on-error={}`).catch(() => {});
  }

  await sshExec(conn, `:do {/ip/firewall/nat/remove [find comment~"ctn-pppoe-out"]} on-error={}`).catch(() => {});
  await sshExec(conn, `:do {/ip/firewall/mangle/remove [find comment~"ctn-mangle-pppoe-out"]} on-error={}`).catch(() => {});
  await sshExec(conn, `:do {/container/mounts/remove [find list~"^MOUNT_PROXY_"]} on-error={}`).catch(() => {});
  await sshExec(conn, `:do {/container/envlist/remove [find name~"^ENV_3PROXY_"]} on-error={}`).catch(() => {});
  await sshExec(conn, `:do {/file/remove [find name~"disk1/users-"]} on-error={}`).catch(() => {});
  await sshExec(conn, `:do {/disk/remove [find name~"3proxy-p"]} on-error={}`).catch(() => {});
  await sshExec(conn, ':do {/interface/bridge/port/remove [find comment~"bp-veth-3p"]} on-error={}').catch(() => {});
}

async function resetDb(conn) {
  console.log('\n=== DB: remove readonly proxy.db + restart WebUI ===');
  await sshExec(conn, ':do {/file/remove [find name=disk1/data/proxy.db]} on-error={}').catch(() => {});
  await sshExec(conn, ':do {/file/remove [find name=disk1/data/proxy.db-journal]} on-error={}').catch(() => {});
  await sshExec(conn, ':do {/file/remove [find name=disk1/data/proxy.db-wal]} on-error={}').catch(() => {});
  await sshExec(conn, ':do {/file/remove [find name=disk1/data/proxy.db-shm]} on-error={}').catch(() => {});

  await sshExec(conn, '/container/stop [find name=webuiproxymikrotik]').catch(() => {});
  await sleep(10000);
  await sshExec(conn, '/container/start [find name=webuiproxymikrotik]').catch(() => {});
  console.log('Waiting 40s for fresh DB bootstrap...');
  await sleep(40000);
}

async function waitHealth() {
  for (let i = 0; i < 15; i++) {
    try {
      const h = await httpJson('GET', '/api/health');
      if (h.status === 200 && h.data?.ok) return true;
    } catch {}
    await sleep(3000);
  }
  return false;
}

async function verify() {
  const login = await httpJson('POST', '/api/auth/login', { username: ADMIN_USER, password: ADMIN_PASS });
  if (login.status !== 200) throw new Error(`Login failed: ${login.status} ${JSON.stringify(login.data)}`);

  const token = login.data.token;
  const [proxies, wan, disc] = await Promise.all([
    httpJson('GET', '/api/proxies', null, token),
    httpJson('GET', '/api/wan', null, token),
    httpJson('GET', '/api/wan/discovery', null, token),
  ]);

  console.log('\n=== VERIFY ===');
  console.log('ProxyUser:', Array.isArray(proxies.data) ? proxies.data.length : proxies.data);
  console.log('Wan:', Array.isArray(wan.data) ? wan.data.length : wan.data);
  console.log('WanDiscovery:', Array.isArray(disc.data) ? disc.data.length : disc.data);

  if (Array.isArray(proxies.data) && proxies.data.length > 0) {
    proxies.data.forEach(p => console.log(`  STALE: id=${p.id} ${p.pppoeName} status=${p.status}`));
    throw new Error(`Still ${proxies.data.length} proxies in DB`);
  }
  return { proxies: 0, wan: wan.data?.length, discovery: disc.data?.length };
}

async function main() {
  console.log('============================================================');
  console.log('  DEEP CLEAN — MikroTik + fresh writable DB');
  console.log('============================================================');

  const conn = new Client();
  await new Promise((res, rej) => {
    conn.on('ready', res);
    conn.on('error', rej);
    conn.connect({ host: HOST, port: 22222, username: USER, password: PASS, readyTimeout: 30000 });
  });
  console.log('SSH OK');

  await cleanupMikrotik(conn);
  await resetDb(conn);

  const left = await sshExec(conn, '/container/print where name~"proxy3p"');
  console.log('\nproxy3p after clean:', left.trim() || '(none)');
  conn.end();

  const ok = await waitHealth();
  if (!ok) throw new Error('WebUI health check failed after restart');

  const result = await verify();
  console.log('\n============================================================');
  console.log('  DEEP CLEAN DONE — /proxies = 0');
  console.log(`  Wan live: ${result.wan} | Discovery: ${result.discovery}`);
  console.log('============================================================');
}

main().catch(e => { console.error('\nDEEP CLEAN FAILED:', e.message); process.exit(1); });