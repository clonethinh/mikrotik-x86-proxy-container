#!/usr/bin/env node
/**
 * Bootstrap /api/system/redeploy-webui trên production (chưa có endpoint).
 * Patch dist qua MikroTik REST :80 + container/shell base64 chunks — không cần SSH WAN.
 */
const fs = require('fs');
const path = require('path');
const { loadDeployConfig } = require('./lib/deploy-config');

const cfg = loadDeployConfig();
const DIST = path.join(cfg.root, 'backend', 'dist');
const DEFAULT_PATCH = 'server.js,routes/system.js,services/system/RedeployWebuiService.js,services/mikrotik/MikrotikService.js';
const PATCH_FILES = (process.env.PATCH_FILES || DEFAULT_PATCH)
  .split(',')
  .filter(Boolean)
  .map((rel) => [rel.trim(), `/app/dist/${rel.trim()}`]);
const CHUNK = 2800;

function log(s, m) { console.log(`[${s}] ${m}`); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function rest(method, apiPath, body, timeoutMs = 120_000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${cfg.rest}${apiPath}`, {
      method,
      headers: { Authorization: `Basic ${cfg.auth}`, 'Content-Type': 'application/json' },
      body: body != null ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`REST ${method} ${apiPath} HTTP ${res.status}: ${text.slice(0, 240)}`);
    if (!text) return null;
    try { return JSON.parse(text); } catch { return text; }
  } finally { clearTimeout(t); }
}

async function ros(script, timeoutMs = 30_000) {
  try {
    await rest('POST', '/rest/execute', { script }, timeoutMs);
  } catch (e) {
    if (!String(e.message).includes('Session closed')) throw e;
  }
  await sleep(2500);
}

async function shellSh(cmd) {
  const esc = cmd.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  await ros(`/container/shell webuiproxymikrotik cmd="/bin/sh -c \\"${esc}\\""`);
}

async function patchFileViaB64(rel, remote) {
  const local = path.join(DIST, rel);
  const b64 = fs.readFileSync(local).toString('base64');
  const tmp = `/tmp/patch-${path.basename(rel)}.b64`;
  const out = `/tmp/patch-${path.basename(rel)}`;
  log('patch', `${rel} (${fs.statSync(local).size} bytes, ${Math.ceil(b64.length / CHUNK)} chunks)`);
  await shellSh(`rm -f ${tmp} ${out}`);
  for (let i = 0; i < b64.length; i += CHUNK) {
    const part = b64.slice(i, i + CHUNK).replace(/'/g, "'\\''");
    await shellSh(`printf '%s' '${part}' >> ${tmp}`);
    if ((i / CHUNK) % 5 === 0) process.stdout.write('.');
  }
  console.log('');
  await shellSh(`base64 -d ${tmp} > ${out} && cp ${out} ${remote} && wc -c ${remote}`);
}

async function login() {
  const res = await fetch(`${cfg.webui}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: cfg.adminPass }),
  });
  const j = await res.json();
  if (!j.token) throw new Error('login failed');
  return j.token;
}

async function main() {
  for (const [rel] of PATCH_FILES) {
    if (!fs.existsSync(path.join(DIST, rel))) throw new Error(`Missing dist/${rel} — cd backend && npm run build`);
  }

  const token = await login();
  const probe = await fetch(`${cfg.webui}/api/system/redeploy-webui`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (probe.status !== 404 && process.env.FORCE_BOOTSTRAP !== '1') {
    log('skip', `redeploy-webui already exists (HTTP ${probe.status})`);
    return;
  }

  log('bootstrap', 'Patching via REST container/shell (base64 chunks)...');
  for (const [rel, remote] of PATCH_FILES) await patchFileViaB64(rel, remote);

  log('restart', 'Restart webuiproxymikrotik...');
  const c = (await rest('GET', '/rest/container?name=webuiproxymikrotik'))?.[0];
  if (c?.['.id']) {
    await rest('POST', '/rest/container/stop', { '.id': c['.id'] }).catch(() => {});
    await sleep(8000);
    await rest('POST', '/rest/container/start', { '.id': c['.id'] }).catch(() => {});
  }
  await sleep(28_000);

  const token2 = await login();
  const check = await fetch(`${cfg.webui}/api/system/redeploy-webui`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token2}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  const body = await check.text();
  if (check.status === 404) throw new Error('redeploy endpoint still 404 after patch');
  log('bootstrap', `redeploy-webui ready HTTP ${check.status}: ${body.slice(0, 120)}`);
}

main().catch((e) => { console.error('BOOTSTRAP FAILED:', e.message); process.exit(1); });