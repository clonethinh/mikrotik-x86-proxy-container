#!/usr/bin/env node
/**
 * Sau deploy WebUI — giữ router scripts + .rsc đồng bộ (setup 1 lần, deploy mãi mãi).
 * Không đụng proxy.db / firewall hub đã có.
 */
const fs = require('fs');
const path = require('path');
const { connect, exec, sftpPut } = require('../setup/lib/ssh');
const { loadDeployConfig } = require('./lib/deploy-config');

const ROOT = path.join(__dirname, '..');

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function uploadMikrotikRsc(conn) {
  const remoteBase = 'disk1/webuiproxymikrotik';
  await exec(conn, `:do {/file/add name=${remoteBase} type=directory} on-error={}`).catch(() => {});
  const localDir = path.join(ROOT, 'mikrotik');
  const files = fs.readdirSync(localDir).filter(f => f.endsWith('.rsc'));
  for (const f of files) {
    await sftpPut(conn, path.join(localDir, f), `/${remoteBase}/${f}`);
    console.log(`[post-deploy] uploaded ${f}`);
  }
  return files.length;
}

async function ensureViaApi(webui, adminPass) {
  const loginRes = await fetch(`${webui}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: adminPass }),
  });
  const { token } = await loginRes.json();
  if (!token) throw new Error('WebUI login failed');

  for (let i = 0; i < 24; i++) {
    try {
      const h = await fetch(`${webui}/api/health`);
      if (h.ok) break;
    } catch { /* wait boot */ }
    await sleep(5000);
  }

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const rs = await fetch(`${webui}/api/system/router-scripts/ensure`, { method: 'POST', headers, body: '{}' });
  const body = await rs.json().catch(() => ({}));
  if (!rs.ok) throw new Error(`router-scripts/ensure: ${rs.status} ${JSON.stringify(body).slice(0, 120)}`);
  console.log('[post-deploy] router-scripts:', body.summary || 'OK');

  const clk = await fetch(`${webui}/api/mikrotik/sync-time`, { method: 'POST', headers, body: '{}' }).catch(() => null);
  if (clk?.ok) console.log('[post-deploy] sync-time OK');
}

async function main() {
  const cfg = loadDeployConfig();
  const conn = await connect({
    router: {
      host: cfg.host,
      sshUser: cfg.user,
      sshPass: cfg.pass,
      sshPort: parseInt(cfg.sshPort, 10),
    },
  });
  try {
    const n = await uploadMikrotikRsc(conn);
    console.log(`[post-deploy] ${n} .rsc on disk1/webuiproxymikrotik`);
  } finally {
    conn.end();
  }
  await ensureViaApi(cfg.webui, cfg.adminPass);
  console.log('[post-deploy] DONE — router scripts + rsc synced');
}

main().catch(e => {
  console.error('[post-deploy] FAILED:', e.message);
  process.exit(1);
});