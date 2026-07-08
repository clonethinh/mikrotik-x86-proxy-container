/**
 * Deploy hub mode + dọn legacy (proxy3p-N, veth-3p-N, ctn-* rules)
 * Giữ: webuiproxymikrotik, proxy3p-hub, pppoe-wan, pppoe-out*
 */
const { execSync } = require('child_process');
const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.resolve(__dirname, '../..');
const BACKEND = path.join(ROOT, 'backend');
const CTN_ROOT = 'disk1/webuiproxymikrotik-root4';
const HOST = process.env.MIKROTIK_HOST || 'ntpcproxy.duckdns.org';
const USER = process.env.MIKROTIK_SSH_USER || 'admin';
const PASS = process.env.MIKROTIK_SSH_PASS || 'toanthinh';
const WEBUI = process.env.WEBUI_URL || `http://${HOST}:8088`;

const DIST_FILES = [
  'dist/lib/hubUtils.js',
  'dist/lib/config.js',
  'dist/lib/pppoeUtils.js',
  'dist/lib/networkUtils.js',
  'dist/services/proxy/ProxyService.js',
  'dist/services/proxy/HubProxyService.js',
  'dist/services/proxy/HubRateLimitService.js',
  'dist/services/mikrotik/SshBlacklistService.js',
  'dist/services/proxy/HubConfigService.js',
  'dist/services/proxy/PoolAllocator.js',
  'dist/routes/system.js',
  'prisma/schema.prisma',
];

const ENV = [
  'NODE_ENV=production', 'PORT=8088', 'DEPLOY_TARGET=router',
  'MIKROTIK_HOST=172.17.0.1', `MIKROTIK_API_USER=${USER}`, `MIKROTIK_API_PASS=${PASS}`,
  'MIKROTIK_REST_PORT=80', 'MIKROTIK_REST_SCHEME=http',
  `MIKROTIK_SSH_USER=${USER}`, `MIKROTIK_SSH_PASS=${PASS}`, 'MIKROTIK_SSH_PORT=22222',
  'MIKROTIK_WAN_HOST=ntpcproxy.duckdns.org',
  'JWT_SECRET=webuiproxymikrotik-change-in-prod-32chars-x',
  'ADMIN_USERNAME=admin', 'ADMIN_PASSWORD=admin123',
  'DATABASE_URL=file:/data/proxy.db', 'ENABLE_REALTIME=true', 'LOG_LEVEL=info',
  'THREEPROXY_IMAGE=ghcr.io/tarampampam/3proxy:2', 'THREEPROXY_TARBALL=disk1/3proxy.tar',
  'THREEPROXY_HUB_IMAGE=webuiproxymikrotik/3proxy-hub:2', 'THREEPROXY_HUB_TARBALL=disk1/3proxy-hub.tar',
  'HEALTH_CHECK_INTERVAL_MS=60000', 'HEALTH_CHECK_TIMEOUT_MS=10000',
  'AUTO_PROXY_MODE=semi', 'AUTO_PROXY_POLL_MS=20000', 'AUTO_PROXY_COUNTDOWN_MS=8000',
  'AUTO_PROXY_MAX_CONCURRENT=16', 'AUTO_PROXY_STALE_TTL_MS=1800000',
  'PROXY_DEPLOY_MODE=hub',
].join(',');

function run(cmd, cwd = ROOT) {
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: 'inherit', cwd });
}

function sshExec(conn, cmd, t = 300000) {
  return new Promise((res, rej) => {
    let o = '';
    const timer = setTimeout(() => rej(new Error(`timeout: ${cmd.slice(0, 80)}`)), t);
    conn.exec(cmd, (e, s) => {
      if (e) { clearTimeout(timer); return rej(e); }
      s.on('close', () => { clearTimeout(timer); res(o); });
      s.on('data', d => { o += d; process.stdout.write(d); });
      s.stderr.on('data', d => { o += d; process.stderr.write(d); });
    });
  });
}

function sftpPut(conn, local, remote) {
  return new Promise((res, rej) => {
    conn.sftp((e, sftp) => {
      if (e) return rej(e);
      const ws = sftp.createWriteStream(remote);
      ws.on('close', () => { console.log('  patched', remote); res(); });
      ws.on('error', rej);
      ws.end(fs.readFileSync(local));
    });
  });
}

