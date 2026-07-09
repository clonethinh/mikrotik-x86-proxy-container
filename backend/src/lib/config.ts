// Config loader - load env once, expose typed config
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

const envPath = process.env.ENV_FILE || path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  // Try backend/.env relative to dist/.. 
  const altPath = path.resolve(__dirname, '../../.env');
  if (fs.existsSync(altPath)) dotenv.config({ path: altPath });
}

function required(name: string, defaultVal?: string): string {
  const v = process.env[name] || defaultVal;
  if (v === undefined) throw new Error(`Missing required env: ${name}`);
  return v;
}

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '8088', 10),
  host: process.env.HOST || '0.0.0.0',
  logLevel: process.env.LOG_LEVEL || (process.env.LOW_CPU_MODE === 'true' ? 'warn' : 'info'),

  /** Giảm polling/tail/log — ưu tiên CPU MikroTik thấp */
  lowCpu: process.env.LOW_CPU_MODE === 'true',

  clock: {
    timezone: process.env.CLOCK_TIMEZONE || 'Asia/Ho_Chi_Minh',
    timezoneLabel: process.env.CLOCK_TIMEZONE_LABEL || 'Giờ VN (UTC+7)',
    ntpServers: process.env.CLOCK_NTP_SERVERS || 'vn.pool.ntp.org,time.google.com,asia.pool.ntp.org',
  },
  jwtSecret: required('JWT_SECRET', 'change-me-32-chars-minimum-secret-key'),

  databaseUrl: process.env.DATABASE_URL || 'file:/data/proxy.db',

  deployTarget: (process.env.DEPLOY_TARGET || 'router') as 'router' | 'external',

  mikrotik: {
    /** Cache REST getPppoe/getContainers — giảm REST burst khi WanWatcher + HealthMonitor chạy song song */
    restCacheTtlMs: parseInt(
      process.env.MIKROTIK_REST_CACHE_MS || (process.env.LOW_CPU_MODE === 'true' ? '8000' : '0'),
      10,
    ),
    host: process.env.MIKROTIK_HOST || '127.0.0.1',
    apiUser: process.env.MIKROTIK_API_USER || 'admin',
    apiPass: process.env.MIKROTIK_API_PASS || '',
    restPort: parseInt(process.env.MIKROTIK_REST_PORT || '80', 10),
    restScheme: (process.env.MIKROTIK_REST_SCHEME || 'http') as 'http' | 'https',
    sshPort: parseInt(process.env.MIKROTIK_SSH_PORT || '22222', 10),
    sshUser: process.env.MIKROTIK_SSH_USER || 'admin',
    sshPass: process.env.MIKROTIK_SSH_PASS || '',
    /** @deprecated IP động — chỉ dùng wanHost cho quản trị */
    wanIp: process.env.MIKROTIK_WAN_IP || '',
    wanHost: process.env.MIKROTIK_WAN_HOST || process.env.DUCKDNS_DOMAIN || '',
  },

  threeProxy: {
    image: process.env.THREEPROXY_IMAGE || 'ghcr.io/tarampampam/3proxy:2',
    tarball: process.env.THREEPROXY_TARBALL || 'disk1/3proxy.tar',
    hubImage: process.env.THREEPROXY_HUB_IMAGE || 'webuiproxymikrotik/3proxy-hub:2',
    hubTarball: process.env.THREEPROXY_HUB_TARBALL || 'disk1/3proxy-hub.tar',
  },

  network: {
    httpPortBase: parseInt(process.env.PROXY_HTTP_PORT_BASE || '20000', 10),
    socksPortBase: parseInt(process.env.PROXY_SOCKS_PORT_BASE || '21000', 10),
    extHttpPortBase: parseInt(process.env.EXT_HTTP_PORT_BASE || '30055', 10),
    extSocksPortBase: parseInt(process.env.EXT_SOCKS_PORT_BASE || '31055', 10),
    vethNetworkBase: process.env.VETH_NETWORK_BASE || '172.18',
    bridgeName: process.env.BRIDGE_NAME || 'containers-veth',
    /** LAN subnets — hairpin proxy từ mạng nội bộ */
    lanSubnets: (process.env.LAN_SUBNETS || '192.168.88.0/24,192.168.39.0/24').split(',').map(s => s.trim()).filter(Boolean),
    lanInterfaces: (process.env.LAN_INTERFACES || 'ether1,ether2').split(',').map(s => s.trim()).filter(Boolean),
    containerCidr: process.env.CONTAINER_CIDR || '172.16.0.0/12',
  },

  health: {
    intervalMs: parseInt(
      process.env.HEALTH_CHECK_INTERVAL_MS || (process.env.LOW_CPU_MODE === 'true' ? '120000' : '90000'),
      10,
    ),
    timeoutMs: parseInt(process.env.HEALTH_CHECK_TIMEOUT_MS || '30000', 10),
    /** WanWatcher đã sync WAN — HealthMonitor không poll PPPoE trùng trên router */
    skipWanSyncOnRouter: process.env.HEALTH_SKIP_WAN_SYNC !== 'false',
    /** Ping tự động qua PPPoE (batch round-robin) */
    pingEnabled: process.env.PROXY_PING_ENABLED !== 'false',
    pingIntervalMs: parseInt(
      process.env.PROXY_PING_INTERVAL_MS || (process.env.LOW_CPU_MODE === 'true' ? '45000' : '30000'),
      10,
    ),
    pingBatchSize: parseInt(process.env.HEALTH_PING_BATCH_SIZE || '6', 10),
  },

  logs: {
    /** 3proxy hub ghi request log (disk I/O + SSH tail) — tắt mặc định khi LOW_CPU, bật bằng HUB_REQUEST_LOG=true */
    hubRequestLog: process.env.LOW_CPU_MODE === 'true'
      ? process.env.HUB_REQUEST_LOG === 'true'
      : process.env.HUB_REQUEST_LOG !== 'false',
    /** WebUI tail log hub qua /container/shell — LOW_CPU: bật bằng LOGS_TAIL_ENABLED=true */
    tailEnabled: process.env.LOW_CPU_MODE === 'true'
      ? process.env.LOGS_TAIL_ENABLED === 'true'
      : process.env.LOGS_TAIL_ENABLED !== 'false',
    tailIntervalMs: parseInt(
      process.env.LOGS_TAIL_MS || (process.env.LOW_CPU_MODE === 'true' ? '15000' : '2000'),
      10,
    ),
    /** Aggregate top domains từ request log */
    aggregateEnabled: process.env.LOW_CPU_MODE === 'true'
      ? false
      : process.env.LOGS_AGGREGATE_ENABLED !== 'false',
    /** RouterOS container logging=yes (syslog container) */
    containerLogging: process.env.CONTAINER_LOGGING === 'true',
  },

  metrics: {
    pollIntervalMs: parseInt(
      process.env.METRICS_POLL_MS || (process.env.LOW_CPU_MODE === 'true' ? '10000' : '2000'),
      10,
    ),
    enabled: process.env.LOW_CPU_MODE === 'true'
      ? process.env.METRICS_ENABLED === 'true'
      : process.env.METRICS_ENABLED !== 'false',
    /** Bps từ counter interface PPPoE trên MikroTik (khớp Winbox/REST hơn log 3proxy) */
    pppoeIface: process.env.METRICS_PPPOE_IFACE !== 'false',
  },

  wan: {
    /** Ping xác nhận internet khi IP WAN lên (trước finalize proxy) */
    pingEnabled: process.env.WAN_PING_ON_IP !== 'false',
    pingTarget: process.env.WAN_PING_TARGET || '1.1.1.1',
    pingCount: parseInt(process.env.WAN_PING_COUNT || '2', 10),
    /** Tối thiểu giữa 2 lần ping cùng interface (giảm CPU) */
    pingRetryMs: parseInt(process.env.WAN_PING_RETRY_MS || '30000', 10),
  },

  realtime: {
    wsPath: process.env.WS_PATH || '/ws',
    enabled: process.env.ENABLE_REALTIME !== 'false',
  },

  dataDir: process.env.DATA_DIR || '/data',
  disk1Dir: process.env.DISK1_DIR || 'disk1',

  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    chatId: process.env.TELEGRAM_CHAT_ID || '',
  },

  proxy: {
    /** hub = 1 container nhiều proxy; legacy = 1 container/proxy */
    deployMode: (process.env.PROXY_DEPLOY_MODE || 'hub') as 'hub' | 'legacy',
  },

  sshBlacklist: {
    /** Tự blacklist IP brute-force SSH — tắt bằng SSH_BLACKLIST_ENABLED=false */
    enabled: process.env.SSH_BLACKLIST_ENABLED !== 'false',
    maxFailures: parseInt(process.env.SSH_BLACKLIST_MAX_FAILURES || '5', 10),
    strikeWindow: process.env.SSH_BLACKLIST_STRIKE_WINDOW || '15m',
    blacklistTimeout: process.env.SSH_BLACKLIST_TIMEOUT || '1d',
  },

  hub: {
    shardSize: parseInt(process.env.HUB_SHARD_SIZE || '50', 10),
    shardCount: parseInt(process.env.HUB_SHARD_COUNT || '6', 10),
    maxconnMin: parseInt(process.env.HUB_MAXCONN_MIN || '512', 10),
    maxconnPerSlot: parseInt(process.env.HUB_MAXCONN_PER_SLOT || '64', 10),
    /** DNS cache 3proxy — giảm khi LOW_CPU_MODE (ít RAM/CPU container) */
    nscache: parseInt(
      process.env.HUB_NSCACHE || (process.env.LOW_CPU_MODE === 'true' ? '8192' : '65536'),
      10,
    ),
    /** Tối đa pppoe-out khi tạo nhanh từ WebUI */
    maxPppoeOut: parseInt(process.env.HUB_MAX_PPPOE_OUT || '300', 10),
    /** Peek IP tối đa khi enable (0 = không chờ, apply proxy ngay) */
    fastIpPeekMs: parseInt(process.env.HUB_FAST_IP_PEEK_MS || '0', 10),
    /** Gộp sync cfg + SIGUSR1 reload — giảm CPU khi tạo hàng loạt */
    reloadDebounceMs: parseInt(process.env.HUB_RELOAD_DEBOUNCE_MS || '2500', 10),
    /** Sync cfg + reload 3proxy sau apply — thấp hơn reloadDebounce khi tạo đơn lẻ */
    applyFlushMs: parseInt(process.env.HUB_APPLY_FLUSH_MS || '600', 10),
    /** Repair toàn bộ slot sau mỗi create — tắt mặc định (tốn CPU O(n)) */
    repairAllOnApply: process.env.HUB_REPAIR_ALL_ON_APPLY === 'true',
    /** Tự apply rate-limit firewall sau tạo/sửa proxy — tắt bằng HUB_RATE_LIMIT_ON_APPLY=false */
    rateLimitOnApply: process.env.HUB_RATE_LIMIT_ON_APPLY !== 'false',
    rateLimitDebounceMs: parseInt(
      process.env.HUB_RATE_LIMIT_DEBOUNCE_MS
        || (process.env.LOW_CPU_MODE === 'true' ? '15000' : process.env.HUB_RELOAD_DEBOUNCE_MS || '2500'),
      10,
    ),
  },

  firewallReconcile: {
    /** Tự audit/dọn/repair firewall hub — LOW_CPU: bật bằng FIREWALL_RECONCILE_ENABLED=true */
    enabled: process.env.LOW_CPU_MODE === 'true'
      ? process.env.FIREWALL_RECONCILE_ENABLED === 'true'
      : process.env.FIREWALL_RECONCILE_ENABLED !== 'false',
    intervalMs: parseInt(
      process.env.FIREWALL_RECONCILE_INTERVAL_MS || (process.env.LOW_CPU_MODE === 'true' ? '1800000' : '900000'),
      10,
    ),
    maxSlotsPerPass: parseInt(process.env.FIREWALL_RECONCILE_MAX_SLOTS || '15', 10),
    onBoot: process.env.FIREWALL_RECONCILE_ON_BOOT === 'true',
  },

  autoProxy: {
    mode: (process.env.AUTO_PROXY_MODE || 'semi') as 'off' | 'semi' | 'full',
    pollIntervalMs: parseInt(
      process.env.AUTO_PROXY_POLL_MS || (process.env.LOW_CPU_MODE === 'true' ? '30000' : '20000'),
      10,
    ),
    countdownMs: parseInt(process.env.AUTO_PROXY_COUNTDOWN_MS || '8000', 10),
    ipWaitTimeoutMs: parseInt(process.env.AUTO_PROXY_IP_WAIT_MS || '0', 10),
    maxConcurrent: parseInt(process.env.AUTO_PROXY_MAX_CONCURRENT || '16', 10),
    warnConcurrent: parseInt(process.env.AUTO_PROXY_WARN_CONCURRENT || '12', 10),
    staleTtlMs: parseInt(process.env.AUTO_PROXY_STALE_TTL_MS || String(2 * 60 * 1000), 10),
    goneDebouncePolls: parseInt(process.env.AUTO_PROXY_GONE_DEBOUNCE || '3', 10),
  },
};

export type AppConfig = typeof config;

/** URL quản trị WebUI — luôn theo host (DuckDNS), không hardcode IP. */
export function managementUrl(): string {
  const host = config.mikrotik.wanHost;
  return host ? `http://${host}:${config.port}` : '';
}