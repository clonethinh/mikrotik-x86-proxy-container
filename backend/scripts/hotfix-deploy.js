/**
 * Quick hotfix deploy: build frontend + docker + upload tar + force redeploy
 * Không sync DB / không upload proxy.db (giữ DB writable trên router)
 */
const { execSync } = require('child_process');
const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const HOST = process.env.MIKROTIK_HOST || 'ntpcproxy.duckdns.org';
const USER = process.env.MIKROTIK_SSH_USER || 'admin';
const PASS = process.env.MIKROTIK_SSH_PASS || 'toanthinh';
const TAR_LOCAL = path.join(ROOT, 'webuiproxymikrotik.docker.tar');
const TAR_OCI = path.join(ROOT, 'webuiproxymikrotik.tar');

function run(cmd, opts = {}) {
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: 'inherit', cwd: opts.cwd || ROOT, ...opts });
}

function sshExec(conn, cmd, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    let out = '';
    const t = setTimeout(() => reject(new Error(`timeout: ${cmd.slice(0, 60)}`)), timeoutMs);
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
      ws.on('close', () => { console.log(`Uploaded ${remote} (${(n / 1024 / 1024).toFixed(1)} MiB)`); resolve(); });
      ws.on('error', reject);
      rs.pipe(ws);
    });
  });
}

async function main() {
  run('npm run build', { cwd: path.join(ROOT, 'frontend') });
  run('docker buildx build --platform linux/amd64 -t webuiproxymikrotik:latest --load .');
  run(`docker save webuiproxymikrotik:latest -o "${TAR_OCI}"`);
  const py = process.platform === 'win32' ? 'python' : 'python3';
  run(`${py} "${path.join(ROOT, 'scripts/_oci_to_docker.py')}" "${ROOT.replace(/\\/g, '/')}"`);
  if (!fs.existsSync(TAR_LOCAL)) fs.copyFileSync(TAR_OCI, TAR_LOCAL);

  const conn = new Client();
  await new Promise((res, rej) => {
    conn.on('ready', res);
    conn.on('error', rej);
    conn.connect({ host: HOST, port: 22, username: USER, password: PASS, readyTimeout: 30000 });
  });

  await sshExec(conn, `:do {/file/remove [find name~"webuiproxymikrotik.tar"]} on-error={}`).catch(() => {});
  await sftpPut(conn, TAR_LOCAL, '/disk1/webuiproxymikrotik.tar');
  conn.end();

  run('node scripts/force-redeploy-webui.js', { cwd: path.join(ROOT, 'backend') });
  console.log('\nHOTFIX DEPLOY OK');
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });