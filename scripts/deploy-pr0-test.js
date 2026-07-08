#!/usr/bin/env node
/**
 * Deploy PR-0 (hub log + admin + SIGUSR1) + WebUI code, then verify on router.
 * Usage: node scripts/deploy-pr0-test.js [--skip-build]
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { loadConfig } = require('../setup/lib/config');
const { connect, exec, sftpPut, nextRootDir } = require('../setup/lib/ssh');
const { buildContainerEnv } = require('../setup/lib/env');
const { request, login } = require('../setup/lib/http');
const { step, warn } = require('../setup/lib/logger');

const ROOT = path.join(__dirname, '..');
const VETH_WEBUI = 'veth-webui';
const CTN_IP = '172.17.0.3';

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function buildAll(cfg) {
  step('pr0', 'Building frontend + backend image...');
  execSync('npm run build', { cwd: path.join(ROOT, 'frontend'), stdio: 'inherit' });
  execSync('npm run build', { cwd: path.join(ROOT, 'backend'), stdio: 'inherit' });
  execSync(
    'docker buildx build --platform linux/amd64 -t webuiproxymikrotik:latest --load .',
    { cwd: ROOT, stdio: 'inherit', shell: true },
  );
  const py = fs.existsSync('/usr/bin/python3') ? 'python3' : 'python';
  execSync(`docker save webuiproxymikrotik:latest -o "${cfg.paths.tarOci}"`, { cwd: ROOT, stdio: 'inherit', shell: true });
  execSync(`${py} "${path.join(ROOT, 'scripts/_oci_to_docker.py')}" "${ROOT}"`, { stdio: 'inherit', shell: true });

  step('pr0', 'Building 3proxy-hub image...');
  execSync(`bash "${path.join(ROOT, 'scripts/build-3proxy-hub.sh')}"`, { stdio: 'inherit', shell: true });
}

async function uploadTars(conn, cfg) {
  const webTar = fs.existsSync(cfg.paths.tarDocker) ? cfg.paths.tarDocker : cfg.paths.tarOci;
  await exec(conn, ':do {/file/remove [find name~"webuiproxymikrotik.tar"]} on-error={}').catch(() => {});
  step('pr0', `Upload webuiproxymikrotik.tar (${(fs.statSync(webTar).size / 1024 / 1024).toFixed(1)} MiB)...`);
  await sftpPut(conn, webTar, '/disk1/webuiproxymikrotik.tar');

  await exec(conn, `:do {/file/remove [find name=${cfg.threeProxy.hubTarball}]} on-error={}`).catch(() => {});
  step('pr0', `Upload 3proxy-hub.tar (${(fs.statSync(cfg.paths.tar3proxyHub).size / 1024 / 1024).toFixed(1)} MiB)...`);
  await sftpPut(conn, cfg.paths.tar3proxyHub, `/${cfg.threeProxy.hubTarball}`);
}

async function redeployWebui(conn, cfg) {
  step('pr0', 'Redeploy webuiproxymikrotik container...');
  await exec(conn, '/container/stop [find name=webuiproxymikrotik]').catch(() => {});
  await sleep(8000);
  await exec(conn, '/container/remove [find name=webuiproxymikrotik]').catch(() => {});
  await sleep(5000);

  const rootDir = await nextRootDir(conn);
  const env = buildContainerEnv(cfg);
  const addOut = await exec(
    conn,
    `/container/add file=disk1/webuiproxymikrotik.tar interface=${VETH_WEBUI} root-dir=${rootDir} name=webuiproxymikrotik mountlists=MOUNT_DATA logging=yes start-on-boot=yes env="${env}"`,
    60000,
  );
  if (addOut.includes('failure:')) throw new Error(`webui add failed: ${addOut.trim().slice(0, 200)}`);

  for (let i = 0; i < 24; i++) {
    await sleep(5000);
    const st = await exec(conn, '/container/print where name=webuiproxymikrotik');
    if (st.includes(' R ') || st.includes('RUNNING')) break;
    if (st.includes('FAILED')) throw new Error('webui extract FAILED');
  }
  await exec(conn, '/container/start [find name=webuiproxymikrotik]').catch(() => {});
  await sleep(25000);
}

function hubShardSpec(shardId, cfg) {
  if (shardId === 0) {
    return {
      name: 'proxy3p-hub',
      veth: 'veth-3p-hub',
      mountList: 'MOUNT_HUB_CFG',
      rootDir: 'disk1/3proxy-hub2',
      adminPort: 31800,
      containerIp: '172.18.0.2',
    };
  }
  const n = shardId + 1;
  return {
    name: `proxy3p-hub-${n}`,
    veth: `veth-3p-hub-${n}`,
    mountList: `MOUNT_HUB_CFG_${n}`,
    rootDir: `disk1/3proxy-hub${shardId + 2}`,
    adminPort: 31800 + shardId,
    containerIp: `172.${18 + shardId}.0.2`,
  };
}

async function redeployHubShard(conn, cfg, shardId) {
  const s = hubShardSpec(shardId, cfg);
  const exists = await exec(conn, `/container/print where name=${s.name}`);
  if (!exists.includes(s.name)) {
    step('pr0', `${s.name} not found — skip hub redeploy (tạo proxy từ WebUI)`);
    return false;
  }

  step('pr0', `Redeploy ${s.name} with new 3proxy-hub.tar...`);
  const detail = await exec(conn, `/container/print detail where name=${s.name}`);
  const envMatch = detail.match(/env=([^\s]+)/);
  const env = envMatch ? envMatch[1] : `PROXY_PORT=${30055 + shardId * 50 + 1},SOCKS_PORT=${31055 + shardId * 50 + 1}`;

  await exec(conn, `/container/stop [find name=${s.name}]`).catch(() => {});
  await sleep(5000);
  await exec(conn, `/container/remove [find name=${s.name}]`).catch(() => {});
  await sleep(3000);

  const addOut = await exec(
    conn,
    `/container/add file=${cfg.threeProxy.hubTarball} interface=${s.veth} root-dir=${s.rootDir} name=${s.name} mountlists=${s.mountList} env=${env} logging=yes start-on-boot=yes stop-on-unhealthy=no`,
    60000,
  );
  if (addOut.includes('failure:')) throw new Error(`${s.name} add failed: ${addOut.trim().slice(0, 200)}`);

  step('pr0', `Waiting ${s.name} extract (60s)...`);
  await sleep(60000);
  await exec(conn, `/container/start [find name=${s.name}]`).catch(() => {});
  await sleep(15000);
  return true;
}

async function syncAllHubShards(cfg, token) {
  const proxies = await request('GET', `${cfg.webuiUrl}/api/proxies`, null, token);
  if (proxies.status !== 200 || !Array.isArray(proxies.data)) {
    warn('Cannot list proxies for sync');
    return;
  }
  const enabled = proxies.data.filter(p => p.enabled);
  const seenShard = new Set();
  step('pr0', `Sync hub cfg via reapply (${enabled.length} proxies)...`);
  for (const p of enabled) {
    const shard = Math.floor((p.pppoeIdx - 1) / (cfg.hub?.shardSize || 50));
    if (seenShard.has(shard)) continue;
    seenShard.add(shard);
    const r = await request('POST', `${cfg.webuiUrl}/api/proxies/${p.id}/reapply`, {}, token);
    step('pr0', `reapply proxy ${p.id} (shard ${shard + 1}): HTTP ${r.status}`);
    await sleep(8000);
  }
}

async function getMonitorPassword(conn) {
  const out = await exec(
    conn,
    `/container/shell webuiproxymikrotik cmd="/bin/sh -c 'node -e \\"const {PrismaClient}=require(\\\\'@prisma/client\\\\');const p=new PrismaClient();p.setting.findUnique({where:{key:\\\\'hub.monitorPassword\\\\'}}).then(r=>console.log(r?.value||\\\\'\\\\')).finally(()=>p.\\\\$disconnect())\\"' 2>/dev/null"`,
    45000,
  ).catch(() => '');
  const line = out.split('\n').map(s => s.trim()).find(s => /^[A-Za-z0-9_-]{12,}$/.test(s));
  return line || null;
}

async function testPr0(conn, cfg, token) {
  const results = {};
  const shards = cfg.hub?.shardCount || 2;

  step('pr0-test', '1) Hub container running...');
  for (let sid = 0; sid < shards; sid++) {
    const s = hubShardSpec(sid, cfg);
    const st = await exec(conn, `/container/print where name=${s.name}`);
    results[`${s.name}_running`] = /\s[RCUH]\s/.test(st) || st.includes('RUNNING') || st.includes('HEALTHY');
  }

  const monPass = await getMonitorPassword(conn);
  results.monitorPassword = !!monPass;

  for (let sid = 0; sid < shards; sid++) {
    const s = hubShardSpec(sid, cfg);
    if (!results[`${s.name}_running`]) continue;

    step('pr0-test', `2) Admin GET /S shard${sid + 1}...`);
    const adminOut = await exec(
      conn,
      `/container/shell ${s.name} cmd="/bin/sh -c 'curl -sf -m 8 -u _webui_mon:${monPass || 'x'} http://127.0.0.1:${s.adminPort}/S | head -c 400'"`,
      20000,
    );
    results[`admin_S_shard${sid + 1}`] = adminOut.includes('<') || adminOut.includes('item');

    step('pr0-test', `3) Log dir + file shard${sid + 1}...`);
    const logOut = await exec(
      conn,
      `/container/shell ${s.name} cmd="/bin/sh -c 'ls -la /var/log/3proxy/ 2>/dev/null; ls /var/log/3proxy/shard${sid + 1}-*.log 2>/dev/null | head -1'"`,
      15000,
    );
    results[`log_dir_shard${sid + 1}`] = logOut.includes('/var/log/3proxy');
    results[`log_file_shard${sid + 1}`] = /shard\d+-\d{8}\.log/.test(logOut);

    step('pr0-test', `4) cfg has admin+logformat shard${sid + 1}...`);
    const cfgOut = await exec(
      conn,
      `/container/shell ${s.name} cmd="/bin/sh -c 'grep -E \\\"^(admin|log |logformat)\\\" /etc/3proxy/3proxy.cfg | head -6'"`,
      15000,
    );
    results[`cfg_admin_shard${sid + 1}`] = cfgOut.includes('admin -s');
    results[`cfg_log_shard${sid + 1}`] = cfgOut.includes('/var/log/3proxy/') && cfgOut.includes('logformat');

    step('pr0-test', `5) SIGUSR1 reload shard${sid + 1}...`);
    const reloadOut = await exec(
      conn,
      `/container/shell ${s.name} cmd="/bin/sh -c 'PID=\\$(pidof 3proxy); kill -USR1 \\$PID 2>/dev/null; sleep 2; pgrep -x 3proxy >/dev/null && echo RELOAD_OK || echo RELOAD_FAIL'"`,
      20000,
    );
    results[`sigusr1_shard${sid + 1}`] = reloadOut.includes('RELOAD_OK');
  }

  step('pr0-test', '6) WebUI health + metrics API...');
  const health = await request('GET', `${cfg.webuiUrl}/api/health`);
  results.webui_health = health.status === 200;

  const proxies = await request('GET', `${cfg.webuiUrl}/api/proxies`, null, token);
  if (proxies.status === 200 && Array.isArray(proxies.data) && proxies.data.length) {
    const p = proxies.data.find(x => x.enabled) || proxies.data[0];
    const live = await request('GET', `${cfg.webuiUrl}/api/proxies/${p.id}/metrics/live`, null, token);
    results.metrics_live = live.status === 200;
  }

  return results;
}

async function main() {
  const skipBuild = process.argv.includes('--skip-build');
  const cfg = loadConfig();

  console.log('\n=== PR-0 Deploy + Test ===');
  console.log(`Router: ${cfg.router.host}`);
  console.log(`WebUI:  ${cfg.webuiUrl}\n`);

  if (!skipBuild) await buildAll(cfg);

  const conn = await connect(cfg);
  try {
    await uploadTars(conn, cfg);
    await redeployWebui(conn, cfg);

    const shards = cfg.hub?.shardCount || 2;
    for (let sid = 0; sid < shards; sid++) {
      await redeployHubShard(conn, cfg, sid);
    }
  } finally {
    conn.end();
  }

  step('pr0', 'Login WebUI + trigger hub sync...');
  let token;
  for (let i = 0; i < 12; i++) {
    try {
      token = await login(cfg.webuiUrl, cfg.webui.adminUser, cfg.webui.adminPass);
      break;
    } catch {
      await sleep(10000);
    }
  }
  if (!token) throw new Error('WebUI login failed after redeploy');

  await syncAllHubShards(cfg, token);
  await sleep(20000);

  const conn2 = await connect(cfg);
  let results;
  try {
    results = await testPr0(conn2, cfg, token);
  } finally {
    conn2.end();
  }

  console.log('\n=== PR-0 Test Results ===');
  const entries = Object.entries(results);
  let pass = 0;
  let fail = 0;
  for (const [k, v] of entries) {
    const icon = v ? '✓' : '✗';
    console.log(`  ${icon} ${k}: ${v}`);
    if (v) pass++; else fail++;
  }
  console.log(`\n${pass}/${entries.length} checks passed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('\nPR-0 deploy failed:', e.message);
  process.exit(1);
});