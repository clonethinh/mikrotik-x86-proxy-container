#!/usr/bin/env node
/**
 * Khôi phục WebUI khi container bị xóa:
 * 1) deploy-via-rest — fetch tar + tạo container (REST :80)
 * 2) bootstrap redeploy API nếu chưa có
 * 3) upload tar đầy đủ qua HTTP :8088
 */
const { spawn } = require('child_process');
const path = require('path');
const { loadDeployConfig } = require('./lib/deploy-config');

const cfg = loadDeployConfig();
const ROOT = cfg.root;

function log(s, m) { console.log(`[${s}] ${m}`); }

function runNode(script, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [path.join(ROOT, 'scripts', script)], {
      cwd: ROOT,
      stdio: 'inherit',
      env: { ...process.env, ...extraEnv },
    });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${script} exit ${code}`))));
  });
}

async function waitHealth(maxSec = 180) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxSec * 1000) {
    try {
      const res = await fetch(`${cfg.webui}/api/health`);
      if (res.ok) {
        const h = await res.json();
        log('health', `OK uptime=${h.uptime?.toFixed?.(0) ?? h.uptime}s`);
        return;
      }
    } catch { /* retry */ }
    await new Promise(r => setTimeout(r, 5000));
  }
  throw new Error('WebUI health timeout');
}

async function needsBootstrap() {
  try {
    const login = await fetch(`${cfg.webui}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: cfg.adminPass }),
    }).then(r => r.json());
    if (!login.token) return true;
    const probe = await fetch(`${cfg.webui}/api/system/redeploy-webui`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${login.token}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    return probe.status === 404;
  } catch {
    return true;
  }
}

async function main() {
  log('restore', 'Step 1/3: fetch tar + create container (deploy-via-rest)...');
  await runNode('deploy-via-rest.js');

  log('restore', 'Step 2/3: wait WebUI...');
  await waitHealth(120);

  if (await needsBootstrap()) {
    log('restore', 'Bootstrap redeploy API...');
    await runNode('bootstrap-redeploy-via-rest.js', {
      FORCE_BOOTSTRAP: '1',
      PATCH_FILES: 'server.js,routes/system.js,services/system/RedeployWebuiService.js,services/mikrotik/MikrotikService.js',
    });
    await waitHealth(90);
  } else {
    log('restore', 'redeploy API already present — skip bootstrap');
  }

  log('restore', 'Step 3/3: upload tar via HTTP :8088...');
  await runNode('deploy-auto.js', { DEPLOY_UPLOAD: '1' });

  log('restore', '=== RESTORE COMPLETE ===');
  log('restore', cfg.webui);
}

main().catch((e) => { console.error('\nRESTORE FAILED:', e.message); process.exit(1); });