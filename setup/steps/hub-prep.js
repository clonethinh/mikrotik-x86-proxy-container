/**
 * Chuẩn bị hub proxy trên router sau khi WebUI đã chạy.
 * - Upload/verify 3proxy-hub.tar
 * - Đăng ký MOUNT_HUB_CFG per shard (cfg + slot-ips)
 * - Dọn legacy proxy3p-N nếu còn sót
 */
const { connect, exec } = require('../lib/ssh');
const { step } = require('../lib/logger');

function shardMountSpec(shardId) {
  if (shardId === 0) {
    return {
      mountList: 'MOUNT_HUB_CFG',
      cfg: 'disk1/hub-3proxy.cfg',
      ips: 'disk1/hub-slot-ips',
      container: 'proxy3p-hub',
    };
  }
  const n = shardId + 1;
  return {
    mountList: `MOUNT_HUB_CFG_${n}`,
    cfg: `disk1/hub-3proxy-${n}.cfg`,
    ips: `disk1/hub-slot-ips-${n}`,
    container: `proxy3p-hub-${n}`,
  };
}

async function run(cfg) {
  if (cfg.proxy.deployMode !== 'hub') {
    step('45-hub-prep', 'Skipped (proxy.deployMode !== hub)');
    return { ok: true, skipped: true };
  }

  const conn = await connect(cfg);
  try {
    const hubTar = await exec(conn, `/file/print where name=${cfg.threeProxy.hubTarball}`);
    if (!hubTar.includes('3proxy-hub')) {
      throw new Error(`${cfg.threeProxy.hubTarball} missing — bật upload3proxyHubTar hoặc chạy npm run build:3proxy-hub`);
    }
    step('45-hub-prep', `${cfg.threeProxy.hubTarball} OK`);

    const shards = parseInt(process.env.HUB_SHARD_COUNT || String(cfg.hub?.shardCount || 2), 10);
    step('45-hub-prep', `Ensure ${shards} hub shard mount lists...`);
    for (let sid = 0; sid < shards; sid++) {
      const s = shardMountSpec(sid);
      await exec(conn, `:do {/container/mounts/remove [find list=${s.mountList}]} on-error={}`);
      await exec(conn, `:do {/file/add name=${s.cfg} contents="# hub placeholder shard${sid + 1}"} on-error={}`).catch(() => {});
      await exec(conn, `:do {/file/add name=${s.ips} contents=""} on-error={}`).catch(() => {});
      await exec(conn, `/container/mounts/add list=${s.mountList} src=${s.cfg} dst=/etc/3proxy/3proxy.cfg`);
      await exec(conn, `/container/mounts/add list=${s.mountList} src=${s.ips} dst=/etc/3proxy/hub-slot-ips`);
      step('45-hub-prep', `Shard ${sid + 1}: ${s.mountList} OK`);
    }

    step('45-hub-prep', 'Remove legacy per-slot containers (proxy3p-1..N)...');
    await exec(conn, '/container/stop [find where name~"^proxy3p-[0-9]"]').catch(() => {});
    await exec(conn, ':delay 3');
    await exec(conn, '/container/remove [find where name~"^proxy3p-[0-9]"]').catch(() => {});

    const hub = await exec(conn, '/container/print where name~"proxy3p-hub"');
    if (hub.includes('proxy3p-hub')) {
      step('45-hub-prep', 'proxy3p-hub* exists — giữ nguyên (re-apply proxy từ WebUI nếu cần)');
    } else {
      step('45-hub-prep', 'Hub chưa tạo — tạo PPPoE + proxy từ WebUI sau khi out UP');
    }

    step('45-hub-prep', `Mode: hub sharded (${shards}×${cfg.hub?.shardSize || 50}) | image: ${cfg.threeProxy.hubImage}`);
    return { ok: true, shards };
  } finally {
    conn.end();
  }
}

module.exports = { run };