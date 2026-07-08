/**
 * Patch auto-proxy (WanWatcher + ProxyService) vào container đang chạy + cập nhật settings
 */
const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');
const http = require('http');

const HOST = process.env.MIKROTIK_HOST || '113.22.235.54';
const USER = process.env.MIKROTIK_SSH_USER || 'admin';
const PASS = process.env.MIKROTIK_SSH_PASS || 'toanthinh';
const WEBUI = process.env.WEBUI_URL || `http://${HOST}:8088`;
const DIST = path.join(__dirname, '../dist/services');
const FILES = [
  ['proxy/ProxyService.js', '/app/dist/services/proxy/ProxyService.js'],
  ['auto/WanWatcherService.js', '/app/dist/services/auto/WanWatcherService.js'],
];

function sshExec(conn, cmd, t = 120000) {
  return new Promise((res, rej) => {
    let o = '';
    const timer = setTimeout(() => rej(new Error('timeout')), t);
    conn.exec(cmd, (e, s) => {
      if (e) { clearTimeout(timer); return rej(e); }
      s.on('close', () => { clearTimeout(timer); res(o); });
      s.on('data', d => { o += d; process.stdout.write(d); });
      s.stderr.on('data', d => { o += d; });
    });
  });
}

function sftpPut(conn, local, remote) {
  return new Promise((res, rej) => {
    conn.sftp((err, sftp) => {
      if (err) return rej(err);
      const rs = fs.createReadStream(local);
      const ws = sftp.createWriteStream(remote);
      ws.on('close', res);
      ws.on('error', rej);
      rs.pipe(ws);
    });
  });
}

function httpJson(method, url, body, token) {
  return new Promise((res, rej) => {
    const u = new URL(url, WEBUI);
    const payload = body != null ? JSON.stringify(body) : null;
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (payload) headers['Content-Type'] = 'application/json';
    const req = http.request({
      hostname: u.hostname, port: u.port || 80, path: u.pathname, method, headers,
    }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        let j = d;
        try { j = JSON.parse(d); } catch {}
        res({ status: r.statusCode, data: j });
      });
    });
    req.on('error', rej);
    if (payload) req.write(payload);
    req.end();
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const conn = new Client();
  await new Promise((r, j) => { conn.on('ready', r); conn.on('error', j); conn.connect({ host: HOST, port: 22, username: USER, password: PASS }); });
  console.log('SSH OK — patch auto-proxy...\n');

  for (const [localRel, remoteApp] of FILES) {
    const local = path.join(DIST, localRel);
    const base = path.basename(localRel);
    const remoteDisk = `/disk1/data/patch-${base}`;
    const remoteInCtn = `/data/patch-${base}`;
    await sftpPut(conn, local, remoteDisk);
    await sshExec(conn, `/container/shell webuiproxymikrotik cmd="cp ${remoteInCtn} ${remoteApp}"`);
    console.log(`patched ${remoteApp}`);
  }

  console.log('\nRestart webuiproxymikrotik...');
  await sshExec(conn, '/container/stop [find name=webuiproxymikrotik]').catch(() => {});
  await sleep(10000);
  await sshExec(conn, '/container/start [find name=webuiproxymikrotik]').catch(() => {});
  await sleep(35000);
  conn.end();

  for (let i = 0; i < 15; i++) {
    try {
      const h = await httpJson('GET', '/api/health');
      if (h.status === 200 && h.data?.ok) break;
    } catch {}
    await sleep(3000);
  }

  const login = await httpJson('POST', '/api/auth/login', { username: 'admin', password: 'admin123' });
  if (login.status !== 200) throw new Error('login failed');
  const token = login.data.token;

  const settings = await httpJson('PATCH', '/api/settings/auto-proxy', {
    mode: 'full',
    staleTtlMs: 120000,
    goneDebouncePolls: 3,
  }, token);
  console.log('\nauto-proxy settings:', settings.data);

  const wan = await httpJson('GET', '/api/wan', null, token);
  const proxies = await httpJson('GET', '/api/proxies', null, token);
  console.log('WAN count:', Array.isArray(wan.data) ? wan.data.length : wan.data);
  console.log('Proxies:', Array.isArray(proxies.data) ? proxies.data.length : proxies.data);
  console.log('\nPATCH AUTO-PROXY OK');
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });