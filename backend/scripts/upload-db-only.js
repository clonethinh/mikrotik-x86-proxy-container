const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

const HOST = process.env.MIKROTIK_HOST || '113.22.235.54';
const USER = process.env.MIKROTIK_SSH_USER || 'admin';
const PASS = process.env.MIKROTIK_SSH_PASS || 'toanthinh';
const dbLocal = path.resolve(__dirname, '../../data/proxy.db');

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

async function main() {
  const c = new Client();
  await new Promise((r, j) => { c.on('ready', r); c.on('error', j); c.connect({ host: HOST, port: 22222, username: USER, password: PASS }); });
  await sftpPut(c, dbLocal, '/disk1/data/proxy.db');
  console.log('Uploaded proxy.db');
  c.end();
}

main().catch(e => { console.error(e); process.exit(1); });