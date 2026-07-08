#!/usr/bin/env node
/**
 * Deploy webuiproxymikrotik từ internet — không cần SSH WAN.
 * Dùng MikroTik REST :80 + /tool fetch (qua /rest/execute) + cloudflared tunnel.
 *
 * Usage:
 *   npm run deploy:wan
 *   MIK_PASS=toanthinh node scripts/deploy-via-rest.js
 *   TAR_URL=https://... node scripts/deploy-via-rest.js   # bỏ qua cloudflared
 */
const http = require('http');
const fs = require('fs');
const { spawn } = require('child_process');
const { loadDeployConfig, buildContainerEnv } = require('./lib/deploy-config');

const cfg = loadDeployConfig();
const ENV_STR = buildContainerEnv(cfg);

function log(step, msg) { console.log(`[${step}] ${msg}`); }

async function rest(method, apiPath, body, timeoutMs = 120_000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${cfg.rest}${apiPath}`, {
      method,
      headers: {
        Authorization: `Basic ${cfg.auth}`,
        'Content-Type': 'application/json',
      },
      body: body != null ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`REST ${method} ${apiPath} HTTP ${res.status}: ${text.slice(0, 300)}`);
    if (!text) return null;
    try { return JSON.parse(text); } catch { return text; }
  } finally {
    clearTimeout(t);
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/** Router DNS hay lỗi với *.trycloudflare.com — fetch qua IPv4 + Host header. */
async function buildFetchScript(tarUrl) {
  const dns = require('dns').promises;
  const u = new URL(tarUrl);
  let ipv4 = '';
  try {
    const rows = await dns.resolve4(u.hostname);
    ipv4 = rows?.[0] || '';
  } catch {
    try {
      const g = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(u.hostname)}&type=A`);
      const data = await g.json();
      ipv4 = data.Answer?.find((a) => a.type === 1)?.data || '';
    } catch { /* fallback hostname */ }
  }

  const path = `${u.pathname}${u.search}`;
  if (ipv4) {
    log('fetch', `DNS bypass: ${u.hostname} -> ${ipv4} (Host header)`);
    return `/tool fetch url="https://${ipv4}${path}" http-header-field="Host: ${u.host}" dst-path=disk1/webuiproxymikrotik.tar mode=https check-certificate=no`;
  }
  return `/tool fetch url="${tarUrl}" dst-path=disk1/webuiproxymikrotik.tar mode=https check-certificate=no`;
}

async function rosExec(script, timeoutMs = 25_000) {
  try {
    await rest('POST', '/rest/execute', { script }, timeoutMs);
  } catch (e) {
    if (!String(e.message).includes('Session closed')) throw e;
  }
  await sleep(4000);
}

async function startTunnel() {
  if (process.env.TAR_URL) {
    log('tunnel', `Using TAR_URL=${process.env.TAR_URL}`);
    return process.env.TAR_URL;
  }

  if (!fs.existsSync(cfg.tar)) throw new Error(`Missing ${cfg.tar} — run docker build first`);

  const port = Number(process.env.TAR_SERVE_PORT) || (19876 + Math.floor(Math.random() * 1000));
  const server = http.createServer((req, res) => {
    if (!req.url?.includes('webuiproxymikrotik.tar')) {
      res.writeHead(404); res.end('not found'); return;
    }
    const stat = fs.statSync(cfg.tar);
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': stat.size,
    });
    fs.createReadStream(cfg.tar).pipe(res);
  });
  await new Promise((resolve, reject) => server.listen(port, '0.0.0.0', err => err ? reject(err) : resolve()));
  log('tunnel', `HTTP server :${port} serving tar (${(fs.statSync(cfg.tar).size / 1024 / 1024).toFixed(1)} MiB)`);

  const cf = spawn('npx', ['-y', 'cloudflared', 'tunnel', '--url', `http://127.0.0.1:${port}`], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let url = '';
  const urlPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('cloudflared timeout')), 120_000);
    const onData = (buf) => {
      const s = buf.toString();
      const m = s.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m) {
        clearTimeout(timer);
        url = m[0];
        resolve(url);
      }
    };
    cf.stdout.on('data', onData);
    cf.stderr.on('data', onData);
    cf.on('error', reject);
    cf.on('exit', (code) => { if (!url) reject(new Error(`cloudflared exit ${code}`)); });
  });
  const tunnelUrl = await urlPromise;
  log('tunnel', `Public URL: ${tunnelUrl}`);
  return `${tunnelUrl}/webuiproxymikrotik.tar`;
}

async function getTarSizeOnRouter() {
  const files = await rest('GET', '/rest/file').catch(() => []);
  if (!Array.isArray(files)) return 0;
  const row = files.find((f) => {
    const n = String(f.name || '');
    return n === 'disk1/webuiproxymikrotik.tar' || n.endsWith('/webuiproxymikrotik.tar');
  });
  return row?.size ? parseInt(String(row.size), 10) : 0;
}

async function waitTarOnRouter(expectedBytes) {
  for (let i = 0; i < 240; i++) {
    await sleep(5000);
    const size = await getTarSizeOnRouter();
    if (i % 6 === 0) {
      log('fetch', `t+${(i + 1) * 5}s size=${size ? (size / 1024 / 1024).toFixed(1) + ' MiB' : '?'}`);
    }
    if (size >= expectedBytes * 0.95) return size;
  }
  throw new Error('fetch tar timeout');
}

