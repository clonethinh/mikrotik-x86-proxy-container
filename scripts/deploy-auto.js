#!/usr/bin/env node
/**
 * Auto deploy webuiproxymikrotik — thử lần lượt:
 * 1) SSH :22222 (deploy.sh flow)
 * 2) WebUI /api/system/redeploy-webui (upload tar qua HTTP, SSH nội bộ container→router)
 * 3) MikroTik REST :80 (script + container recreate)
 */
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const { loadDeployConfig, buildContainerEnv } = require('./lib/deploy-config');
const cfg = loadDeployConfig();
const ROOT = cfg.root;
const TAR = cfg.tar;
const HOST = cfg.host;
const USER = cfg.user;
const PASS = cfg.pass;
const SSH_PORT = cfg.sshPort;
const WEBUI = process.env.WEBUI_URL || cfg.webui;
const ADMIN_PASS = cfg.adminPass;
const REST = cfg.rest;
const AUTH = cfg.auth;

function log(s, m) { console.log(`[${s}] ${m}`); }

async function rest(method, apiPath, body, timeoutMs = 120_000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${REST}${apiPath}`, {
      method,
      headers: { Authorization: `Basic ${AUTH}`, 'Content-Type': 'application/json' },
      body: body != null ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`REST ${method} ${apiPath} HTTP ${res.status}: ${text.slice(0, 240)}`);
    if (!text) return null;
    try { return JSON.parse(text); } catch { return text; }
  } finally { clearTimeout(t); }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function sshOk() {
  try {
    execSync(
      `sshpass -p ${PASS} ssh -p ${SSH_PORT} -o StrictHostKeyChecking=no -o ConnectTimeout=8 -o KexAlgorithms=+diffie-hellman-group1-sha1 -o HostKeyAlgorithms=+ssh-rsa admin@${HOST} "/system/identity/print"`,
      { stdio: 'pipe', timeout: 12_000 },
    );
    return true;
  } catch { return false; }
}

function ensureTar(force = false) {
  if (!force && fs.existsSync(TAR)) return;
  log('build', 'Building docker image...');
  execSync('docker buildx build --platform linux/amd64 -t webuiproxymikrotik:latest --load .', { cwd: ROOT, stdio: 'inherit' });
  execSync('bash -lc "docker save webuiproxymikrotik:latest > webuiproxymikrotik.tar"', { cwd: ROOT, stdio: 'inherit' });
}

async function loginWebui() {
  const res = await fetch(`${WEBUI}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: ADMIN_PASS }),
  });
  const j = await res.json();
  if (!j.token) throw new Error('WebUI login failed');
  return j.token;
}

async function deployViaWebuiApi(tarUrl) {
  const token = await loginWebui();
  const probe = await fetch(`${WEBUI}/api/system/redeploy-webui`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (probe.status === 404) throw new Error('redeploy-webui endpoint not on server yet');

  const preferUpload = process.env.DEPLOY_UPLOAD !== '0';
  if (tarUrl && !preferUpload) {
    log('webui', `Redeploy via tarUrl (internal download + SSH)...`);
    const res = await fetch(`${WEBUI}/api/system/redeploy-webui`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ tarUrl }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || `HTTP ${res.status}`);
    log('webui', JSON.stringify(out));
    return;
  }

  log('webui', `Uploading ${(fs.statSync(TAR).size / 1024 / 1024).toFixed(1)} MiB (direct HTTP)...`);
  const buf = fs.readFileSync(TAR);
  const res = await fetch(`${WEBUI}/api/system/redeploy-webui`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(buf.length),
    },
    body: buf,
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || `HTTP ${res.status}`);
  log('webui', JSON.stringify(out));
}

