/**
 * Re-apply NAT/routing/firewall (SSH) cho proxy đã có container
 */
const http = require('http');
const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

const HOST = '113.22.235.54';
const WEBUI = `http://${HOST}:8088`;
const DIST = path.join(__dirname, '../dist');

function api(method, url, body, token) {
  return new Promise((res, rej) => {
    const u = new URL(url, WEBUI);
    const payload = body != null ? JSON.stringify(body) : null;
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (payload) headers['Content-Type'] = 'application/json';
    const req = http.request({ hostname: u.hostname, port: 80, path: u.pathname, method, headers }, r => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => {
        try { res({ status: r.statusCode, data: JSON.parse(d) }); } catch { res({ status: r.statusCode, data: d }); }
      });
    });
    req.on('error', rej);
    if (payload) req.write(payload);
    req.end();
  });
}

function sshExec(conn, cmd) {
  return new Promise((res, rej) => {
    let o = '';
    conn.exec(cmd, (e, s) => {
      if (e) return rej(e);
      s.on('close', () => res(o));
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

const PATCH_FILES = [
  ['services/proxy/ProxyService.js', '/app/dist/services/proxy/ProxyService.js'],
  ['routes/proxies.js', '/app/dist/routes/proxies.js'],
  ['server.js', '/app/dist/server.js'],
];

async function patchContainer(conn) {
  for (const [rel, dest] of PATCH_FILES) {
    const local = path.join(DIST, rel);
    const base = path.basename(local);
    await sftpPut(conn, local, `/disk1/data/patch-${base}`);
    await sshExec(conn, `/container/shell webuiproxymikrotik cmd="cp /data/patch-${base} ${dest}"`);
    console.log('patched', dest);
  }
  await sshExec(conn, '/container/stop [find name=webuiproxymikrotik]').catch(() => {});
  await new Promise(r => setTimeout(r, 10000));
  await sshExec(conn, '/container/start [find name=webuiproxymikrotik]');
  await new Promise(r => setTimeout(r, 35000));
}

async function main() {
  console.log('=== Build assumed done — patch + restart webui ===');
  const conn = new Client();
  await new Promise((r, j) => { conn.on('ready', r); conn.on('error', j); conn.connect({ host: HOST, port: 22, username: 'admin', password: 'toanthinh' }); });
  await patchContainer(conn);
  conn.end();

  const login = await api('POST', '/api/auth/login', { username: 'admin', password: 'admin123' });
  const token = login.data.token;

  for (const id of [2, 3]) {
    console.log(`\n=== Re-apply proxy id=${id} ===`);
    const r = await api('POST', `/api/proxies/${id}/reapply`, {}, token);
    console.log('reapply:', r.status, typeof r.data === 'object' ? r.data?.status || r.data?.error : r.data);
  }

  await new Promise(r => setTimeout(r, 5000));

  const proxies = await api('GET', '/api/proxies', null, token);
  for (const p of proxies.data || []) {
    console.log(`  id=${p.id} ${p.pppoeName} status=${p.status} ip=${p.publicIp} msg=${(p.statusMessage || '').slice(0, 80)}`);
  }

  const c2 = new Client();
  await new Promise((r, j) => { c2.on('ready', r); c2.on('error', j); c2.connect({ host: HOST, port: 22, username: 'admin', password: 'toanthinh' }); });
  console.log('\n=== NAT after repair ===');
  console.log((await sshExec(c2, '/ip/firewall/nat/print where comment~"ctn-"')).trim().slice(0, 3000));
  c2.end();
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });