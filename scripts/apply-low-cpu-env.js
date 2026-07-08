#!/usr/bin/env node
/** Áp LOW_CPU_MODE + tắt LOGS_TAIL lên container WebUI đang chạy (giảm SSH spam). */
const { loadConfig } = require('../setup/lib/config');
const { connect, exec } = require('../setup/lib/ssh');
const { buildContainerEnv } = require('../setup/lib/env');
const { login } = require('../setup/lib/http');

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  const cfg = loadConfig();
  const env = buildContainerEnv(cfg);
  const conn = await connect(cfg);
  console.log('[low-cpu] Set env + restart webuiproxymikrotik...');
  const setOut = await exec(
    conn,
    `/container/set [find name=webuiproxymikrotik] logging=no env="${env.replace(/"/g, '\\"')}"`,
    60_000,
  );
  if (setOut.includes('failure:')) throw new Error(setOut.trim().slice(0, 200));

  await exec(conn, '/container/stop [find name=webuiproxymikrotik]').catch(() => {});
  await sleep(8000);
  await exec(conn, '/container/start [find name=webuiproxymikrotik]').catch(() => {});
  conn.end();

  for (let i = 0; i < 24; i++) {
    await sleep(5000);
    try {
      await login(cfg.webuiUrl, cfg.webui.adminUser, cfg.webui.adminPass);
      console.log(JSON.stringify({ ok: true, lowCpu: true, logsTail: false }));
      return;
    } catch {
      console.log(`[low-cpu] wait login ${i + 1}/24...`);
    }
  }
  throw new Error('WebUI login timeout after restart');
}

main().catch(e => { console.error(e.message); process.exit(1); });