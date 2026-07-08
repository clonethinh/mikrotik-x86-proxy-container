#!/usr/bin/env node
/**
 * Áp dụng scale 300 lên router đang chạy (không recreate container).
 * - set env HUB_SHARD_COUNT=6, HUB_MAX_PPPOE_OUT=300
 * - patch dist từ backend/dist
 * - restart webui + cập nhật hairpin port range
 */
const fs = require('fs');
const path = require('path');
const { loadConfig } = require('../setup/lib/config');
const { connect, exec } = require('../setup/lib/ssh');
const { login, request } = require('../setup/lib/http');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'backend', 'dist');
const PATCH_FILES = [
  'lib/hubUtils.js',
  'lib/config.js',
  'services/proxy/HubProxyService.js',
  'server.js',
];

const ENV =
  'NODE_ENV=production,PORT=8088,DEPLOY_TARGET=router,MIKROTIK_HOST=172.17.0.1,' +
  'MIKROTIK_API_USER=admin,MIKROTIK_API_PASS=toanthinh,MIKROTIK_REST_PORT=80,MIKROTIK_REST_SCHEME=http,' +
  'MIKROTIK_SSH_PORT=22,MIKROTIK_SSH_USER=admin,MIKROTIK_SSH_PASS=toanthinh,' +
  'MIKROTIK_WAN_IP=113.22.235.54,MIKROTIK_WAN_HOST=ntpcproxy.duckdns.org,' +
  'JWT_SECRET=webuiproxymikrotik-change-in-prod-32chars-x,ADMIN_USERNAME=admin,ADMIN_PASSWORD=admin123,' +
  'DATABASE_URL=file:/data/proxy.db,THREEPROXY_IMAGE=ghcr.io/tarampampam/3proxy:2,THREEPROXY_TARBALL=disk1/3proxy.tar,' +
  'THREEPROXY_HUB_IMAGE=webuiproxymikrotik/3proxy-hub:2,THREEPROXY_HUB_TARBALL=disk1/3proxy-hub.tar,' +
  'PROXY_DEPLOY_MODE=hub,HUB_SHARD_SIZE=50,HUB_SHARD_COUNT=6,HUB_MAX_PPPOE_OUT=300,' +
  'LOW_CPU_MODE=true,HUB_REQUEST_LOG=false,LOGS_TAIL_ENABLED=false,METRICS_ENABLED=false,' +
  'CONTAINER_LOGGING=false,LOG_LEVEL=warn,HUB_FAST_IP_PEEK_MS=0,HUB_RELOAD_DEBOUNCE_MS=2500,HUB_NSCACHE=8192,' +
  'HEALTH_CHECK_INTERVAL_MS=120000,HEALTH_CHECK_TIMEOUT_MS=10000,AUTO_PROXY_POLL_MS=45000,' +
  'MIKROTIK_REST_CACHE_MS=8000,ENABLE_REALTIME=true';

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function patchFile(conn, relPath) {
  const local = path.join(DIST, relPath);
  const b64 = Buffer.from(fs.readFileSync(local, 'utf8')).toString('base64');
  const remote = `/app/dist/${relPath}`;
  const cmd = `echo ${b64} | base64 -d > ${remote}`;
  const out = await exec(
    conn,
    `/container/shell webuiproxymikrotik cmd="/bin/sh -c '${cmd.replace(/'/g, "'\\''")}'"`,
    60000,
  );
  if (out.includes('failure:')) throw new Error(`patch ${relPath}: ${out.trim()}`);
  console.log(`  patched ${relPath}`);
}

async function main() {
  const cfg = loadConfig();
  const host = cfg.wan.host || cfg.router.host;
  const webui = `http://${host}:${cfg.webui.port || 8088}`;
  const conn = await connect(cfg);

  console.log('=== 1. Set container env ===');
  await exec(
    conn,
    `/container/set [find name=webuiproxymikrotik] env=${ENV} logging=no stop-on-unhealthy=no`,
    30000,
  );

  console.log('=== 2. Patch dist files ===');
  for (const f of PATCH_FILES) await patchFile(conn, f);

  console.log('=== 3. Restart webui (stop/start, giữ layer) ===');
  await exec(conn, '/container/stop [find name=webuiproxymikrotik]');
  await sleep(8000);
  await exec(conn, '/container/start [find name=webuiproxymikrotik]');
  await sleep(28000);

  const verify = await exec(
    conn,
    '/container/shell webuiproxymikrotik cmd="grep hubExtPortEnd /app/dist/lib/hubUtils.js | head -1"',
    15000,
  );
  console.log('  hubExtPortEnd:', verify.trim());

  console.log('=== 4. Hairpin port range 30055-31355 ===');
  const extRange = '30055-31355';
  const comments = [
    'hub-mangle-lan-proxy',
    'hub-mangle-lan-wan',
    'hub-mangle-lan-proxy-ether1',
    'hub-mangle-lan-proxy-ether2',
  ];
  for (const cmt of comments) {
    await exec(
      conn,
      `:do {/ip/firewall/mangle/set [find comment=${cmt}] dst-port=${extRange}} on-error={}`,
      8000,
    );
  }
  for (const ifName of ['ether1', 'ether2']) {
    await exec(
      conn,
      `:do {/ip/firewall/filter/set [find comment=hub-in-lan-proxy-${ifName}] dst-port=${extRange}} on-error={}`,
      8000,
    );
  }

  console.log('=== 5. Hub prep mounts (6 shard) ===');
  const { run } = require('../setup/steps/hub-prep');
  await run({ ...cfg, hub: { ...cfg.hub, shardCount: 6, maxPppoeOut: 300 } });

  console.log('=== 6. Verify API ===');
  const token = await login(webui, cfg.webui.adminUser, cfg.webui.adminPass);
  const health = await request('GET', `${webui}/api/health`, null, token);
  console.log('  health:', health.status);

  const mounts = await exec(conn, '/container/mounts/print where list~"MOUNT_HUB"');
  const lists = new Set();
  for (const line of mounts.split('\n')) {
    const m = line.match(/MOUNT_HUB[^\s]*/);
    if (m) lists.add(m[0]);
  }
  console.log('  mount lists:', [...lists].sort().join(', '));

  const mangle = await exec(conn, '/ip/firewall/mangle/print where comment="hub-mangle-lan-proxy"');
  console.log('  hairpin:', (mangle.match(/dst-port=[^\s]+/) || ['?'])[0]);

  conn.end();
  console.log('\nDONE — scale 300 ready. Tạo pppoe-out52..300 từ WebUI.');
}

main().catch(e => {
  console.error('FAIL:', e.message);
  process.exit(1);
});