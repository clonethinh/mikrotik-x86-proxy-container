#!/usr/bin/env node
const { loadConfig } = require('../setup/lib/config');
const { connect, exec } = require('../setup/lib/ssh');
const { request, login } = require('../setup/lib/http');

function parseAdmin(xml) {
  const users = [...xml.matchAll(/<user name="([^"]+)"[^>]*active="(\d+)"/g)]
    .map(m => ({ user: m[1], active: +m[2] }))
    .sort((a, b) => b.active - a.active);
  const ctr = {};
  for (const m of xml.matchAll(/<counter name="([^"]+)" value="(\d+)"/g)) {
    ctr[m[1]] = (ctr[m[1]] || 0) + +m[2];
  }
  return { users, ctr };
}

function parseLogLines(text) {
  const byUser = {};
  let errors = 0;
  let proxy = 0;
  let socks = 0;
  const errCodes = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const m = line.match(/^\d+\.\d+\s+(\d+)\s+(\S+)\s+(\S+)\s+(\d+)\s+(\S+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\d+)/);
    if (!m) continue;
    const [, err, user, , , , , , , svc] = m;
    if (user === '-' || user === '_webui_mon') {
      errors++;
      errCodes[err] = (errCodes[err] || 0) + 1;
      continue;
    }
    byUser[user] = (byUser[user] || 0) + 1;
    if (svc === 'PROXY') proxy++;
    if (svc === 'SOCKS') socks++;
  }
  const top = Object.entries(byUser).sort((a, b) => b[1] - a[1]).slice(0, 15);
  return { top, errors, proxy, socks, errCodes, total: proxy + socks + errors };
}

async function hubAdmin(conn, container) {
  const adminLine = await exec(conn, `/container/shell ${container} cmd="grep ^admin /etc/3proxy/3proxy.cfg"`, 15000);
  const usersLine = await exec(conn, `/container/shell ${container} cmd="grep ^users /etc/3proxy/3proxy.cfg"`, 15000);
  const pass = (usersLine.match(/_webui_mon:CL:([A-Za-z0-9_-]+)/) || [])[1];
  const host = (adminLine.match(/-i([0-9.]+)/) || [])[1] || '127.0.0.1';
  const port = (adminLine.match(/-p([0-9]+)/) || [])[1] || '31800';
  if (!pass) return { xml: '', pass: null, host, port };
  const xml = await exec(
    conn,
    `/container/shell ${container} cmd="wget -qO- --user=_webui_mon --password=${pass} http://${host}:${port}/S"`,
    30000,
  );
  return { xml, pass: 'ok', host, port };
}

