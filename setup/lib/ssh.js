const { Client } = require('../../backend/node_modules/ssh2');
const fs = require('fs');

function connect(cfg) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn.on('ready', () => resolve(conn));
    conn.on('error', reject);
    conn.connect({
      host: cfg.router.host,
      port: cfg.router.sshPort,
      username: cfg.router.sshUser,
      password: cfg.router.sshPass,
      readyTimeout: 30000,
    });
  });
}

function exec(conn, cmd, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    let out = '';
    const t = setTimeout(() => reject(new Error(`SSH timeout: ${cmd.slice(0, 100)}`)), timeoutMs);
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
      let n = 0;
      rs.on('data', c => { n += c.length; });
      ws.on('close', () => resolve(n));
      ws.on('error', reject);
      rs.pipe(ws);
    });
  });
}

async function nextRootDir(conn) {
  const out = await exec(conn, '/file/print where name~"webuiproxymikrotik-root"');
  let max = 0;
  for (const m of out.matchAll(/webuiproxymikrotik-root(\d*)/g)) {
    const n = m[1] ? parseInt(m[1], 10) : 0;
    if (n > max) max = n;
  }
  return `disk1/webuiproxymikrotik-root${max + 1}`;
}

module.exports = { connect, exec, sftpPut, nextRootDir };