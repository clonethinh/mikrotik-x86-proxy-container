const { Client } = require('ssh2');
const c = new Client();
const host = '113.22.235.54';
const cmds = [
  '/interface/pppoe-client/print count-only',
  '/interface/pppoe-client/print where running=yes',
  '/ip/address/print where interface~"pppoe-out"',
  '/container/print',
  '/interface/veth/print',
  '/ip/firewall/nat/print count-only where chain=dstnat',
  '/ip/firewall/mangle/print count-only',
  '/routing/table/print',
  '/interface/bridge/print',
];

function exec(conn, cmd) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let o = '';
      stream.on('close', () => resolve(o.trim()));
      stream.on('data', (d) => { o += d; });
      stream.stderr.on('data', (d) => { o += d; });
    });
  });
}

c.on('ready', async () => {
  for (const cmd of cmds) {
    const out = await exec(c, cmd);
    console.log('--- ' + cmd + ' ---');
    console.log(out || '(empty)');
    console.log('');
  }
  c.end();
}).connect({ host, port: 22222, username: 'admin', password: 'toanthinh', readyTimeout: 20000 });