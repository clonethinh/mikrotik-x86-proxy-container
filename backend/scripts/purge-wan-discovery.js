/**
 * Xóa WanDiscovery + WanStatus cũ (pppoeIdx > 1) trong DB trên container
 */
const { Client } = require('ssh2');
const http = require('http');

const HOST = process.env.MIKROTIK_HOST || '113.22.235.54';
const USER = process.env.MIKROTIK_SSH_USER || 'admin';
const PASS = process.env.MIKROTIK_SSH_PASS || 'toanthinh';
const WEBUI = process.env.WEBUI_URL || `http://${HOST}:8088`;

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

function httpJson(method, path, body) {
  return new Promise((res, rej) => {
    const u = new URL(path, WEBUI);
    const payload = body ? JSON.stringify(body) : null;
    const headers = {};
    if (payload) headers['Content-Type'] = 'application/json';
    const r = http.request({ hostname: u.hostname, port: u.port || 80, path: u.pathname, method, headers }, s => {
      let d = '';
      s.on('data', c => d += c);
      s.on('end', () => {
        try { res({ status: s.statusCode, data: JSON.parse(d) }); }
        catch { res({ status: s.statusCode, data: d }); }
      });
    });
    r.on('error', rej);
    if (payload) r.write(payload);
    r.end();
  });
}

const PRISMA_JS = `
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const disc = await p.wanDiscovery.deleteMany({ where: { pppoeIdx: { gt: 1 } } });
  const wan = await p.wanStatus.deleteMany({ where: { pppoeIdx: { gt: 1 } } });
  const routes = await p.deviceRoute.deleteMany({});
  console.log(JSON.stringify({ wanDiscovery: disc.count, wanStatus: wan.count, deviceRoutes: routes.count }));
  await p.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
`.replace(/\n/g, ' ').replace(/"/g, '\\"');

async function main() {
  // Thử API purge-fleet trước (nếu đã deploy)
  const login = await httpJson('POST', '/api/auth/login', { username: 'admin', password: 'admin123' });
  if (login.status === 200 && login.data?.token) {
    const purge = await new Promise((res, rej) => {
      const u = new URL('/api/system/purge-fleet', WEBUI);
      const r = http.request({
        hostname: u.hostname, port: u.port || 80, path: u.pathname, method: 'POST',
        headers: { Authorization: 'Bearer ' + login.data.token, 'Content-Type': 'application/json' },
      }, s => {
        let d = '';
        s.on('data', c => d += c);
        s.on('end', () => {
          try { res({ status: s.statusCode, data: JSON.parse(d) }); } catch { res({ status: s.statusCode, data: d }); }
        });
      });
      r.on('error', rej);
      r.write('{}');
      r.end();
    });
    if (purge.status === 200) {
      console.log('purge-fleet OK:', purge.data);
      return;
    }
    console.log('purge-fleet not available (' + purge.status + '), dùng prisma trong container...');
  }

  const conn = new Client();
  await new Promise((res, rej) => {
    conn.on('ready', res);
    conn.on('error', rej);
    conn.connect({ host: HOST, port: 22, username: USER, password: PASS, readyTimeout: 30000 });
  });

  const cmd = `/container/shell webuiproxymikrotik cmd="node -e \\"${PRISMA_JS}\\""`;
  const out = await sshExec(conn, cmd).catch(async () => {
    // fallback: ghi script tạm rồi chạy
    const script = PRISMA_JS.replace(/\\"/g, '"');
    await sshExec(conn, `:do {/file/remove [find name=disk1/purge-db.js]} on-error={}`);
    const escaped = script.replace(/"/g, '\\"');
    await sshExec(conn, `/file/add name=disk1/purge-db.js type=script contents="${escaped}"`);
    return sshExec(conn, '/container/shell webuiproxymikrotik cmd="node /data/../disk1/purge-db.js"');
  });
  console.log('\nResult:', out.trim());
  conn.end();
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });