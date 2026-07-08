/** Cập nhật MIKROTIK_WAN_HOST trên container webuiproxymikrotik (không redeploy image) */
const { Client } = require('ssh2');

const HOST = process.env.MIKROTIK_HOST || 'ntpcproxy.duckdns.org';
const USER = process.env.MIKROTIK_SSH_USER || 'admin';
const PASS = process.env.MIKROTIK_SSH_PASS || 'toanthinh';
const WAN_HOST = process.env.MIKROTIK_WAN_HOST || 'ntpcproxy.duckdns.org';

function exec(conn, cmd, t = 120000) {
  return new Promise((res, rej) => {
    let o = '';
    const timer = setTimeout(() => rej(new Error('timeout')), t);
    conn.exec(cmd, (e, s) => {
      if (e) { clearTimeout(timer); return rej(e); }
      s.on('close', () => { clearTimeout(timer); res(o); });
      s.on('data', d => { o += d; process.stdout.write(d); });
      s.stderr.on('data', d => { o += d; });
    });
  });
}

async function main() {
  const c = new Client();
  await new Promise((r, j) => { c.on('ready', r); c.on('error', j); c.connect({ host: HOST, port: 22222, username: USER, password: PASS }); });

  const env = [
    'NODE_ENV=production', 'PORT=8088', 'DEPLOY_TARGET=router',
    'MIKROTIK_HOST=172.17.0.1', `MIKROTIK_API_USER=${USER}`, `MIKROTIK_API_PASS=${PASS}`,
    'MIKROTIK_REST_PORT=80', 'MIKROTIK_REST_SCHEME=http',
    `MIKROTIK_SSH_USER=${USER}`, `MIKROTIK_SSH_PASS=${PASS}`, 'MIKROTIK_SSH_PORT=22222',
    `MIKROTIK_WAN_HOST=${WAN_HOST}`,
    'JWT_SECRET=webuiproxymikrotik-change-in-prod-32chars-x',
    'ADMIN_USERNAME=admin', 'ADMIN_PASSWORD=admin123',
    'DATABASE_URL=file:/data/proxy.db', 'ENABLE_REALTIME=true', 'LOG_LEVEL=info',
    'THREEPROXY_IMAGE=ghcr.io/tarampampam/3proxy:2', 'THREEPROXY_TARBALL=disk1/3proxy.tar',
    'HEALTH_CHECK_INTERVAL_MS=60000', 'HEALTH_CHECK_TIMEOUT_MS=10000',
    'AUTO_PROXY_MODE=semi', 'AUTO_PROXY_POLL_MS=20000', 'AUTO_PROXY_COUNTDOWN_MS=8000',
    'AUTO_PROXY_MAX_CONCURRENT=16', 'AUTO_PROXY_STALE_TTL_MS=1800000',
  ].join(',');

  console.log('Stopping webui...');
  await exec(c, '/container/stop [find name=webuiproxymikrotik]').catch(() => {});
  await new Promise(r => setTimeout(r, 8000));
  console.log('Updating env...');
  await exec(c, `/container/set [find name=webuiproxymikrotik] env="${env}"`);
  await exec(c, '/container/start [find name=webuiproxymikrotik]').catch(() => {});
  await new Promise(r => setTimeout(r, 25000));
  console.log('\nDone. WebUI: http://' + WAN_HOST + ':8088');
  c.end();
}

main().catch(e => { console.error(e); process.exit(1); });