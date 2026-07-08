const fs = require('fs');
const path = require('path');
const { connect, exec, sftpPut } = require('../lib/ssh');
const { request, login } = require('../lib/http');
const { step, warn } = require('../lib/logger');

async function purgeViaApi(cfg) {
  const token = await login(cfg.webuiUrl, cfg.webui.adminUser, cfg.webui.adminPass);
  let res = await request('POST', `${cfg.webuiUrl}/api/system/purge-fleet`, {}, token);
  if (res.status === 200) {
    step('60-purge-db', `purge-fleet API: ${JSON.stringify(res.data)}`);
    return res.data;
  }
  if (res.status === 404) {
    warn('purge-fleet not deployed — trying purge-wan-state + proxy deletes');
    const list = await request('GET', `${cfg.webuiUrl}/api/proxies`, null, token);
    if (list.status === 200 && Array.isArray(list.data)) {
      for (const p of list.data.filter(x => x.pppoeIdx >= 2)) {
        await request('DELETE', `${cfg.webuiUrl}/api/proxies/${p.id}`, null, token);
      }
    }
    res = await request('POST', `${cfg.webuiUrl}/api/system/purge-wan-state`, {}, token);
    if (res.status === 200) {
      step('60-purge-db', `purge-wan-state API: ${JSON.stringify(res.data)}`);
      return res.data;
    }
  }
  return null;
}

async function purgeViaContainer(cfg) {
  const scriptLocal = path.join(cfg.root, 'backend/scripts/purge-db-once.js');
  if (!fs.existsSync(scriptLocal)) throw new Error('purge-db-once.js missing');

  const conn = await connect(cfg);
  try {
    await sftpPut(conn, scriptLocal, '/disk1/data/purge-once.js');
    const out = await exec(conn, '/container/shell webuiproxymikrotik cmd="cd /app && node /data/purge-once.js"');
    await exec(conn, ':do {/file/remove [find name=disk1/data/purge-once.js]} on-error={}').catch(() => {});
    step('60-purge-db', `container purge: ${out.trim().slice(0, 300)}`);
    return out;
  } finally {
    conn.end();
  }
}

async function run(cfg) {
  if (!cfg.options.purgeDbOnFresh) {
    step('60-purge-db', 'Skipped (options.purgeDbOnFresh=false)');
    return { ok: true, skipped: true };
  }

  let apiResult = null;
  try {
    apiResult = await purgeViaApi(cfg);
  } catch (e) {
    warn(`API purge failed: ${e.message} — fallback container shell`);
  }

  if (!apiResult) {
    await purgeViaContainer(cfg);
  }

  return { ok: true };
}

module.exports = { run };