/**
 * Remove orphan veth1..veth5 and stale bridge ports (not veth-webui / veth-3p-*)
 */
const { Client } = require('ssh2');

const HOST = process.env.MIKROTIK_HOST || '113.22.235.54';
const USER = process.env.MIKROTIK_SSH_USER || 'admin';
const PASS = process.env.MIKROTIK_SSH_PASS || 'toanthinh';

function exec(conn, cmd, t = 120000) {
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

async function main() {
  const c = new Client();
  await new Promise((r, j) => {
    c.on('ready', r);
    c.on('error', j);
    c.connect({ host: HOST, port: 22222, username: USER, password: PASS, readyTimeout: 30000 });
  });
  console.log('SSH OK\n');

  console.log('=== BEFORE ===');
  console.log((await exec(c, '/interface/veth/print')).trim());
  console.log('\n', (await exec(c, '/interface/bridge/port/print where bridge=containers-veth')).trim());

  console.log('\n=== Remove stale bridge ports (inactive veth-3p refs) ===');
  await exec(c, ':do {/interface/bridge/port/remove [find comment~"bp-veth-3p"]} on-error={}').catch(() => {});

  console.log('\n=== Remove orphan veth1..veth99 (keep veth-webui, veth-3p-*) ===');
  for (let i = 1; i <= 99; i++) {
    const n = `veth${i}`;
    await exec(c, `:do {/interface/veth/remove [find name=${n}]} on-error={}`).catch(() => {});
  }

  console.log('\n=== AFTER ===');
  console.log((await exec(c, '/interface/veth/print')).trim());
  console.log('\n', (await exec(c, '/interface/bridge/port/print where bridge=containers-veth')).trim());
  c.end();
  console.log('\nDone.');
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });