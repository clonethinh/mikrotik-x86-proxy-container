/**
 * Force recreate webuiproxymikrotik container after image upload
 */
const { Client } = require('ssh2');
const http = require('http');

const HOST = '113.22.235.54';
const USER = 'admin';
const PASS = 'toanthinh';
const WAN_IP = '113.22.235.54';
const ADMIN_PASS = 'admin123';
const JWT_SECRET = 'webuiproxymikrotik-change-in-prod-32chars-x';
const ROOT_DIR = 'disk1/webuiproxymikrotik-root5';

function sshExec(conn, cmd, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    let out = '';
    const t = setTimeout(() => reject(new Error(`timeout: ${cmd.slice(0, 80)}`)), timeoutMs);
    conn.exec(cmd, (err, stream) => {
      if (err) { clearTimeout(t); return reject(err); }
      stream.on('close', () => { clearTimeout(t); resolve(out); });
      stream.on('data', d => { out += d; });
      stream.stderr.on('data', d => { out += d; });
    });
  });
}

async function enableAutoProxyFull(host, adminPass) {
  const base = `http://${host}:8088`;
  const loginBody = JSON.stringify({ username: 'admin', password: adminPass });
  const token = await new Promise((resolve, reject) => {
    const req = http.request(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(loginBody) },
      timeout: 20000,
    }, res => {
      let d = '';
      res.on('data', c => { d += c; });
      res.on('end', () => {
        try {
          const j = JSON.parse(d);
          if (j.token) resolve(j.token);
          else reject(new Error(`login: ${d.slice(0, 200)}`));
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(loginBody);
    req.end();
  });

  const patchBody = JSON.stringify({
    mode: 'full',
    pollIntervalMs: 20000,
    maxConcurrent: 16,
    staleTtlMs: 1800000,
    goneDebouncePolls: 3,
  });
  return new Promise((resolve, reject) => {
    const req = http.request(`${base}/api/settings/auto-proxy`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(patchBody),
        Authorization: `Bearer ${token}`,
      },
      timeout: 20000,
    }, res => {
      let d = '';
      res.on('data', c => { d += c; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(d);
        else reject(new Error(`patch ${res.statusCode}: ${d.slice(0, 200)}`));
      });
    });
    req.on('error', reject);
    req.write(patchBody);
    req.end();
  });
}

async function main() {
  const conn = new Client();
  await new Promise((res, rej) => {
    conn.on('ready', res);
    conn.on('error', rej);
    conn.connect({ host: HOST, port: 22, username: USER, password: PASS, readyTimeout: 30000 });
  });
  console.log('SSH OK');

  console.log('Stop + remove old container...');
  await sshExec(conn, `/container/stop [find name=webuiproxymikrotik]`).catch(() => {});
  await new Promise(r => setTimeout(r, 8000));
  await sshExec(conn, `/container/remove [find name=webuiproxymikrotik]`).catch(() => {});
  await new Promise(r => setTimeout(r, 3000));

  console.log('Remove old root dirs...');
  for (const n of ['webuiproxymikrotik-root', 'webuiproxymikrotik-root4', 'webuiproxymikrotik-root5']) {
    await sshExec(conn, `:do {/disk/remove [find name=${n}]} on-error={}`).catch(() => {});
  }
  await new Promise(r => setTimeout(r, 2000));

  await sshExec(conn, `:do {/container/mounts/remove [find list=MOUNT_DATA]} on-error={}
/container/mounts/add list=MOUNT_DATA src=disk1/data dst=/data`);

  console.log('Reset SQLite DB for fresh schema...');
  await sshExec(conn, `:do {/file/remove [find name=data/proxy.db]} on-error={}`).catch(() => {});

  const envs = [
    'NODE_ENV=production', 'PORT=8088', 'DEPLOY_TARGET=router',
    'MIKROTIK_HOST=172.17.0.1', `MIKROTIK_API_USER=${USER}`, `MIKROTIK_API_PASS=${PASS}`,
    'MIKROTIK_REST_PORT=80', 'MIKROTIK_REST_SCHEME=http',
    `MIKROTIK_SSH_PORT=22`, `MIKROTIK_SSH_USER=${USER}`, `MIKROTIK_SSH_PASS=${PASS}`,
    `MIKROTIK_WAN_IP=${WAN_IP}`, `MIKROTIK_WAN_HOST=ntpcproxy.duckdns.org`,
    `DUCKDNS_DOMAIN=ntpcproxy.duckdns.org`, `JWT_SECRET=${JWT_SECRET}`,
    'ADMIN_USERNAME=admin', `ADMIN_PASSWORD=${ADMIN_PASS}`,
    'DATABASE_URL=file:/data/proxy.db',
    'THREEPROXY_IMAGE=ghcr.io/tarampampam/3proxy:2', 'THREEPROXY_TARBALL=disk1/3proxy.tar',
    'HEALTH_CHECK_INTERVAL_MS=60000', 'HEALTH_CHECK_TIMEOUT_MS=10000',
    'ENABLE_REALTIME=true', 'LOG_LEVEL=info',
    'AUTO_PROXY_MODE=full', 'AUTO_PROXY_POLL_MS=20000', 'AUTO_PROXY_COUNTDOWN_MS=8000',
    'AUTO_PROXY_MAX_CONCURRENT=16', 'AUTO_PROXY_STALE_TTL_MS=1800000', 'AUTO_PROXY_GONE_DEBOUNCE=3',
  ].join(',');

  console.log(`Create container root=${ROOT_DIR}...`);
  const addOut = await sshExec(conn,
    `/container/add file=disk1/webuiproxymikrotik.tar interface=veth-webui root-dir=${ROOT_DIR} name=webuiproxymikrotik mountlists=MOUNT_DATA logging=yes start-on-boot=yes env="${envs}"`,
  );
  console.log(addOut.slice(0, 300) || 'add OK');

  console.log('Wait extract + boot (90s)...');
  for (let i = 0; i < 18; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const st = await sshExec(conn, '/container/print where name=webuiproxymikrotik');
    const running = st.includes('RUNNING') || st.includes(' H ');
    console.log(`  t+${(i + 1) * 5}s:`, running ? 'RUNNING' : st.split('\n')[2]?.trim() || '...');
    if (running) break;
    if (st.includes('FAILED')) throw new Error('extract FAILED');
  }

  await sshExec(conn, `/container/start [find name=webuiproxymikrotik]`).catch(() => {});
  await new Promise(r => setTimeout(r, 25000));

  const final = await sshExec(conn, '/container/print where name=webuiproxymikrotik');
  console.log('\nContainer:\n', final);

  conn.end();

  console.log('\nEnable auto-proxy via API...');
  for (let i = 0; i < 6; i++) {
    try {
      const r = await enableAutoProxyFull(WAN_IP, ADMIN_PASS);
      console.log('auto-proxy:', r.slice(0, 200));
      break;
    } catch (e) {
      console.log(`  retry ${i + 1}:`, e.message.slice(0, 120));
      await new Promise(r => setTimeout(r, 10000));
    }
  }

  console.log('\nDONE — http://ntpcproxy.duckdns.org:8088');
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });