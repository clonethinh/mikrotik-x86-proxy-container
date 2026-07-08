const { Client } = require('ssh2');
const HOST = '113.22.235.54';
const USER = 'admin';
const PASS = 'toanthinh';

function exec(conn, cmd) {
  return new Promise((res, rej) => {
    let o = '';
    conn.exec(cmd, (e, s) => {
      if (e) return rej(e);
      s.on('close', () => res(o));
      s.on('data', d => o += d);
      s.stderr.on('data', d => o += d);
    });
  });
}

(async () => {
  const c = new Client();
  await new Promise((r, j) => { c.on('ready', r); c.on('error', j); c.connect({ host: HOST, port: 22222, username: USER, password: PASS }); });
  for (const cmd of [
    '/container/print',
    '/interface/veth/print where name~"veth-3p"',
    '/ip/firewall/nat/print where comment~"ctn-"',
    '/ip/firewall/mangle/print where comment~"ctn-"',
    '/routing/table/print where name~"to_pppoe"',
    '/container/mounts/print where list~"MOUNT_PROXY"',
    '/file/print where name~"users-"',
  ]) {
    console.log('\n>>>', cmd);
    console.log((await exec(c, cmd)).trim() || '(empty)');
  }
  c.end();
})();