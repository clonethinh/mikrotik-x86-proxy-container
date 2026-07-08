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
      s.on('data', d => { o += d; });
      s.stderr.on('data', d => { o += d; });
    });
  });
}

async function main() {
  const c = new Client();
  await new Promise((r, j) => { c.on('ready', r); c.on('error', j); c.connect({ host: HOST, port: 22, username: USER, password: PASS }); });

  console.log('Remove bridge ports for veth-3p-*...');
  for (let i = 1; i <= 99; i++) {
    const n = `veth-3p-${i}`;
    await exec(c, `:do {/interface/bridge/port/remove [find interface=${n}]} on-error={}`).catch(() => {});
  }

  console.log('Remove veth-3p-* ...');
  for (let i = 1; i <= 99; i++) {
    await exec(c, `:do {/interface/veth/remove [find name=veth-3p-${i}]} on-error={}`).catch(() => {});
  }

  console.log('Remove gw-veth gateway IPs...');
  for (let i = 1; i <= 99; i++) {
    await exec(c, `:do {/ip/address/remove [find comment=gw-veth-3p-${i}]} on-error={}`).catch(() => {});
  }

  console.log('Remove routes in to_pppoe* tables...');
  for (let i = 1; i <= 99; i++) {
    const t = `to_pppoe${i}`;
    await exec(c, `:do {/ip/route/remove [find routing-table=${t}]} on-error={}`).catch(() => {});
    await exec(c, `:do {/routing/table/remove [find name=${t}]} on-error={}`).catch(() => {});
  }

  console.log('Remove orphan NAT/mangle by comment...');
  await exec(c, `:do {/ip/firewall/nat/remove [find comment~"ctn-pppoe-out"]} on-error={}
:do {/ip/firewall/nat/remove [find comment~"ctn-pppoe-out"]} on-error={}
:do {/ip/firewall/mangle/remove [find comment~"ctn-mangle-pppoe-out"]} on-error={}`).catch(() => {});

  console.log('\n--- AFTER ---');
  console.log('veth:', (await exec(c, '/interface/veth/print count-only where name~"veth-3p"')).trim());
  console.log('routing tables:', (await exec(c, '/routing/table/print count-only where name~"to_pppoe"')).trim());
  console.log('containers:', (await exec(c, '/container/print count-only')).trim());
  c.end();
}

main().catch(e => { console.error(e); process.exit(1); });