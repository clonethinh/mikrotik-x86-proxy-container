const { Client } = require('ssh2');
const INDICES = [2, 3, 4, 5, 6, 7, 8, 9, 10];

function exec(conn, cmd) {
  return new Promise((res, rej) => {
    conn.exec(cmd, (e, s) => {
      if (e) return rej(e);
      let o = '';
      s.on('close', () => res(o));
      s.on('data', d => { o += d; });
    });
  });
}

async function main() {
  const c = new Client();
  await new Promise((r, j) => { c.on('ready', r); c.on('error', j); c.connect({ host: '113.22.235.54', port: 22222, username: 'admin', password: 'toanthinh' }); });

  console.log(await exec(c, '/container/envlist/print'));
  for (const idx of INDICES) {
    const name = `proxy3p-${idx}`;
    console.log(`Restart ${name}...`);
    await exec(c, `/container/stop [find name=${name}]`);
    await new Promise(r => setTimeout(r, 2000));
    await exec(c, `/container/start [find name=${name}]`);
    await new Promise(r => setTimeout(r, 1500));
  }
  console.log(await exec(c, '/container/print'));
  c.end();
}

main().catch(console.error);