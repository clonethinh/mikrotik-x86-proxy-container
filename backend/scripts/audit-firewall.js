const { Client } = require('ssh2');
const HOST = '113.22.235.54';

function ssh(conn, cmd) {
  return new Promise((r, j) => {
    let o = '';
    conn.exec(cmd, (e, s) => {
      if (e) return j(e);
      s.on('close', () => r(o));
      s.on('data', d => o += d);
      s.stderr.on('data', d => o += d);
    });
  });
}

(async () => {
  const c = new Client();
  await new Promise((r, j) => { c.on('ready', r); c.on('error', j); c.connect({ host: HOST, port: 22222, username: 'admin', password: 'toanthinh' }); });

  for (const cmd of [
    '/interface/pppoe-client/print',
    '/container/print',
    '/interface/veth/print',
    '/ip/firewall/filter/print',
    '/ip/firewall/nat/print',
    '/ip/firewall/mangle/print',
    '/routing/table/print where name~"to_pppoe"',
  ]) {
    console.log('\n==========', cmd, '==========');
    console.log((await ssh(c, cmd)).trim() || '(empty)');
  }
  c.end();
})().catch(e => { console.error(e); process.exit(1); });