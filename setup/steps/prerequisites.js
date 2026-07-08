const { connect, exec } = require('../lib/ssh');
const { step, warn } = require('../lib/logger');

async function run(cfg) {
  const conn = await connect(cfg);
  try {
    step('35-prerequisites', 'Chuẩn bị router mới (disk1, bridge, NTP VN)...');
    const out = await exec(conn, '/import file=disk1/webuiproxymikrotik/prerequisites.rsc', 60_000);
    const tail = out.split('\n').filter(Boolean).slice(-12).join('\n');
    if (tail) step('35-prerequisites', tail);

    const pkg = await exec(conn, '/system/package/print where name=container');
    if (!pkg.includes('container')) {
      throw new Error('Router chưa cài package container — System → Packages → container');
    }

    const pppoe = await exec(conn, `/interface/pppoe-client/print where name=${cfg.wan.managementPppoe}`);
    if (!pppoe.includes(cfg.wan.managementPppoe)) {
      warn(`${cfg.wan.managementPppoe} chưa có — tạo WAN quản lý trước khi provision proxy`);
    }

    const data = await exec(conn, '/file/print where name=disk1/data');
    if (!data.includes('disk1/data')) {
      await exec(conn, ':do {/file/add name=disk1/data type=directory} on-error={}');
      step('35-prerequisites', 'Đã tạo disk1/data');
    }

    return { ok: true };
  } finally {
    conn.end();
  }
}

module.exports = { run };