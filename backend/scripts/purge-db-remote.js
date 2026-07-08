const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');
const http = require('http');

const HOST = process.env.MIKROTIK_HOST || '113.22.235.54';
const USER = process.env.MIKROTIK_SSH_USER || 'admin';
const PASS = process.env.MIKROTIK_SSH_PASS || 'toanthinh';
const WEBUI = process.env.WEBUI_URL || `http://${HOST}:8088`;
const scriptLocal = path.join(__dirname, 'purge-db-once.js');

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

async function main() {
  const conn = new Client();
  await new Promise((res, rej) => {
    conn.on('ready', res);
    conn.on('error', rej);
    conn.connect({ host: HOST, port: 22222, username: USER, password: PASS });
  });

  await sftpPut(conn, scriptLocal, '/disk1/data/purge-once.js');
  console.log('Uploaded purge-once.js to disk1/data/');

  const out = await sshExec(conn, '/container/shell webuiproxymikrotik cmd="cd /app && node /data/purge-once.js"');
  console.log('\nPurge output:', out.trim());
  await sshExec(conn, ':do {/file/remove [find name=disk1/data/purge-once.js]} on-error={}');
  conn.end();

  // verify
  const login = await new Promise((res, rej) => {
    const u = new URL('/api/auth/login', WEBUI);
    const body = JSON.stringify({ username: 'admin', password: 'admin123' });
    const r = http.request({ hostname: u.hostname, port: 80, path: u.pathname, method: 'POST', headers: { 'Content-Type': 'application/json' } }, s => {
      let d = ''; s.on('data', c => d += c); s.on('end', () => res(JSON.parse(d)));
    });
    r.on('error', rej); r.write(body); r.end();
  });
  const token = login.token;
  const disc = await new Promise((res, rej) => {
    const r = http.request({ hostname: '113.22.235.54', port: 8088, path: '/api/wan/discovery', method: 'GET', headers: { Authorization: 'Bearer ' + token } }, s => {
      let d = ''; s.on('data', c => d += c); s.on('end', () => res(JSON.parse(d)));
    });
    r.on('error', rej); r.end();
  });
  console.log('\nWanDiscovery sau purge:', Array.isArray(disc) ? disc.length : disc);
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });