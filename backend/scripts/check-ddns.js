const { Client } = require('ssh2');
const dns = require('dns').promises;
const http = require('http');

const HOST = process.env.MIKROTIK_HOST || '113.22.235.54';
const USER = process.env.MIKROTIK_SSH_USER || 'admin';
const PASS = process.env.MIKROTIK_SSH_PASS || 'toanthinh';

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

  console.log('=== IP Cloud / DDNS on router ===');
  const cloud = await exec(c, '/ip/cloud/print');
  console.log(cloud.trim() || '(empty)');

  console.log('\n=== Scheduler (duckdns) ===');
  const sched = await exec(c, '/system/scheduler/print where comment~"duck"');
  console.log(sched.trim() || '(none with duck comment)');
  const sched2 = await exec(c, '/system/scheduler/print');
  console.log(sched2.slice(0, 2000));

  console.log('\n=== Scripts (duckdns) ===');
  const scripts = await exec(c, '/system/script/print where name~"duck"');
  console.log(scripts.trim() || '(none)');
  const scripts2 = await exec(c, '/system/script/print');
  const duckLines = scripts2.split('\n').filter(l => /duck/i.test(l));
  if (duckLines.length) console.log(duckLines.join('\n'));

  console.log('\n=== pppoe-out1 IP ===');
  console.log((await exec(c, '/ip/address/print where interface=pppoe-out1')).trim());

  console.log('\n=== WebUI container env MIKROTIK_WAN_IP ===');
  console.log((await exec(c, '/container/print detail where name=webuiproxymikrotik')).match(/MIKROTIK_WAN_IP=[^\n]+/)?.[0] || 'n/a');

  c.end();

  // Try resolve common patterns from script output
  const all = cloud + sched2 + scripts2;
  const hosts = [...new Set([...all.matchAll(/[a-z0-9-]+\.duckdns\.org/gi)].map(m => m[0].toLowerCase()))];
  if (hosts.length) {
    console.log('\n=== DNS resolve ===');
    for (const h of hosts) {
      try {
        const ips = await dns.resolve4(h);
        console.log(`${h} -> ${ips.join(', ')}`);
      } catch (e) {
        console.log(`${h} -> resolve failed: ${e.message}`);
      }
    }
  }
})();