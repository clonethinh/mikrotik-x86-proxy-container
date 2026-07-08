/**
 * Patch dist JS vào container đang chạy + restart + retry provision pppoe-out2
 */
const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');
const http = require('http');

const HOST = '113.22.235.54';
const USER = 'admin';
const PASS = 'toanthinh';
const WEBUI = `http://${HOST}:8088`;
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
  console.log('SSH OK — uploading patches...\n');

  for (const [localRel, remoteApp] of FILES) {
    const local = path.join(DIST, localRel);
    const base = path.basename(localRel);
    const remoteDisk = `/disk1/data/patch-${base}`;
    const remoteInCtn = `/data/patch-${base}`;
    await sftpPut(conn, local, remoteDisk);
    await sshExec(conn, `/container/shell webuiproxymikrotik cmd="cp ${remoteInCtn} ${remoteApp}"`);
    console.log(`patched ${remoteApp}`);
  }

  console.log('\nRestarting webuiproxymikrotik...');
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

  console.log('\nTrigger provision pppoe-out2...');
  const prov = await httpJson('POST', '/api/wan/2/provision/now', {}, token);
  console.log('provision/now:', prov.status, prov.data);

  console.log('\nWaiting 90s for container extract...');
  await sleep(90000);

  const wan = await httpJson('GET', '/api/wan', null, token);
  const pppoe2 = Array.isArray(wan.data) ? wan.data.find(w => w.index === 2) : null;
  console.log('\npppoe-out2:', pppoe2 ? {
    running: pppoe2.running,
    ip: pppoe2.publicIp,
    hasContainer: pppoe2.hasContainer,
    containerStatus: pppoe2.containerStatus,
    workflowState: pppoe2.workflowState,
    hasProxy: pppoe2.hasProxy,
  } : 'not in wan list');

  const proxies = await httpJson('GET', '/api/proxies', null, token);
  if (Array.isArray(proxies.data)) {
    proxies.data.filter(p => p.pppoeIdx === 2).forEach(p =>
      console.log(`proxy id=${p.id} status=${p.status} msg=${p.statusMessage}`));
  }
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });