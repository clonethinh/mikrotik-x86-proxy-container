const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

function loadRouterAccess() {
  try {
    const p = path.join(ROOT, 'router-access.json');
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch { /* ignore */ }
  return {};
}

function loadDeployConfig() {
  const access = loadRouterAccess();
  const host = process.env.MIK_HOST || access.host || 'ntpcproxy.duckdns.org';
  const user = process.env.MIK_USER || access.ssh?.user || 'admin';
  const pass = process.env.MIK_PASS || process.env.MIKROTIK_API_PASS || 'toanthinh';
  const sshPort = process.env.SSH_PORT || String(access.ssh?.port || 22222);
  const wanHost = process.env.MIKROTIK_WAN_HOST || access.wan?.host || host;
  const wanIp = process.env.MIKROTIK_WAN_IP || access.wan?.ip || '42.119.198.233';
  const webuiPort = access.webui?.port || 8088;
  const adminPass = process.env.ADMIN_PASS || 'admin123';
  const jwtSecret = process.env.JWT_SECRET || 'webuiproxymikrotik-change-in-prod-32chars-x';

  return {
    root: ROOT,
    tar: path.join(ROOT, 'webuiproxymikrotik.tar'),
    host,
    user,
    pass,
    sshPort,
    wanHost,
    wanIp,
    webui: `http://${host}:${webuiPort}`,
    rest: `http://${host}`,
    auth: Buffer.from(`${user}:${pass}`).toString('base64'),
    adminPass,
    jwtSecret,
  };
}

function buildContainerEnv(cfg) {
  return [
    'NODE_ENV=production', 'PORT=8088', 'DEPLOY_TARGET=router',
    'MIKROTIK_HOST=172.17.0.1', `MIKROTIK_API_USER=${cfg.user}`, `MIKROTIK_API_PASS=${cfg.pass}`,
    'MIKROTIK_REST_PORT=80', 'MIKROTIK_REST_SCHEME=http',
    `MIKROTIK_SSH_PORT=${cfg.sshPort}`, `MIKROTIK_SSH_USER=${cfg.user}`, `MIKROTIK_SSH_PASS=${cfg.pass}`,
    `MIKROTIK_WAN_IP=${cfg.wanIp}`, `MIKROTIK_WAN_HOST=${cfg.wanHost}`,
    `JWT_SECRET=${cfg.jwtSecret}`, 'ADMIN_USERNAME=admin', `ADMIN_PASSWORD=${cfg.adminPass}`,
    'DATABASE_URL=file:/data/proxy.db',
    'THREEPROXY_IMAGE=ghcr.io/tarampampam/3proxy:2', 'THREEPROXY_TARBALL=disk1/3proxy.tar',
    'THREEPROXY_HUB_IMAGE=webuiproxymikrotik/3proxy-hub:2', 'THREEPROXY_HUB_TARBALL=disk1/3proxy-hub.tar',
    'PROXY_DEPLOY_MODE=hub', 'HUB_SHARD_SIZE=50', 'HUB_SHARD_COUNT=6', 'HUB_MAX_PPPOE_OUT=300',
    'LOW_CPU_MODE=true', 'HUB_REQUEST_LOG=true', 'LOGS_TAIL_ENABLED=true', 'METRICS_ENABLED=true',
    'LOGS_TAIL_MS=10000', 'METRICS_POLL_MS=10000',
    'CONTAINER_LOGGING=false', 'LOG_LEVEL=warn', 'HUB_FAST_IP_PEEK_MS=0', 'HUB_APPLY_FLUSH_MS=600', 'HUB_RELOAD_DEBOUNCE_MS=2500',
    'FIREWALL_RECONCILE_ENABLED=true', 'FIREWALL_RECONCILE_INTERVAL_MS=1800000', 'FIREWALL_RECONCILE_MAX_SLOTS=15',
    'HUB_NSCACHE=8192', 'HEALTH_CHECK_INTERVAL_MS=120000', 'HEALTH_CHECK_TIMEOUT_MS=10000',
    'PROXY_PING_ENABLED=true', 'PROXY_PING_INTERVAL_MS=45000', 'HEALTH_PING_BATCH_SIZE=6', 'METRICS_PPPOE_IFACE=true', 'ROUTER_TRAFFIC_POLL_MS=3000',
    'AUTO_PROXY_POLL_MS=15000', 'MIKROTIK_REST_CACHE_MS=10000', 'HUB_RATE_LIMIT_DEBOUNCE_MS=15000', 'ENABLE_REALTIME=true',
  ].join(',');
}

module.exports = { loadDeployConfig, buildContainerEnv, loadRouterAccess };