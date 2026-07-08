function buildContainerEnv(cfg) {
  const r = cfg.router;
  const w = cfg.webui;
  const a = cfg.autoProxy;
  const n = cfg.network || {};
  const h = cfg.hub || {};
  const entries = [
    'NODE_ENV=production',
    `PORT=${w.port}`,
    'DEPLOY_TARGET=router',
    'MIKROTIK_HOST=172.17.0.1',
    `MIKROTIK_API_USER=${r.sshUser}`,
    `MIKROTIK_API_PASS=${r.sshPass}`,
    'MIKROTIK_REST_PORT=80',
    'MIKROTIK_REST_SCHEME=http',
    `MIKROTIK_SSH_PORT=${r.sshPort}`,
    `MIKROTIK_SSH_USER=${r.sshUser}`,
    `MIKROTIK_SSH_PASS=${r.sshPass}`,
    `JWT_SECRET=${w.jwtSecret}`,
    `ADMIN_USERNAME=${w.adminUser}`,
    `ADMIN_PASSWORD=${w.adminPass}`,
    'DATABASE_URL=file:/data/proxy.db',
    'THREEPROXY_IMAGE=ghcr.io/tarampampam/3proxy:2',
    `THREEPROXY_TARBALL=${cfg.threeProxy.tarball}`,
    `THREEPROXY_HUB_IMAGE=${cfg.threeProxy.hubImage}`,
    `THREEPROXY_HUB_TARBALL=${cfg.threeProxy.hubTarball}`,
    `PROXY_DEPLOY_MODE=${cfg.proxy.deployMode}`,
    // Giảm CPU MikroTik: tắt tail log SSH 2s, metrics poll, hub request log
    'LOW_CPU_MODE=true',
    'HUB_REQUEST_LOG=false',
    'LOGS_TAIL_ENABLED=false',
    'METRICS_ENABLED=false',
    'CONTAINER_LOGGING=false',
    'LOG_LEVEL=warn',
    `HUB_SHARD_SIZE=${h.shardSize || 50}`,
    `HUB_SHARD_COUNT=${h.shardCount || 6}`,
    `HUB_MAX_PPPOE_OUT=${h.maxPppoeOut || 300}`,
    'HUB_FAST_IP_PEEK_MS=0',
    'HUB_RELOAD_DEBOUNCE_MS=2500',
    'HUB_NSCACHE=8192',
    'HEALTH_CHECK_INTERVAL_MS=120000',
    'HEALTH_CHECK_TIMEOUT_MS=10000',
    'AUTO_PROXY_POLL_MS=45000',
    'MIKROTIK_REST_CACHE_MS=8000',
    'CLOCK_TIMEZONE=Asia/Ho_Chi_Minh',
    'CLOCK_NTP_SERVERS=vn.pool.ntp.org,time.google.com,asia.pool.ntp.org',
    'ENABLE_REALTIME=true',
    `AUTO_PROXY_MODE=${a.mode}`,
    `AUTO_PROXY_COUNTDOWN_MS=${a.countdownMs}`,
    `AUTO_PROXY_MAX_CONCURRENT=${a.maxConcurrent}`,
    `AUTO_PROXY_STALE_TTL_MS=${a.staleTtlMs}`,
  ];
  if (cfg.wan.host) entries.push(`MIKROTIK_WAN_HOST=${cfg.wan.host}`);
  if (cfg.wan.host && n.extHttpBase) {
    entries.push(`EXT_HTTP_PORT_BASE=${n.extHttpBase}`);
    entries.push(`EXT_SOCKS_PORT_BASE=${n.extSocksBase || n.extHttpBase + 1000}`);
  }
  return entries.join(',');
}

module.exports = { buildContainerEnv };