async function getWebuiContainer() {
  const rows = await rest('GET', '/rest/container?name=webuiproxymikrotik');
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function main() {
  log('target', `${cfg.host} (REST :80, WebUI ${cfg.webui}) — SSH WAN :${cfg.sshPort} không cần`);

  if (!fs.existsSync(cfg.tar) && !process.env.TAR_URL) {
    log('build', 'Building image...');
    const { execSync } = require('child_process');
    execSync('docker buildx build --platform linux/amd64 -t webuiproxymikrotik:latest --load .', { cwd: cfg.root, stdio: 'inherit' });
    execSync('docker save webuiproxymikrotik:latest > webuiproxymikrotik.tar', { cwd: cfg.root, shell: '/bin/bash', stdio: 'inherit' });
  }

  const tarSize = fs.existsSync(cfg.tar) ? fs.statSync(cfg.tar).size : 0;
  const existingSize = await getTarSizeOnRouter();

  if (tarSize > 0 && existingSize >= tarSize * 0.95) {
    log('fetch', `Tar đã có trên router (${(existingSize / 1024 / 1024).toFixed(1)} MiB) — bỏ qua download`);
  } else {
    const tarUrl = process.env.TAR_URL || await startTunnel();
    log('fetch', 'Router download tar via /tool fetch...');
    await rosExec(await buildFetchScript(tarUrl));
    if (tarSize > 0) await waitTarOnRouter(tarSize);
  }

  const existing = await getWebuiContainer();
  if (existing?.['.id']) {
    log('container', `Stop ${existing['.id']}`);
    await rest('POST', '/rest/container/stop', { '.id': existing['.id'] }).catch(() => {});
    await sleep(8000);
    log('container', `Remove ${existing['.id']}`);
    await rest('POST', '/rest/container/remove', { '.id': existing['.id'] }).catch(() => {});
    await sleep(5000);
  }

  const mounts = await rest('GET', '/rest/container/mounts');
  const hasMount = Array.isArray(mounts) && mounts.some(m => m.list === 'MOUNT_DATA');
  if (!hasMount) {
    log('mount', 'Create MOUNT_DATA');
    await rest('POST', '/rest/container/mounts', { list: 'MOUNT_DATA', src: 'disk1/data', dst: '/data' });
  }

  const rootDir = `disk1/webuiproxymikrotik-r${Date.now()}`;
  log('container', `Add container root-dir=${rootDir}`);
  await rest('POST', '/rest/container/add', {
    file: 'disk1/webuiproxymikrotik.tar',
    interface: 'veth-webui',
    'root-dir': rootDir,
    name: 'webuiproxymikrotik',
    mountlists: 'MOUNT_DATA',
    logging: 'no',
    'start-on-boot': 'yes',
    env: ENV_STR,
  }, 180_000);

  let cid = null;
  for (let i = 0; i < 48; i++) {
    await sleep(5000);
    const c = await getWebuiContainer();
    cid = c?.['.id'] || null;
    const running = String(c?.running || '').toLowerCase() === 'true';
    const st = String(c?.status || (running ? 'running' : 'extracting')).toUpperCase();
    log('wait', `t+${(i + 1) * 5}s status=${st}`);
    if (running || st.includes('RUNNING') || st.includes('HEALTHY')) break;
    if (st.includes('FAILED')) throw new Error('container extract FAILED');
    try {
      const hres = await fetch(`${cfg.webui}/api/health`);
      if (hres.ok) { log('wait', 'WebUI health OK — extract done'); break; }
    } catch { /* still booting */ }
  }

  if (cid) {
    await rest('POST', '/rest/container/start', { '.id': cid }).catch(() => {});
  }

  log('verify', 'Wait WebUI boot 30s...');
  await sleep(30_000);

  for (let i = 0; i < 12; i++) {
    try {
      const res = await fetch(`${cfg.webui}/api/health`);
      if (res.ok) {
        const h = await res.json();
        log('verify', `health OK uptime=${h.uptime?.toFixed?.(0) ?? h.uptime}s`);
        break;
      }
    } catch { /* retry */ }
    await sleep(5000);
  }

  const loginRes = await fetch(`${cfg.webui}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: cfg.adminPass }),
  });
  const login = await loginRes.json();
  if (!login.token) throw new Error('WebUI login failed after deploy');
  const dashRes = await fetch(`${cfg.webui}/api/dashboard`, {
    headers: { Authorization: `Bearer ${login.token}` },
  });
  const dash = await dashRes.json();
  log('verify', JSON.stringify({
    live: dash.live,
    source: dash.source,
    hasWanTraffic: !!dash.wanTraffic,
    dhcpLeases: (dash.dhcpLeases || []).length,
  }));
  console.log('\n=== DEPLOY VIA REST OK ===');
  console.log(`WebUI: ${cfg.webui}`);
  console.log('Lần sau có thể dùng: npm run deploy:auto (upload qua WebUI :8088, không cần SSH WAN)');
}

main().catch((e) => {
  console.error('\nDEPLOY FAILED:', e.message);
  process.exit(1);
});