function httpJson(method, urlPath, body, token) {
  return new Promise((res, rej) => {
    const u = new URL(urlPath, WEBUI);
    const payload = body ? JSON.stringify(body) : null;
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (payload) headers['Content-Type'] = 'application/json';
    const req = http.request({
      hostname: u.hostname, port: u.port || 80, path: u.pathname + u.search, method, headers, timeout: 120000,
    }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        try { res({ status: r.statusCode, data: JSON.parse(d) }); } catch { res({ status: r.statusCode, data: d }); }
      });
    });
    req.on('error', rej);
    if (payload) req.write(payload);
    req.end();
  });
}

async function cleanupLegacy(conn) {
  console.log('\n=== CLEANUP legacy proxy3p-N (giữ proxy3p-hub) ===');
  await sshExec(conn, '/container/stop [find where name~"^proxy3p-[0-9]"]').catch(() => {});
  await new Promise(r => setTimeout(r, 5000));
  await sshExec(conn, '/container/remove [find where name~"^proxy3p-[0-9]"]').catch(() => {});

  await sshExec(conn, `:foreach i in=[/interface/veth/find where name~"^veth-3p-[0-9]"] do={
  :local n [/interface/veth/get $i name]
  :do {/interface/bridge/port/remove [find interface=$n]} on-error={}
  /interface/veth/remove $i
}`).catch(() => {});

  await sshExec(conn, `:foreach i in=[/ip/address/find where comment~"^gw-veth-3p-[0-9]"] do={/ip/address/remove $i}`).catch(() => {});

  await sshExec(conn, `:foreach i in=[/ip/firewall/nat/find where comment~"^ctn-pppoe-out"] do={/ip/firewall/nat/remove $i}
:foreach i in=[/ip/firewall/mangle/find where comment~"^ctn-mangle-pppoe-out"] do={/ip/firewall/mangle/remove $i}
:foreach i in=[/ip/firewall/filter/find where comment~"^webuiproxymikrotik-"] do={/ip/firewall/filter/remove $i}`).catch(() => {});

  await sshExec(conn, `:foreach t in=[/routing/table/find where name~"^to_pppoe"] do={
  :local tn [/routing/table/get $t name]
  :foreach r in=[/ip/route/find where routing-table=$tn] do={/ip/route/remove $r}
  /routing/table/remove $t
}`).catch(() => {});

  await sshExec(conn, `:foreach i in=[/container/mounts/find where list~"^MOUNT_PROXY_"] do={/container/mounts/remove $i}
:foreach i in=[/file/find where name~"disk1/users-"] do={/file/remove $i}
:do {/disk/remove [find name~"3proxy-p"]} on-error={}`).catch(() => {});

  for (const rsc of ['cleanup-firewall-orphan.rsc', 'ensure-proxy-gateway.rsc']) {
    const local = path.join(ROOT, 'mikrotik', rsc);
    if (fs.existsSync(local)) {
      await sftpPut(conn, local, `disk1/webuiproxymikrotik/${rsc}`);
    }
  }
  await sshExec(conn, '/import file=disk1/webuiproxymikrotik/cleanup-firewall-orphan.rsc').catch(() => {});
  await sshExec(conn, '/import file=disk1/webuiproxymikrotik/ensure-proxy-gateway.rsc').catch(() => {});

  console.log(await sshExec(conn, '/container/print where name~"proxy3p"'));
  console.log(await sshExec(conn, '/interface/veth/print'));
}

async function patchDist(conn) {
  console.log('\n=== PATCH dist + prisma vào container ===');
  const feDir = path.join(ROOT, 'frontend/dist/assets');
  const feJs = fs.readdirSync(feDir).find(f => f.startsWith('index-') && f.endsWith('.js'));
  for (const rel of DIST_FILES) {
    const local = path.join(BACKEND, rel);
    if (!fs.existsSync(local)) { console.warn('skip', rel); continue; }
    await sftpPut(conn, local, `${CTN_ROOT}/app/${rel}`);
  }
  const prismaClient = path.join(BACKEND, 'node_modules/.prisma/client');
  for (const f of fs.readdirSync(prismaClient)) {
    const st = fs.statSync(path.join(prismaClient, f));
    if (!st.isFile()) continue;
    await sftpPut(conn, path.join(prismaClient, f), `${CTN_ROOT}/app/node_modules/.prisma/client/${f}`);
  }
  if (feJs) {
    await sftpPut(conn, path.join(feDir, feJs), `${CTN_ROOT}/app/public/assets/${feJs}`);
    const idxHtml = fs.readFileSync(path.join(ROOT, 'frontend/dist/index.html'), 'utf8');
    await sftpPut(conn, path.join(ROOT, 'frontend/dist/index.html'), `${CTN_ROOT}/app/public/index.html`);
    void idxHtml;
  }
}

async function migrateDb(conn) {
  console.log('\n=== DB migrate egressPppoeName ===');
  await sshExec(conn, '/container/stop [find name=webuiproxymikrotik]').catch(() => {});
  await new Promise(r => setTimeout(r, 4000));

  const localDb = path.join(BACKEND, 'proxy-migrate.db');
  await new Promise((res, rej) => {
    conn.sftp((e, sftp) => {
      if (e) return rej(e);
      const rs = sftp.createReadStream('disk1/data/proxy.db');
      const ws = fs.createWriteStream(localDb);
      rs.on('close', res);
      rs.on('error', rej);
      ws.on('error', rej);
      rs.pipe(ws);
    });
  });

  try {
    execSync(`sqlite3 "${localDb}" "ALTER TABLE ProxyUser ADD COLUMN egressPppoeName TEXT;"`, { stdio: 'pipe' });
  } catch { /* column exists */ }

  await new Promise((res, rej) => {
    conn.sftp((e, sftp) => {
      if (e) return rej(e);
      sftp.unlink('disk1/data/proxy.db', () => {
        const ws = sftp.createWriteStream('disk1/data/proxy.db');
        ws.on('close', res);
        ws.on('error', rej);
        ws.end(fs.readFileSync(localDb));
      });
    });
  });
  console.log('  DB OK');
}

async function restartWebui(conn) {
  console.log('\n=== RESTART webuiproxymikrotik ===');
  await sshExec(conn, `/container/set [find name=webuiproxymikrotik] env="${ENV}" mountlists=MOUNT_DATA start-on-boot=yes`);
  await sshExec(conn, ':do {/container/mounts/remove [find list=MOUNT_DATA]} on-error={}');
  await sshExec(conn, '/container/mounts/add list=MOUNT_DATA src=disk1/data dst=/data');
  await sshExec(conn, '/container/start [find name=webuiproxymikrotik]');
  await new Promise(r => setTimeout(r, 25000));
}

async function reapplyHub(token) {
  console.log('\n=== REAPPLY hub proxies ===');
  const list = await httpJson('GET', '/api/proxies', null, token);
  if (!Array.isArray(list.data)) throw new Error('Cannot list proxies');
  for (const p of list.data) {
    console.log(`  reapply slot ${p.pppoeIdx} (id=${p.id})...`);
    const r = await httpJson('POST', `/api/proxies/${p.id}/reapply`, {}, token);
    console.log(`    → ${r.status}`, r.data?.status || r.data?.statusMessage || r.data?.error || '');
    await new Promise(x => setTimeout(x, 5000));
  }
}

async function main() {
  console.log('============================================================');
  console.log('  DEPLOY HUB + CLEANUP LEGACY');
  console.log('============================================================');

  run('npm run build', BACKEND);
  run('npm run build', path.join(ROOT, 'frontend'));

  const conn = new Client();
  await new Promise((r, j) => { conn.on('ready', r); conn.on('error', j); conn.connect({ host: HOST, port: 22222, username: USER, password: PASS }); });
  console.log('SSH OK');

  await cleanupLegacy(conn);
  await patchDist(conn);
  await migrateDb(conn);
  await restartWebui(conn);

  await sshExec(conn, '/container/set [find name=proxy3p-hub] env=PROXY_PORT=20001,SOCKS_PORT=21001 stop-on-unhealthy=no').catch(() => {});
  await sshExec(conn, '/container/start [find name=proxy3p-hub]').catch(() => {});

  conn.end();

  let token = null;
  for (let i = 0; i < 12; i++) {
    const login = await httpJson('POST', '/api/auth/login', { username: 'admin', password: 'admin123' });
    if (login.status === 200 && login.data?.token) { token = login.data.token; break; }
    await new Promise(r => setTimeout(r, 5000));
  }
  if (!token) throw new Error('WebUI login failed');

  await reapplyHub(token);

  const info = await httpJson('GET', '/api/deploy-info', null, token);
  const proxies = await httpJson('GET', '/api/proxies', null, token);
  console.log('\n============================================================');
  console.log('  DEPLOY DONE');
  console.log('  mode:', info.data?.proxy?.deployMode);
  console.log('  proxies:', proxies.data?.map(p => `out${p.pppoeIdx}=${p.status} ${p.publicIp}`).join(', '));
  console.log('============================================================');
}

main().catch(e => { console.error('\nFAILED:', e.message); process.exit(1); });