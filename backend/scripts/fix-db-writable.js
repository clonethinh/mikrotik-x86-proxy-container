/**
 * Recreate container with writable DB mount (disk1/webui-data)
 */
const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');
const http = require('http');

const HOST = '113.22.235.54';
const USER = 'admin';
const PASS = 'toanthinh';
const DB_LOCAL = path.resolve(__dirname, '../data/proxy-fresh.db');
const ROOT_DIR = 'disk1/webuiproxymikrotik-root6';

function sshExec(conn, cmd, ms = 90000) {
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

function sftpPut(conn, local, remote) {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) return reject(err);
      const rs = fs.createReadStream(local);
      const ws = sftp.createWriteStream(remote);
      ws.on('close', resolve);
      ws.on('error', reject);
      rs.pipe(ws);
    });
  });
}

async function enableAutoProxy() {
  const base = 'http://113.22.235.54:8088';
  const login = JSON.stringify({ username: 'admin', password: 'admin123' });
  const token = await new Promise((res, rej) => {
    const req = http.request(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(login) },
    }, r => {
      let d = '';
      r.on('data', c => { d += c; });
      r.on('end', () => {
        try { res(JSON.parse(d).token); } catch { rej(new Error(d.slice(0, 150))); }
      });
    });
    req.on('error', rej);
    req.write(login);
    req.end();
  });
  const patch = JSON.stringify({ mode: 'full', pollIntervalMs: 20000, maxConcurrent: 16, staleTtlMs: 1800000, goneDebouncePolls: 3 });
  await new Promise((res, rej) => {
    const req = http.request(`${base}/api/settings/auto-proxy`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'Content-Length': Buffer.byteLength(patch) },
    }, r => {
      let d = '';
      r.on('data', c => { d += c; });
      r.on('end', () => r.statusCode < 300 ? res(d) : rej(new Error(d.slice(0, 150))));
    });
    req.on('error', rej);
    req.write(patch);
    req.end();
  });
}

async function main() {
  const conn = new Client();
  await new Promise((res, rej) => { conn.on('ready', res); conn.on('error', rej); conn.connect({ host: HOST, username: USER, password: PASS }); });

  await sshExec(conn, `/container/stop [find name=webuiproxymikrotik]`).catch(() => {});
  await new Promise(r => setTimeout(r, 8000));
  await sshExec(conn, `/container/remove [find name=webuiproxymikrotik]`).catch(() => {});
  await new Promise(r => setTimeout(r, 3000));
  for (const n of ['webuiproxymikrotik-root5', 'webuiproxymikrotik-root6']) {
    await sshExec(conn, `:do {/disk/remove [find name=${n}]} on-error={}`).catch(() => {});
  }

  await sshExec(conn, `:do {/container/mounts/remove [find list=MOUNT_DATA]} on-error={}
:do {/container/mounts/remove [find list=MOUNT_WEBUI_DATA]} on-error={}
/container/mounts/add list=MOUNT_WEBUI_DATA src=disk1/webui-data dst=/data`);

  await sshExec(conn, `:do {/file/remove [find name=webui-data/proxy.db]} on-error={}`).catch(() => {});
  await sftpPut(conn, DB_LOCAL, '/disk1/webui-data/proxy.db');

  const envs = [
    'NODE_ENV=production', 'PORT=8088', 'DEPLOY_TARGET=router',
    'MIKROTIK_HOST=172.17.0.1', `MIKROTIK_API_USER=${USER}`, `MIKROTIK_API_PASS=${PASS}`,
    'MIKROTIK_REST_PORT=80', 'MIKROTIK_REST_SCHEME=http',
    `MIKROTIK_SSH_PORT=22`, `MIKROTIK_SSH_USER=${USER}`, `MIKROTIK_SSH_PASS=${PASS}`,
    'MIKROTIK_WAN_IP=113.22.235.54', 'MIKROTIK_WAN_HOST=ntpcproxy.duckdns.org',
    'DUCKDNS_DOMAIN=ntpcproxy.duckdns.org',
    'JWT_SECRET=webuiproxymikrotik-change-in-prod-32chars-x',
    'ADMIN_USERNAME=admin', 'ADMIN_PASSWORD=admin123',
    'DATABASE_URL=file:/data/proxy.db',
    'THREEPROXY_IMAGE=ghcr.io/tarampampam/3proxy:2', 'THREEPROXY_TARBALL=disk1/3proxy.tar',
    'HEALTH_CHECK_INTERVAL_MS=60000', 'HEALTH_CHECK_TIMEOUT_MS=10000',
    'ENABLE_REALTIME=true', 'LOG_LEVEL=info',
    'AUTO_PROXY_MODE=full', 'AUTO_PROXY_POLL_MS=20000',
    'AUTO_PROXY_MAX_CONCURRENT=16', 'AUTO_PROXY_STALE_TTL_MS=1800000', 'AUTO_PROXY_GONE_DEBOUNCE=3',
  ].join(',');

  await sshExec(conn,
    `/container/add file=disk1/webuiproxymikrotik.tar interface=veth-webui root-dir=${ROOT_DIR} name=webuiproxymikrotik mountlists=MOUNT_WEBUI_DATA logging=yes start-on-boot=yes env="${envs}"`,
  );

  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const st = await sshExec(conn, '/container/print where name=webuiproxymikrotik');
    if (st.includes('RUNNING')) break;
    if (st.includes('FAILED')) throw new Error('extract failed');
  }
  await sshExec(conn, `/container/start [find name=webuiproxymikrotik]`).catch(() => {});
  await new Promise(r => setTimeout(r, 25000));
  console.log(await sshExec(conn, '/container/print where name=webuiproxymikrotik'));
  conn.end();

  for (let i = 0; i < 10; i++) {
    try {
      await enableAutoProxy();
      console.log('auto-proxy FULL enabled');
      return;
    } catch (e) {
      console.log(`retry ${i + 1}:`, e.message);
      await new Promise(r => setTimeout(r, 8000));
    }
  }
  throw new Error('API still failing');
}

main().catch(e => { console.error('FAIL:', e.message); process.exit(1); });