async function startTunnel() {
  const port = Number(process.env.TAR_SERVE_PORT) || (19876 + Math.floor(Math.random() * 1000));
  const server = http.createServer((req, res) => {
    if (!req.url?.includes('webuiproxymikrotik.tar')) { res.writeHead(404); res.end(); return; }
    const st = fs.statSync(TAR);
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': st.size });
    fs.createReadStream(TAR).pipe(res);
  });
  await new Promise((resolve, reject) => server.listen(port, '127.0.0.1', err => err ? reject(err) : resolve()));
  const cf = spawn('npx', ['-y', 'cloudflared', 'tunnel', '--url', `http://127.0.0.1:${port}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('cloudflared timeout')), 120_000);
    const onData = (b) => {
      const m = b.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m) { clearTimeout(timer); resolve(m[0]); }
    };
    cf.stdout.on('data', onData);
    cf.stderr.on('data', onData);
    cf.on('error', reject);
  });
  return { url: `${url}/webuiproxymikrotik.tar`, child: cf };
}

async function deployViaRestWithUrl(tarUrl) {
  log('rest', `Tunnel: ${tarUrl}`);

  async function ros(cmd) {
    try {
      await rest('POST', '/rest/execute', { script: cmd }, 25_000);
    } catch (e) {
      if (!String(e.message).includes('Session closed')) throw e;
    }
    await sleep(4000);
  }

  await ros(`/tool fetch url="${tarUrl}" dst-path=disk1/webuiproxymikrotik.tar mode=https check-certificate=no`);

  log('rest', 'Waiting for tar fetch (up to 20 min)...');
  const expect = fs.statSync(TAR).size;
  for (let i = 0; i < 240; i++) {
    await sleep(5000);
    const files = await rest('GET', '/rest/file?name=webuiproxymikrotik.tar').catch(() => []);
    const row = Array.isArray(files) ? files[0] : null;
    const size = row?.size ? parseInt(String(row.size), 10) : 0;
    if (i % 6 === 0) log('rest', `tar size ${size ? (size / 1024 / 1024).toFixed(1) + ' MiB' : '?'}`);
    if (size >= expect * 0.95) break;
    if (i === 239) throw new Error('tar fetch timeout');
  }

  const c = (await rest('GET', '/rest/container?name=webuiproxymikrotik'))?.[0];
  if (c?.['.id']) {
    await rest('POST', '/rest/container/stop', { '.id': c['.id'] }).catch(() => {});
    await sleep(10_000);
    await rest('POST', '/rest/container/remove', { '.id': c['.id'] }).catch(() => {});
    await sleep(5000);
  }

  const mounts = await rest('GET', '/rest/container/mounts');
  if (!Array.isArray(mounts) || !mounts.some(m => m.list === 'MOUNT_DATA')) {
    await rest('POST', '/rest/container/mounts', { list: 'MOUNT_DATA', src: 'disk1/data', dst: '/data' });
  }

  const ENV = buildContainerEnv(cfg);

  await rest('POST', '/rest/container/add', {
    file: 'disk1/webuiproxymikrotik.tar',
    interface: 'veth-webui',
    'root-dir': `disk1/webuiproxymikrotik-r${Date.now()}`,
    name: 'webuiproxymikrotik',
    mountlists: 'MOUNT_DATA',
    logging: 'no',
    'start-on-boot': 'yes',
    env: ENV,
  }, 180_000);

  for (let i = 0; i < 40; i++) {
    await sleep(5000);
    const row = (await rest('GET', '/rest/container?name=webuiproxymikrotik'))?.[0];
    const running = String(row?.running || '').toLowerCase() === 'true';
    const st = String(row?.status || (running ? 'running' : 'extracting')).toUpperCase();
    log('rest', `status=${st}`);
    if (running || st.includes('RUNNING') || st.includes('HEALTHY')) break;
    try {
      const hres = await fetch(`${WEBUI}/api/health`);
      if (hres.ok) { log('rest', 'WebUI health OK'); break; }
    } catch { /* still booting */ }
  }

  const row = (await rest('GET', '/rest/container?name=webuiproxymikrotik'))?.[0];
  if (row?.['.id']) await rest('POST', '/rest/container/start', { '.id': row['.id'] }).catch(() => {});
}

async function verify() {
  await sleep(25_000);
  const token = await loginWebui();
  const dash = await fetch(`${WEBUI}/api/dashboard`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json());
  log('verify', JSON.stringify({ live: dash.live, source: dash.source, wanTraffic: !!dash.wanTraffic, dhcp: (dash.dhcpLeases || []).length }));
  if (!dash.live || !dash.wanTraffic) throw new Error('dashboard realtime fields missing after deploy');
}

async function postDeployBootstrap() {
  if (process.env.SKIP_POST_DEPLOY === '1') {
    log('post-deploy', 'SKIP_POST_DEPLOY=1');
    return;
  }
  log('post-deploy', 'Sync mikrotik/*.rsc + router-scripts ensure...');
  execSync('node scripts/post-deploy-bootstrap.js', { cwd: ROOT, stdio: 'inherit' });
}

async function main() {
  ensureTar(process.env.FORCE_BUILD === '1');
  if (sshOk()) {
    log('ssh', `OK — running deploy.sh on port ${SSH_PORT}`);
    execSync(`SSH_PORT=${SSH_PORT} MIK_PASS=${PASS} ./scripts/deploy.sh`, { cwd: ROOT, stdio: 'inherit' });
    await verify();
    await postDeployBootstrap();
    return;
  }
  log('ssh', `Port ${SSH_PORT} unreachable — trying WebUI internal redeploy API`);
  const skipTunnel = process.env.DEPLOY_UPLOAD !== '0';
  const { url: tunnelUrl, child: tunnelChild } = skipTunnel
    ? { url: null, child: null }
    : await startTunnel().catch(() => ({ url: null, child: null }));
  try {
    await deployViaWebuiApi(tunnelUrl || undefined);
    await verify();
    await postDeployBootstrap();
    return;
  } catch (e) {
    log('webui', `Skip: ${e.message}`);
  }
  if (!tunnelUrl) throw new Error('tunnel failed');
  log('rest', 'Trying MikroTik REST :80 deploy...');
  await deployViaRestWithUrl(tunnelUrl);
  if (tunnelChild) try { tunnelChild.kill(); } catch { /* ignore */ }
  await verify();
  await postDeployBootstrap();
  console.log('\n=== DEPLOY AUTO OK ===');
}

main().catch((e) => { console.error('\nDEPLOY AUTO FAILED:', e.message); process.exit(1); });