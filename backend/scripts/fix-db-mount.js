/**
 * Fix readonly SQLite mount + upload fresh proxy.db
 */
const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');
const http = require('http');

const HOST = '113.22.235.54';
const USER = 'admin';
const PASS = 'toanthinh';
const DB_LOCAL = path.resolve(__dirname, '../data/proxy-fresh.db');

function sshExec(conn, cmd, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    let out = '';
    const t = setTimeout(() => reject(new Error('timeout')), timeoutMs);
    conn.exec(cmd, (err, stream) => {
      if (err) { clearTimeout(t); return reject(err); }
      stream.on('close', () => { clearTimeout(t); resolve(out); });
      stream.on('data', d => { out += d; });
      stream.stderr.on('data', d => { out += d; });
    });
  });
}

function sftpPut(conn, local, remote) {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) return reject(err);
      const rs = fs.createReadStream(local);
      const ws = sftp.createWriteStream(remote);
      ws.on('close', resolve);
      ws.on('error', reject);
      rs.pipe(ws);
    });
  });
}

async function patchAutoProxy() {
  const base = 'http://113.22.235.54:8088';
  const loginBody = JSON.stringify({ username: 'admin', password: 'admin123' });
  const token = await new Promise((resolve, reject) => {
    const req = http.request(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(loginBody) },
      timeout: 15000,
    }, res => {
      let d = '';
      res.on('data', c => { d += c; });
      res.on('end', () => {
        const j = JSON.parse(d);
        if (j.token) resolve(j.token);
        else reject(new Error(d.slice(0, 200)));
      });
    });
    req.on('error', reject);
    req.write(loginBody);
    req.end();
  });
  const body = JSON.stringify({ mode: 'full', pollIntervalMs: 20000, maxConcurrent: 16, staleTtlMs: 1800000, goneDebouncePolls: 3 });
  await new Promise((resolve, reject) => {
    const req = http.request(`${base}/api/settings/auto-proxy`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'Content-Length': Buffer.byteLength(body) },
      timeout: 15000,
    }, res => {
      let d = '';
      res.on('data', c => { d += c; });
      res.on('end', () => res.statusCode < 300 ? resolve(d) : reject(new Error(d)));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
  console.log('auto-proxy full OK');
}

async function main() {
  if (!fs.existsSync(DB_LOCAL)) throw new Error('missing proxy-fresh.db — run prisma db push first');

  const conn = new Client();
  await new Promise((res, rej) => {
    conn.on('ready', res);
    conn.on('error', rej);
    conn.connect({ host: HOST, port: 22, username: USER, password: PASS });
  });

  console.log('Stop container...');
  await sshExec(conn, `/container/stop [find name=webuiproxymikrotik]`).catch(() => {});
  await new Promise(r => setTimeout(r, 6000));

  console.log('Remove old DB files...');
  await sshExec(conn, `:do {/file/remove [find name=data/proxy.db]} on-error={}
:do {/file/remove [find name=webui-data/proxy.db]} on-error={}`);

  console.log('Upload fresh proxy.db...');
  await sftpPut(conn, DB_LOCAL, '/disk1/data/proxy.db');

  console.log('Restart container...');
  await sshExec(conn, `/container/start [find name=webuiproxymikrotik]`);
  await new Promise(r => setTimeout(r, 30000));

  const st = await sshExec(conn, '/container/print where name=webuiproxymikrotik');
  console.log(st);

  conn.end();

  for (let i = 0; i < 8; i++) {
    try {
      await patchAutoProxy();
      break;
    } catch (e) {
      console.log(`API retry ${i + 1}:`, e.message.slice(0, 100));
      await new Promise(r => setTimeout(r, 8000));
    }
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });