/**
 * Repair proxy3p-2..5: cleanup + patch WebUI + provision/now
 */
const { Client } = require('ssh2');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const HOST = process.env.MIKROTIK_HOST || '113.22.235.54';
const USER = process.env.MIKROTIK_SSH_USER || 'admin';
const PASS = process.env.MIKROTIK_SSH_PASS || 'toanthinh';
const DIST = path.join(__dirname, '../dist/services');

function sshExec(conn, cmd, ms = 180000) {
  return new Promise((res, rej) => {
    let o = '';
    const t = setTimeout(() => rej(new Error('timeout')), ms);
    conn.exec(cmd, (e, s) => {
      if (e) { clearTimeout(t); return rej(e); }
      s.on('data', d => { o += d; process.stdout.write(d); });
      s.stderr.on('data', d => o += d);
      s.on('close', () => { clearTimeout(t); res(o); });
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

function req(method, path, body, token) {
  return new Promise((res, rej) => {
    const payload = body !== undefined ? JSON.stringify(body) : null;
    const h = {};
    if (token) h.Authorization = `Bearer ${token}`;
    if (payload) h['Content-Type'] = 'application/json';
    const r = http.request({ hostname: HOST, port: 8088, path, method, headers: h }, rs => {
      let d = '';
      rs.on('data', c => d += c);
      rs.on('end', () => {
        try { res({ status: rs.statusCode, data: JSON.parse(d) }); }
        catch { res({ status: rs.statusCode, data: d }); }
      });
    });
    r.on('error', rej);
    if (payload) r.write(payload);
    r.end();
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function cleanup(conn, idx) {
  const ctn = `proxy3p-${idx}`;
  const fname = `disk1/users-${idx}.json`;
  console.log(`\n--- cleanup out${idx} ---`);
  await sshExec(conn, `:do {/container/stop [find name=${ctn}]} on-error={}`, 30000);
  await sleep(3000);
  await sshExec(conn, `:do {/container/remove [find name=${ctn}]} on-error={}`, 30000);
  await sshExec(conn, `:do {/container/mounts/remove [find list=MOUNT_PROXY_${idx}]} on-error={}`, 15000);
  await sshExec(conn, `:foreach f in=[/file/find where name="${fname}"] do={/file/remove $f}`, 15000);
}

async function main() {
  console.log('REPAIR FLEET out2-out5\n');

  const conn = new Client();
  await new Promise((r, j) => { conn.on('ready', r); conn.on('error', j); conn.connect({ host: HOST, port: 22, username: USER, password: PASS }); });

  for (const idx of [2, 3, 4, 5]) await cleanup(conn, idx);

  console.log('\n=== PATCH WebUI ===');
  await sftpPut(conn, path.join(DIST, 'proxy/ProxyService.js'), '/disk1/data/patch-ProxyService.js');
  await sshExec(conn, '/container/shell webuiproxymikrotik cmd="cp /data/patch-ProxyService.js /app/dist/services/proxy/ProxyService.js"');
  await sshExec(conn, '/container/stop [find name=webuiproxymikrotik]').catch(() => {});
  await sleep(10000);
  await sshExec(conn, '/container/start [find name=webuiproxymikrotik]');
  conn.end();

  for (let i = 0; i < 25; i++) {
    try {
      const h = await req('GET', '/api/health');
      if (h.status === 200 && h.data?.ok) break;
    } catch {}
    await sleep(3000);
  }

  const login = await req('POST', '/api/auth/login', { username: 'admin', password: 'admin123' });
  const token = login.data.token;

  for (const idx of [2, 3, 4, 5]) {
    console.log(`\n=== provision/now out${idx} ===`);
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const r = await req('POST', `/api/wan/${idx}/provision/now`, {}, token);
        console.log('attempt', attempt, 'status:', r.status, typeof r.data === 'object' ? JSON.stringify(r.data).slice(0, 200) : r.data);
        if (r.status === 200) break;
      } catch (e) {
        console.log('attempt', attempt, 'err:', e.message);
        await sleep(10000);
      }
    }
    await sleep(75000);
  }

  const proxies = await req('GET', '/api/proxies', undefined, token);
  console.log('\n=== PROXIES ===');
  for (const p of proxies.data || []) {
    console.log(`  ${p.pppoeName} status=${p.status} ip=${p.publicIp} http=${p.extHttpPort} user=${p.username}`);
  }

  const conn2 = new Client();
  await new Promise((r, j) => { conn2.on('ready', r); conn2.on('error', j); conn2.connect({ host: HOST, port: 22, username: USER, password: PASS }); });
  console.log('\n=== containers ===');
  console.log((await sshExec(conn2, '/container/print')).trim());
  console.log('\n=== users files ===');
  console.log((await sshExec(conn2, '/file/print where name~"users-"')).trim());
  const d2 = await sshExec(conn2, '/container/print detail where name=proxy3p-2');
  console.log('\nproxy3p-2 env:', (d2.match(/PROXY_PORT=\d+|SOCKS_PORT=\d+/) || []).join(' '));

  console.log('\n=== CURL TEST ===');
  for (const p of proxies.data || []) {
    try {
      const pw = (await req('GET', `/api/proxies/${p.id}/password`, undefined, token)).data.password;
      const url = `http://${p.username}:${pw}@${p.publicIp}:${p.extHttpPort}`;
      const out = execSync(`curl.exe -s -x "${url}" "https://api.ipify.org?format=json" --max-time 15`, { encoding: 'utf8', timeout: 20000 });
      const exit = JSON.parse(out).ip;
      console.log(`${p.pppoeName} exit=${exit} ${exit === p.publicIp ? 'PASS' : 'FAIL'}`);
    } catch (e) {
      console.log(`${p.pppoeName} FAIL ${String(e.message).split('\n')[0].slice(0, 100)}`);
    }
  }
  conn2.end();
  console.log('\nREPAIR DONE');
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });