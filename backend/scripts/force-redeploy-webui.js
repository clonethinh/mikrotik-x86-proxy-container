const { Client } = require('ssh2');
const HOST = process.env.MIKROTIK_HOST || 'ntpcproxy.duckdns.org';
const USER = process.env.MIKROTIK_SSH_USER || 'admin';
const PASS = process.env.MIKROTIK_SSH_PASS || 'toanthinh';
const ROOT = 'disk1/webuiproxymikrotik-root4';

function exec(conn, cmd, t = 180000) {
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

async function main() {
  const c = new Client();
  await new Promise((r, j) => { c.on('ready', r); c.on('error', j); c.connect({ host: HOST, port: 22222, username: USER, password: PASS, readyTimeout: 30000 }); });
  console.log('SSH OK\n');

  let st = await exec(c, '/container/print detail where name=webuiproxymikrotik');
  console.log('\n--- BEFORE ---\n', st);

  // Stop by name (retry)
  for (let i = 0; i < 3; i++) {
    await exec(c, '/container/stop [find name=webuiproxymikrotik]').catch(() => {});
    await new Promise(r => setTimeout(r, 8000));
    st = await exec(c, '/container/print where name=webuiproxymikrotik');
    if (!st.includes(' R ') && !st.includes('RUNNING')) break;
    console.log(`stop attempt ${i + 1}, still running...`);
  }

  // Remove by name (retry)
  for (let i = 0; i < 3; i++) {
    await exec(c, '/container/remove [find name=webuiproxymikrotik]').catch(() => {});
    await new Promise(r => setTimeout(r, 5000));
    st = await exec(c, '/container/print where name=webuiproxymikrotik');
    if (!st.includes('webuiproxymikrotik')) break;
    console.log(`remove attempt ${i + 1}, still exists...`);
  }

  await exec(c, `:do {/disk/remove [find name~"webuiproxymikrotik-root"]} on-error={}`).catch(() => {});
  await new Promise(r => setTimeout(r, 3000));

  st = await exec(c, '/container/print where name=webuiproxymikrotik');
  if (st.includes('webuiproxymikrotik')) {
    throw new Error('Container still exists after remove retries:\n' + st);
  }
  console.log('\nContainer removed OK\n');

  const env = [
    'NODE_ENV=production', 'PORT=8088', 'DEPLOY_TARGET=router',
    'MIKROTIK_HOST=172.17.0.1', `MIKROTIK_API_USER=${USER}`, `MIKROTIK_API_PASS=${PASS}`,
    'MIKROTIK_REST_PORT=80', 'MIKROTIK_REST_SCHEME=http',
    `MIKROTIK_SSH_USER=${USER}`, `MIKROTIK_SSH_PASS=${PASS}`, 'MIKROTIK_SSH_PORT=22222',
    'MIKROTIK_WAN_HOST=ntpcproxy.duckdns.org',
    'JWT_SECRET=webuiproxymikrotik-change-in-prod-32chars-x',
    'ADMIN_USERNAME=admin', 'ADMIN_PASSWORD=admin123',
    'DATABASE_URL=file:/data/proxy.db', 'ENABLE_REALTIME=true', 'LOG_LEVEL=info',
    'THREEPROXY_IMAGE=ghcr.io/tarampampam/3proxy:2', 'THREEPROXY_TARBALL=disk1/3proxy.tar',
    'HEALTH_CHECK_INTERVAL_MS=60000', 'HEALTH_CHECK_TIMEOUT_MS=10000',
    'AUTO_PROXY_MODE=semi', 'AUTO_PROXY_POLL_MS=20000', 'AUTO_PROXY_COUNTDOWN_MS=8000',
    'AUTO_PROXY_MAX_CONCURRENT=16', 'AUTO_PROXY_STALE_TTL_MS=1800000',
    'PROXY_DEPLOY_MODE=hub',
  ].join(',');

  await exec(c, `:do {/container/mounts/remove [find list=MOUNT_DATA]} on-error={}
/container/mounts/add list=MOUNT_DATA src=disk1/data dst=/data`);

  const addOut = await exec(c, `/container/add file=disk1/webuiproxymikrotik.tar interface=veth-webui root-dir=${ROOT} name=webuiproxymikrotik mountlists=MOUNT_DATA logging=yes start-on-boot=yes env="${env}"`);
  console.log('\nADD:', addOut);
  if (addOut.includes('failure:')) throw new Error('container add failed');

  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 5000));
    st = await exec(c, '/container/print where name=webuiproxymikrotik');
    const ok = st.includes(' R ') || st.includes('RUNNING');
    console.log(`${(i + 1) * 5}s:`, ok ? 'RUNNING' : st.slice(0, 100));
    if (ok) break;
    if (st.includes('FAILED')) throw new Error('image extract FAILED');
  }

  await exec(c, '/container/start [find name=webuiproxymikrotik]').catch(() => {});
  await new Promise(r => setTimeout(r, 25000));
  console.log('\n--- FINAL ---\n', await exec(c, '/container/print detail where name=webuiproxymikrotik'));
  c.end();
}

main().catch(e => { console.error('\nFAILED:', e.message); process.exit(1); });