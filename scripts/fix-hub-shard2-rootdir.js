#!/usr/bin/env node
/**
 * Sửa root-dir overlap shard2: patch hubUtils + provision pppoe-out51.
 * Usage: node scripts/fix-hub-shard2-rootdir.js
 */
const fs = require('fs');
const path = require('path');
const { loadConfig } = require('../setup/lib/config');
const { connect, exec } = require('../setup/lib/ssh');
const { login, request } = require('../setup/lib/http');

const HUBUTILS_B64 = Buffer.from(
  fs.readFileSync(path.join(__dirname, '../backend/dist/lib/hubUtils.js'), 'utf8'),
).toString('base64');

async function main() {
  const cfg = loadConfig();
  const host = cfg.wan.host || cfg.router.host;
  const webui = `http://${host}:${cfg.webui.port || 8088}`;
  const conn = await connect(cfg);

  try {
    console.log('=== 1. MOUNT_HUB_CFG_2 ===');
    await exec(conn, ':do {/file/add name=disk1/hub-3proxy-2.cfg contents="# hub shard2"} on-error={}');
    await exec(conn, ':do {/file/add name=disk1/hub-slot-ips-2 contents=""} on-error={}');
    const mounts = await exec(conn, '/container/mounts/print where list=MOUNT_HUB_CFG_2');
    if (!mounts.includes('hub-slot-ips')) {
      await exec(conn, '/container/mounts/add list=MOUNT_HUB_CFG_2 src=disk1/hub-slot-ips-2 dst=/etc/3proxy/hub-slot-ips');
      console.log('  added hub-slot-ips-2');
    }

    console.log('=== 2. Patch hubUtils.js (hotfix via base64) ===');
    const patchCmd = `echo ${HUBUTILS_B64} | base64 -d > /app/dist/lib/hubUtils.js && grep shardId /app/dist/lib/hubUtils.js | tail -1`;
    const patchOut = await exec(
      conn,
      `/container/shell webuiproxymikrotik cmd="/bin/sh -c '${patchCmd.replace(/'/g, "'\\''")}'"`,
      45000,
    );
    console.log(' ', patchOut.trim().split('\n').pop());

    console.log('=== 3. Restart webui container (keep writable layer) ===');
    await exec(conn, '/container/stop [find name=webuiproxymikrotik]');
    await sleep(6000);
    await exec(conn, '/container/start [find name=webuiproxymikrotik]');
    await sleep(22000);

    const verify = await exec(conn, '/container/shell webuiproxymikrotik cmd="grep 3proxy-hub /app/dist/lib/hubUtils.js | tail -1"', 15000);
    console.log('  verify:', verify.trim());
    if (!verify.includes('shardId + 2')) {
      throw new Error('Patch không giữ sau restart — cần deploy lại image');
    }

    console.log('=== 4. Provision pppoe-out51 ===');
    const token = await login(webui, cfg.webui.adminUser, cfg.webui.adminPass);
    const prov = await request('POST', `${webui}/api/wan/51/provision/now`, null, token);
    console.log('  provision:', prov.status, JSON.stringify(prov.data).slice(0, 400));
    if (prov.status >= 400) throw new Error(`provision failed: ${prov.raw?.slice?.(0, 200)}`);

    await sleep(25000);

    const hubs = await exec(conn, '/container/print where name~"proxy3p-hub"');
    console.log('=== 5. Hub containers ===');
    console.log(hubs);

    const proxies = await request('GET', `${webui}/api/proxies`, null, token);
    const list = proxies.data?.proxies || proxies.data || [];
    const p51 = list.find(p => p.pppoeIdx === 51);
    console.log('=== 6. Proxy out51 ===');
    console.log(JSON.stringify(p51, null, 2));
  } finally {
    conn.end();
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

main().catch(e => {
  console.error('FAIL:', e.message);
  process.exit(1);
});