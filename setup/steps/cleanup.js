const fs = require('fs');
const path = require('path');
const { connect, exec } = require('../lib/ssh');
const { step, warn } = require('../lib/logger');

async function cleanupFleet(conn) {
  // Chỉ legacy proxy3p-N — giữ proxy3p-hub / proxy3p-hub-2 (hub sharded)
  step('30-cleanup', 'Stop/remove legacy proxy3p-[0-9] containers...');
  await exec(conn, '/container/stop [find where name~"^proxy3p-[0-9]"]').catch(() => {});
  await sleep(8000);
  await exec(conn, '/container/remove [find where name~"^proxy3p-[0-9]"]').catch(() => {});
  await sleep(3000);

  step('30-cleanup', 'Remove veth-3p-* (index loop)...');
  for (let i = 1; i <= 99; i++) {
    const n = `veth-3p-${i}`;
    await exec(conn, `:do {/interface/bridge/port/remove [find interface=${n}]} on-error={}`).catch(() => {});
    await exec(conn, `:do {/interface/veth/remove [find name=${n}]} on-error={}`).catch(() => {});
    await exec(conn, `:do {/ip/address/remove [find comment=gw-veth-3p-${i}]} on-error={}`).catch(() => {});
  }

  step('30-cleanup', 'Remove NAT/mangle comments...');
  await exec(conn, `:do {/ip/firewall/nat/remove [find comment~"ctn-pppoe-out"]} on-error={}`).catch(() => {});
  await exec(conn, `:do {/ip/firewall/mangle/remove [find comment~"ctn-mangle-pppoe-out"]} on-error={}`).catch(() => {});

  step('30-cleanup', 'Remove to_pppoe* routing tables...');
  for (let i = 1; i <= 99; i++) {
    const t = `to_pppoe${i}`;
    await exec(conn, `:do {/ip/route/remove [find routing-table=${t}]} on-error={}`).catch(() => {});
    await exec(conn, `:do {/routing/table/remove [find name=${t}]} on-error={}`).catch(() => {});
  }

  step('30-cleanup', 'Remove proxy mounts/envlist/users.json/3proxy roots...');
  await exec(conn, `:do {/container/mounts/remove [find list~"^MOUNT_PROXY_"]} on-error={}`).catch(() => {});
  await exec(conn, `:do {/container/envlist/remove [find name~"^ENV_3PROXY_"]} on-error={}`).catch(() => {});
  await exec(conn, `:do {/file/remove [find name~"disk1/users-"]} on-error={}`).catch(() => {});
  await exec(conn, `:do {/disk/remove [find name~"3proxy-p"]} on-error={}`).catch(() => {});

  const left = await exec(conn, '/container/print count-only where name~"proxy3p"');
  step('30-cleanup', `proxy3p containers remaining: ${left.trim() || '0'}`);
}

async function cleanupWebui(conn, cfg) {
  step('31-cleanup-webui', 'Stop webuiproxymikrotik...');
  for (let i = 0; i < 3; i++) {
    await exec(conn, '/container/stop [find name=webuiproxymikrotik]').catch(() => {});
    await sleep(8000);
    const st = await exec(conn, '/container/print where name=webuiproxymikrotik');
    if (!st.includes(' R ') && !st.includes('RUNNING')) break;
  }

  step('31-cleanup-webui', 'Remove webuiproxymikrotik container...');
  for (let i = 0; i < 3; i++) {
    await exec(conn, '/container/remove [find name=webuiproxymikrotik]').catch(() => {});
    await sleep(5000);
    const st = await exec(conn, '/container/print where name=webuiproxymikrotik');
    if (!st.includes('webuiproxymikrotik')) break;
  }

  step('31-cleanup-webui', 'Remove webuiproxymikrotik-root* dirs...');
  await exec(conn, `:do {/disk/remove [find name~"webuiproxymikrotik-root"]} on-error={}`).catch(() => {});
  await sleep(2000);

  if (cfg.options.purgeDbOnFresh) {
    step('31-cleanup-webui', 'Remove stale SQLite on disk1/data...');
    await exec(conn, `:do {/file/remove [find name=disk1/data/proxy.db]} on-error={}`).catch(() => {});
    await exec(conn, `:do {/file/remove [find name=disk1/data/proxy.db-journal]} on-error={}`).catch(() => {});
  }
}

async function run(cfg) {
  if (!cfg.mode.cleanup || cfg.options.skipCleanup) {
    step('30-cleanup', 'Skipped (mode or options.skipCleanup)');
    return { ok: true, skipped: true };
  }

  const conn = await connect(cfg);
  try {
    await cleanupFleet(conn);
    await cleanupWebui(conn, cfg);
  } finally {
    conn.end();
  }
  return { ok: true };
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

module.exports = { run };