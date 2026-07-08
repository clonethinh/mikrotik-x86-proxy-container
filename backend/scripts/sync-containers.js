/**
 * Sync proxy3p-2..10 từ MikroTik vào SQLite + fix auth env trên router
 */
const { Client } = require('ssh2');
const http = require('http');
const path = require('path');
const fs = require('fs');

const HOST = process.env.MIKROTIK_HOST || '113.22.235.54';
const USER = process.env.MIKROTIK_SSH_USER || 'admin';
const PASS = process.env.MIKROTIK_SSH_PASS || 'toanthinh';
const INDICES = (process.env.SYNC_INDICES || '2,3,4,5,6,7,8,9,10').split(',').map(Number);

const HTTP_BASE = 20000;
const SOCKS_BASE = 21000;
const EXT_HTTP = 30055;
const EXT_SOCKS = 31055;

function randomPassword(len = 12) {
  const c = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let p = '';
  for (let i = 0; i < len; i++) p += c[Math.floor(Math.random() * c.length)];
  return p;
}

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

function restGet(path) {
  return new Promise((resolve, reject) => {
    const auth = Buffer.from(`${USER}:${PASS}`).toString('base64');
    const req = http.request({
      hostname: HOST, port: 80, path, method: 'GET',
      headers: { Authorization: `Basic ${auth}` },
      timeout: 15000,
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(d); } });
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  // --- Phase 1: Sync DB via Prisma ---
  const dbPath = path.resolve(__dirname, '../../data/proxy.db');
  if (!fs.existsSync(path.dirname(dbPath))) fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const dbUrl = 'file:' + dbPath.replace(/\\/g, '/');
  process.env.DATABASE_URL = dbUrl;
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();

  const addrs = await restGet('/rest/ip/address?dynamic=yes');
  const ipByIf = {};
  if (Array.isArray(addrs)) {
    for (const a of addrs) {
      if (a.interface?.startsWith('pppoe-out')) {
        ipByIf[a.interface] = (a.address || '').split('/')[0];
      }
    }
  }

  const containers = await restGet('/rest/container');
  const containerNames = new Set(
    (Array.isArray(containers) ? containers : [])
      .map(c => c.name)
      .filter(n => n?.startsWith('proxy3p-')),
  );

  const synced = [];
  for (const idx of INDICES) {
    const ctnName = `proxy3p-${idx}`;
    if (!containerNames.has(ctnName)) {
      console.log(`SKIP idx=${idx}: container ${ctnName} not on router`);
      continue;
    }
    const pppoeName = `pppoe-out${idx}`;
    const publicIp = ipByIf[pppoeName] || null;
    const username = `u${idx}${Math.floor(1000 + Math.random() * 9000)}`;
    const password = randomPassword(12);

    const existing = await prisma.proxyUser.findUnique({ where: { pppoeIdx: idx } });
    const data = {
      pppoeName,
      vethName: `veth-3p-${idx}`,
      vethIp: `172.18.${idx}.2/30`,
      gatewayIp: `172.18.${idx}.1/30`,
      proxyType: 'both',
      httpPort: HTTP_BASE + idx,
      socksPort: SOCKS_BASE + idx,
      extHttpPort: EXT_HTTP + idx,
      extSocksPort: EXT_SOCKS + idx,
      containerName: ctnName,
      username: existing?.username || username,
      password: existing?.password || password,
      publicIp,
      enabled: true,
      status: 'running',
      statusMessage: publicIp ? `synced from router, exit ${publicIp}` : 'synced (no IP)',
    };

    const row = existing
      ? await prisma.proxyUser.update({ where: { pppoeIdx: idx }, data })
      : await prisma.proxyUser.create({ data: { pppoeIdx: idx, ...data } });

    synced.push({ idx, id: row.id, username: row.username, password: row.password, publicIp, container: ctnName });
    console.log(`DB sync: ${pppoeName} -> id=${row.id} user=${row.username} ip=${publicIp}`);
  }

  await prisma.$disconnect();

  // --- Phase 2: Fix auth on MikroTik containers via SSH ---
  const conn = new Client();
  await new Promise((res, rej) => {
    conn.on('ready', res);
    conn.on('error', rej);
    conn.connect({ host: HOST, port: 22, username: USER, password: PASS, readyTimeout: 20000 });
  });
  console.log('\nSSH connected — applying PROXY_LOGIN/PASSWORD + users.json');

  for (const s of synced) {
    const httpPort = HTTP_BASE + s.idx;
    const socksPort = SOCKS_BASE + s.idx;
    const user = s.username.replace(/"/g, '');
    const pass = s.password.replace(/"/g, '');

    // users-N.json
    const usersJson = JSON.stringify([{ i: s.idx, ip: '', user, pass, enabled: true }]);
    const escaped = usersJson.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    await sshExec(conn,
      `:do {/file/remove [find name=disk1/users-${s.idx}.json]} on-error={}
/file/add name=disk1/users-${s.idx}.json contents="${escaped}"`,
      30000,
    );

    // envlist (idempotent)
    const envName = `ENV_3PROXY_${s.idx}`;
    await sshExec(conn, `/container/envlist/remove [find name=${envName}]`).catch(() => {});
    for (const [k, v] of [
      ['PROXY_PORT', String(httpPort)],
      ['SOCKS_PORT', String(socksPort)],
      ['PROXY_LOGIN', user],
      ['PROXY_PASSWORD', pass],
      ['PRIMARY_RESOLVER', '1.1.1.1'],
      ['MAX_CONNECTIONS', '512'],
    ]) {
      await sshExec(conn, `/container/envlist/add name=${envName} key=${k} value="${v}"`);
    }

    // mount list
    await sshExec(conn,
      `:do {/container/mounts/remove [find list=MOUNT_PROXY_${s.idx}]} on-error={}
/container/mounts/add list=MOUNT_PROXY_${s.idx} src=disk1/users-${s.idx}.json dst=/etc/3proxy/users.json`,
    ).catch(() => {});

    // stop → set envlists + mountlists → start
    await sshExec(conn, `/container/stop [find name=${s.container}]`);
    await new Promise(r => setTimeout(r, 3000));

    // Set container to use envlist (RouterOS 7.23)
    await sshExec(conn,
      `/container/set [find name=${s.container}] envlists=${envName} mountlists=MOUNT_PROXY_${s.idx}`,
    ).catch(async () => {
      // Fallback: inline env comma-separated
      const envStr = `PROXY_PORT=${httpPort},SOCKS_PORT=${socksPort},PROXY_LOGIN=${user},PROXY_PASSWORD=${pass},PRIMARY_RESOLVER=1.1.1.1`;
      await sshExec(conn, `/container/set [find name=${s.container}] env="${envStr}"`);
    });

    await sshExec(conn, `/container/start [find name=${s.container}]`);
    console.log(`AUTH applied: ${s.container} user=${user}`);
    await new Promise(r => setTimeout(r, 2000));
  }

  conn.end();

  console.log('\n=== SYNC COMPLETE ===');
  console.log(JSON.stringify(synced.map(s => ({
    pppoe: `pppoe-out${s.idx}`,
    ip: s.publicIp,
    http: `${s.publicIp}:${EXT_HTTP + s.idx}`,
    user: s.username,
    pass: s.password,
  })), null, 2));

  fs.writeFileSync(
    path.resolve(__dirname, '../sync-result.json'),
    JSON.stringify(synced, null, 2),
  );
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });