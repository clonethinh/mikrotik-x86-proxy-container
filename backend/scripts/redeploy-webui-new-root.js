const { Client } = require('ssh2');
const HOST = '113.22.235.54';
const USER = 'admin';
const PASS = 'toanthinh';
const ROOT = 'disk1/webuiproxymikrotik-root3';

function exec(conn, cmd, t = 120000) {
  return new Promise((res, rej) => {
    let o = '';
    const timer = setTimeout(() => rej(new Error('timeout')), t);
    conn.exec(cmd, (e, s) => {
      if (e) { clearTimeout(timer); return rej(e); }
      s.on('close', () => { clearTimeout(timer); res(o); });
      s.on('data', d => { o += d; });
      s.stderr.on('data', d => { o += d; });
    });
  });
}

async function main() {
  const c = new Client();
  await new Promise((r, j) => { c.on('ready', r); c.on('error', j); c.connect({ host: HOST, port: 22222, username: USER, password: PASS }); });

  await exec(c, '/container/stop [find name=webuiproxymikrotik]', 60000).catch(() => {});
  await new Promise(r => setTimeout(r, 10000));
  await exec(c, '/container/remove [find name=webuiproxymikrotik]', 60000).catch(() => {});
  await new Promise(r => setTimeout(r, 5000));
  await exec(c, `:do {/disk/remove [find name~"webuiproxymikrotik-root"]} on-error={}`).catch(() => {});
  await new Promise(r => setTimeout(r, 2000));

  const env = [
    'NODE_ENV=production', 'PORT=8088', 'DEPLOY_TARGET=router',
    'MIKROTIK_HOST=172.17.0.1', `MIKROTIK_API_USER=${USER}`, `MIKROTIK_API_PASS=${PASS}`,
    'MIKROTIK_REST_PORT=80', 'MIKROTIK_REST_SCHEME=http',
    `MIKROTIK_SSH_USER=${USER}`, `MIKROTIK_SSH_PASS=${PASS}`, 'MIKROTIK_SSH_PORT=22222',
    'MIKROTIK_WAN_IP=113.22.235.54',
    'JWT_SECRET=webuiproxymikrotik-change-in-prod-32chars-x',
    'ADMIN_USERNAME=admin', 'ADMIN_PASSWORD=admin123',
    'DATABASE_URL=file:/data/proxy.db', 'ENABLE_REALTIME=true', 'LOG_LEVEL=info',
    'THREEPROXY_IMAGE=ghcr.io/tarampampam/3proxy:2', 'THREEPROXY_TARBALL=disk1/3proxy.tar',
    'HEALTH_CHECK_INTERVAL_MS=60000', 'HEALTH_CHECK_TIMEOUT_MS=10000',
    'AUTO_PROXY_MODE=semi', 'AUTO_PROXY_POLL_MS=20000', 'AUTO_PROXY_COUNTDOWN_MS=8000',
    'AUTO_PROXY_MAX_CONCURRENT=16', 'AUTO_PROXY_STALE_TTL_MS=1800000',
  ].join(',');

  await exec(c, `:do {/container/mounts/remove [find list=MOUNT_DATA]} on-error={}
/container/mounts/add list=MOUNT_DATA src=disk1/data dst=/data`);

  const out = await exec(c, `/container/add file=disk1/webuiproxymikrotik.tar interface=veth-webui root-dir=${ROOT} name=webuiproxymikrotik mountlists=MOUNT_DATA logging=yes start-on-boot=yes env="${env}"`);
  console.log('ADD:', out);

  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const st = await exec(c, '/container/print where name=webuiproxymikrotik');
    const ok = st.includes(' R ') || st.includes('RUNNING');
    console.log(`${(i + 1) * 5}s:`, ok ? 'RUNNING' : st.slice(0, 120));
    if (ok) break;
  }

  await exec(c, '/container/start [find name=webuiproxymikrotik]').catch(() => {});
  await new Promise(r => setTimeout(r, 20000));
  console.log(await exec(c, '/container/print where name=webuiproxymikrotik'));
  c.end();
}

main().catch(e => { console.error(e); process.exit(1); });