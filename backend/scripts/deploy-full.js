/**
 * Full deploy: build image → upload → restart webui → upload DB → sync+auth
 */
const { spawn, execSync } = require('child_process');
const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const HOST = process.env.MIKROTIK_HOST || '113.22.235.54';
const USER = process.env.MIKROTIK_SSH_USER || 'admin';
const PASS = process.env.MIKROTIK_SSH_PASS || 'toanthinh';
const WAN_HOST = process.env.MIKROTIK_WAN_HOST || 'ntpcproxy.duckdns.org';
const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'admin123';
const JWT_SECRET = process.env.JWT_SECRET || 'webuiproxymikrotik-change-in-prod-32chars-x';
const TAR_LOCAL = path.join(ROOT, 'webuiproxymikrotik.docker.tar');
const TAR_OCI = path.join(ROOT, 'webuiproxymikrotik.tar');

function run(cmd, opts = {}) {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { stdio: 'inherit', cwd: opts.cwd || ROOT, ...opts });
}

function sshExec(conn, cmd, timeoutMs = 90000) {
  return new Promise((resolve, reject) => {
    let out = '';
    const t = setTimeout(() => reject(new Error(`timeout: ${cmd.slice(0, 60)}`)), timeoutMs);
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
      let n = 0;
      rs.on('data', c => { n += c.length; });
      ws.on('close', () => { console.log(`  Uploaded ${remote} (${(n / 1024 / 1024).toFixed(1)} MiB)`); resolve(); });
      ws.on('error', reject);
      rs.pipe(ws);
    });
  });
}

async function deployContainer(conn) {
  console.log('\n=== DEPLOY webuiproxymikrotik container ===');

  await sshExec(conn, `/container/stop [find name=webuiproxymikrotik]`).catch(() => {});
  await new Promise(r => setTimeout(r, 8000));
  await sshExec(conn, `/container/remove [find name=webuiproxymikrotik]`).catch(() => {});
  await new Promise(r => setTimeout(r, 3000));
  for (const n of ['webuiproxymikrotik-root', 'webuiproxymikrotik-root4', 'webuiproxymikrotik-root5']) {
    await sshExec(conn, `:do {/disk/remove [find name=${n}]} on-error={}`).catch(() => {});
  }
  await new Promise(r => setTimeout(r, 2000));

  await sshExec(conn, `:do {/container/mounts/remove [find list=MOUNT_DATA]} on-error={}
:do {/container/mounts/remove [find list=MOUNT_WEBUI_DATA]} on-error={}
/container/mounts/add list=MOUNT_WEBUI_DATA src=disk1/webui-data dst=/data`);

  const envs = [
    'NODE_ENV=production', 'PORT=8088', 'DEPLOY_TARGET=router',
    'MIKROTIK_HOST=172.17.0.1', `MIKROTIK_API_USER=${USER}`, `MIKROTIK_API_PASS=${PASS}`,
    'MIKROTIK_REST_PORT=80', 'MIKROTIK_REST_SCHEME=http',
    `MIKROTIK_SSH_PORT=22`, `MIKROTIK_SSH_USER=${USER}`, `MIKROTIK_SSH_PASS=${PASS}`,
    `JWT_SECRET=${JWT_SECRET}`,
    'ADMIN_USERNAME=admin', `ADMIN_PASSWORD=${ADMIN_PASS}`,
    'DATABASE_URL=file:/data/proxy.db',
    'THREEPROXY_IMAGE=ghcr.io/tarampampam/3proxy:2', 'THREEPROXY_TARBALL=disk1/3proxy.tar',
    'THREEPROXY_HUB_IMAGE=webuiproxymikrotik/3proxy-hub:2', 'THREEPROXY_HUB_TARBALL=disk1/3proxy-hub.tar',
    'PROXY_DEPLOY_MODE=hub',
    'HEALTH_CHECK_INTERVAL_MS=60000', 'HEALTH_CHECK_TIMEOUT_MS=10000',
    'ENABLE_REALTIME=true', 'LOG_LEVEL=info',
    'AUTO_PROXY_MODE=full', 'AUTO_PROXY_POLL_MS=20000', 'AUTO_PROXY_COUNTDOWN_MS=8000',
    'AUTO_PROXY_MAX_CONCURRENT=16', 'AUTO_PROXY_STALE_TTL_MS=1800000', 'AUTO_PROXY_GONE_DEBOUNCE=3',
    'MIKROTIK_WAN_HOST=ntpcproxy.duckdns.org', 'DUCKDNS_DOMAIN=ntpcproxy.duckdns.org',
  ].join(',');

  const addCmd = `/container/add file=disk1/webuiproxymikrotik.tar interface=veth-webui root-dir=disk1/webuiproxymikrotik-root5 name=webuiproxymikrotik mountlists=MOUNT_WEBUI_DATA logging=yes start-on-boot=yes env="${envs}"`;
  const out = await sshExec(conn, addCmd);
  console.log('Container add:', out.slice(0, 200) || 'OK');

  console.log('Waiting 50s for image extract...');
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const st = await sshExec(conn, '/container/print where name=webuiproxymikrotik');
    console.log(`  t+${(i + 1) * 5}s:`, st.includes('RUNNING') || st.includes('HEALTHY') ? 'RUNNING' : st.slice(0, 80));
    if (st.includes('RUNNING') || st.includes('HEALTHY') || st.includes(' H ')) break;
    if (st.includes('FAILED')) throw new Error('Image extract FAILED');
  }

  await sshExec(conn, `/container/start [find name=webuiproxymikrotik]`).catch(() => {});
  console.log('Waiting 20s for backend boot...');
  await new Promise(r => setTimeout(r, 20000));

  const final = await sshExec(conn, '/container/print where name=webuiproxymikrotik');
  console.log('\nFinal status:\n', final);
}

async function main() {
  console.log('============================================================');
  console.log('  FULL DEPLOY webuiproxymikrotik ->', HOST);
  console.log('============================================================');

  // 1. Build frontend
  console.log('\n=== STEP 1: Build frontend ===');
  run('npm run build', { cwd: path.join(ROOT, 'frontend') });

  // 2. Docker build
  console.log('\n=== STEP 2: Docker build (linux/amd64) ===');
  run('docker buildx build --platform linux/amd64 -t webuiproxymikrotik:latest --load .');

  // 3. Save + convert for RouterOS
  console.log('\n=== STEP 3: Save image ===');
  run(`docker save webuiproxymikrotik:latest -o "${TAR_OCI}"`);
  run(`python "${path.join(ROOT, 'scripts/_oci_to_docker.py')}" "${ROOT.replace(/\\/g, '/')}"`);

  if (!fs.existsSync(TAR_LOCAL)) {
    // fallback: use oci tar directly
    fs.copyFileSync(TAR_OCI, TAR_LOCAL);
  }

  // 4. Sync DB + auth BEFORE upload DB (updates local data/proxy.db)
  console.log('\n=== STEP 4: Sync DB + fix proxy auth on router ===');
  run('node scripts/sync-containers.js', { cwd: path.join(ROOT, 'backend') });

  // 5. SSH upload + deploy
  const conn = new Client();
  await new Promise((res, rej) => {
    conn.on('ready', res);
    conn.on('error', rej);
    conn.connect({ host: HOST, port: 22, username: USER, password: PASS, readyTimeout: 30000 });
  });
  console.log('\nSSH connected');

  console.log('\n=== STEP 5: Upload image tar ===');
  await sshExec(conn, `:do {/file/remove [find name~"webuiproxymikrotik.tar"]} on-error={}`).catch(() => {});
  await sftpPut(conn, TAR_LOCAL, '/disk1/webuiproxymikrotik.tar');

  const dbLocal = path.join(ROOT, 'data/proxy.db');
  if (fs.existsSync(dbLocal)) {
    console.log('\n=== STEP 6: Upload SQLite DB ===');
    await sshExec(conn, `:do {/disk remove [find name=data/proxy.db]} on-error={}`).catch(() => {});
    // Ensure disk1/data exists - mount handles it
    try {
      await sftpPut(conn, dbLocal, '/disk1/data/proxy.db');
    } catch (e) {
      console.warn('DB upload warning:', e.message, '(container may use existing DB on mount)');
    }
  }

  await deployContainer(conn);
  conn.end();

  console.log('\n=== STEP 7: Enable auto-proxy mode=full via API ===');
  await enableAutoProxyFull(WAN_HOST, ADMIN_PASS);

  console.log('\n============================================================');
  console.log('  DEPLOY COMPLETE');
  console.log(`  WebUI: http://${WAN_HOST}:8088`);
  console.log(`  Login: admin / ${ADMIN_PASS}`);
  console.log('  Auto-proxy: FULL (pppoe-outX mới → tự tạo proxy)');
  console.log('============================================================');
}

async function enableAutoProxyFull(host, adminPass) {
  const http = require('http');
  const base = `http://${host}:8088`;
  const loginBody = JSON.stringify({ username: 'admin', password: adminPass });
  const token = await new Promise((resolve, reject) => {
    const req = http.request(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(loginBody) },
      timeout: 15000,
    }, res => {
      let d = '';
      res.on('data', c => { d += c; });
      res.on('end', () => {
        try {
          const j = JSON.parse(d);
          if (j.token) resolve(j.token);
          else reject(new Error(`login failed: ${d.slice(0, 120)}`));
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
  await new Promise((resolve, reject) => {
    const req = http.request(`${base}/api/settings/auto-proxy`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(patchBody),
        Authorization: `Bearer ${token}`,
      },
      timeout: 15000,
    }, res => {
      let d = '';
      res.on('data', c => { d += c; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log('  auto-proxy settings:', d.slice(0, 200));
          resolve();
        } else {
          reject(new Error(`PATCH auto-proxy ${res.statusCode}: ${d.slice(0, 120)}`));
        }
      });
    });
    req.on('error', reject);
    req.write(patchBody);
    req.end();
  });
}

main().catch(e => { console.error('\nDEPLOY FAILED:', e.message); process.exit(1); });