async function main() {
  const cfg = loadConfig();
  const conn = await connect(cfg);

  console.log('=== CPU CORES ===');
  console.log(await exec(conn, '/system resource cpu print', 10000));

  for (const c of ['proxy3p-hub', 'proxy3p-hub-2']) {
    console.log(`\n========== ${c} ==========`);
    const det = await exec(conn, `/container print detail where name=${c}`, 15000);
    console.log('cpu:', (det.match(/cpu-usage=([^\s]+)/) || [])[1], 'mem:', (det.match(/memory-current=([^\s]+)/) || [])[1]);
    console.log(await exec(conn, `/container/shell ${c} cmd="ps -o pid,time,comm"`, 10000).then(s => s.trim()));
    console.log(await exec(conn, `/container/shell ${c} cmd="ss -s"`, 10000).then(s => s.trim()));
    const estab = await exec(conn, `/container/shell ${c} cmd="ss -tn state established | wc -l"`, 10000);
    console.log('established TCP:', estab.trim());
    const listen = await exec(conn, `/container/shell ${c} cmd="ss -tln | wc -l"`, 10000);
    console.log('listen sockets:', listen.trim());

    const adm = await hubAdmin(conn, c);
    console.log(`admin bind ${adm.host}:${adm.port} xml=${adm.xml.length}b`);
    if (adm.xml.length > 100) {
      const p = parseAdmin(adm.xml);
      console.log('counters:', p.ctr);
      console.log('top active users:', p.users.slice(0, 15));
    } else {
      console.log('admin snippet:', adm.xml.slice(0, 200));
    }
  }

  console.log('\n========== LOG shard1 today (tail 3000) ==========');
  const log = await exec(conn, '/container/shell proxy3p-hub cmd="tail -3000 /var/log/3proxy/shard1-260708.log"', 60000);
  const stats = parseLogLines(log);
  console.log('lines parsed:', stats.total);
  console.log('PROXY ok:', stats.proxy, 'SOCKS ok:', stats.socks, 'errors/anon:', stats.errors);
  console.log('error codes:', stats.errCodes);
  console.log('top users:', stats.top);

  console.log('\n========== CFG shard1 ==========');
  const cfgtxt = await exec(conn, ':put [/file get disk1/hub-3proxy.cfg contents]', 20000);
  console.log('maxconn:', (cfgtxt.match(/maxconn (\d+)/) || [])[1]);
  console.log('proxy listeners:', (cfgtxt.match(/^proxy /gm) || []).length);
  console.log('socks listeners:', (cfgtxt.match(/^socks /gm) || []).length);
  console.log('enabled users:', (cfgtxt.match(/^allow u/g) || []).length);

  console.log('\n========== FIREWALL ==========');
  console.log('connections:', (await exec(conn, '/ip firewall connection print count-only', 10000)).trim());
  console.log('hub nat rules:', (await exec(conn, '/ip firewall nat print count-only where comment~"hub-slot"', 10000)).trim());

  console.log('\n========== VETH throughput 10s ==========');
  const b = await exec(conn, '/interface print stats without-paging where name=veth-3p-hub', 10000);
  await new Promise(r => setTimeout(r, 10000));
  const a = await exec(conn, '/interface print stats without-paging where name=veth-3p-hub', 10000);
  const parseBytes = s => {
    const m = s.match(/RX-BYTE\s+TX-BYTE[\s\S]*?\d+\s+RS\s+\S+\s+([\d ]+)\s+([\d ]+)/);
    if (!m) return null;
    return { rx: parseInt(m[1].replace(/\s/g, ''), 10), tx: parseInt(m[2].replace(/\s/g, ''), 10) };
  };
  const b1 = parseBytes(b);
  const a1 = parseBytes(a);
  if (b1 && a1) {
    console.log(`veth-3p-hub 10s delta: RX ${((a1.rx - b1.rx) / 1024).toFixed(1)} KiB, TX ${((a1.tx - b1.tx) / 1024).toFixed(1)} KiB`);
  }

  try {
    const token = await login(cfg.webuiUrl, cfg.webui.adminUser, cfg.webui.adminPass);
    const proxies = await request('GET', `${cfg.webuiUrl}/api/proxies`, null, token);
    const enabled = (proxies.data || []).filter(p => p.enabled);
    const status = {};
    for (const p of enabled) status[p.status || '?'] = (status[p.status || '?'] || 0) + 1;
    console.log('\n========== WEBUI ==========');
    console.log('enabled proxies:', enabled.length, 'status:', status);
    const live = await request('GET', `${cfg.webuiUrl}/api/proxies/metrics/live`, null, token).catch(() => null);
    if (live?.data?.length) {
      const top = [...live.data].sort((x, y) => (y.activeClients || 0) - (x.activeClients || 0)).slice(0, 10);
      console.log('top live clients:', top.map(x => `${x.username}=${x.activeClients}c ${x.bytesPerSec || 0}B/s`));
    }
  } catch (e) {
    console.log('webui skip:', e.message);
  }

  console.log('\n========== PROFILE 10s ==========');
  const prof = await exec(conn, '/tool profile duration=10', 20000);
  const chunks = prof.split('Columns: NAME, USAGE');
  console.log('Columns: NAME, USAGE' + (chunks[chunks.length - 1] || '').trim());

  conn.end();
}

main().catch(e => { console.error(e); process.exit(1); });