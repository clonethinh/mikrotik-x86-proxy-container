#!/usr/bin/env node
const { loadConfig } = require('../setup/lib/config');
const { connect, exec } = require('../setup/lib/ssh');

function sq(c) {
  return `/bin/sh -c '${c.replace(/'/g, "'\\''")}'`;
}

function parseAdminXml(xml) {
  const counters = {};
  for (const m of xml.matchAll(/<counter name="([^"]+)" value="(\d+)"/g)) {
    counters[m[1]] = (counters[m[1]] || 0) + parseInt(m[2], 10);
  }
  const users = [];
  for (const m of xml.matchAll(/<user name="([^"]+)"[^>]*active="(\d+)"/g)) {
    users.push({ user: m[1], active: parseInt(m[2], 10) });
  }
  users.sort((a, b) => b.active - a.active);
  const services = [...xml.matchAll(/<service name="([^"]+)"/g)].map(m => m[1]);
  return { counters, users, services };
}

async function fetchAdmin(conn, pass, ip, port) {
  const inner = `wget -qO- http://_webui_mon:${pass}@${ip}:${port}/S 2>/dev/null`;
  const cmd = `/container/shell webuiproxymikrotik cmd="${sq(inner)}"`;
  return exec(conn, cmd, 30000);
}

async function main() {
  const cfg = loadConfig();
  const conn = await connect(cfg);

  console.log('=== SYSTEM ===');
  console.log(await exec(conn, '/system resource print', 10000).then(s => s.trim()));
  console.log(await exec(conn, '/system resource cpu print', 10000).then(s => s.trim()));

  const cfgRaw = await exec(conn, ':put [/file get disk1/hub-3proxy.cfg contents]', 20000);
  const pass = (cfgRaw.match(/_webui_mon:CL:([A-Za-z0-9_-]+)/) || [])[1];
  if (!pass) throw new Error('monitor password not found');

  const shards = [
    { label: 'shard1 proxy3p-hub', ip: '172.18.0.2', port: 31800, container: 'proxy3p-hub' },
    { label: 'shard2 proxy3p-hub-2', ip: '172.19.0.2', port: 31801, container: 'proxy3p-hub-2' },
  ];

  for (const s of shards) {
    console.log(`\n=== 3PROXY ADMIN: ${s.label} ===`);
    try {
      const xml = await fetchAdmin(conn, pass, s.ip, s.port);
      console.log('xml bytes:', xml.length);
      if (xml.length < 50) { console.log('empty/fail:', xml.slice(0, 200)); continue; }
      const parsed = parseAdminXml(xml);
      console.log('services:', parsed.services.length);
      console.log('counter totals:', parsed.counters);
      console.log('top 20 active users:', parsed.users.slice(0, 20));
      const ps = await exec(conn, `/container/shell ${s.container} cmd="${sq('ps -o pid,time,comm; ss -s 2>/dev/null; ss -tn state established 2>/dev/null | wc -l')}"`, 20000);
      console.log('container ps/ss:\n' + ps.trim());
    } catch (e) {
      console.log('ERR', e.message);
    }
  }

  console.log('\n=== HUB LISTEN PORTS (shard1) ===');
  const ports = await exec(conn, '/container/shell proxy3p-hub cmd="' + sq("ss -tln | grep -E ':(200|210|300|310|318)' | wc -l; ss -tn state established | wc -l; ss -tn state established '( sport = :20001 or sport = :30056 )' 2>/dev/null | wc -l") + '"', 20000);
  console.log('lines (listen count / established total / sample port):', ports.trim());

  console.log('\n=== FIREWALL CONNECTIONS ===');
  const fw = await exec(conn, '/ip firewall connection print count-only', 10000);
  console.log('total connections:', fw.trim());

  console.log('\n=== PROFILE 15s ===');
  const prof = await exec(conn, '/tool profile duration=15', 25000);
  const chunks = prof.split('Columns: NAME, USAGE');
  console.log('Columns: NAME, USAGE' + (chunks[chunks.length - 1] || '').trim());

  console.log('\n=== CONTAINER CPU x5 (2s interval) ===');
  for (let i = 0; i < 5; i++) {
    const lines = [];
    for (const n of ['proxy3p-hub', 'proxy3p-hub-2', 'webuiproxymikrotik']) {
      const d = await exec(conn, `/container print detail where name=${n}`, 10000);
      const cpu = (d.match(/cpu-usage=([^\s]+)/) || [])[1];
      const mem = (d.match(/memory-current=([^\s]+)/) || [])[1];
      lines.push(`${n}=${cpu}/${mem}`);
    }
    console.log(`t${i}:`, lines.join(' | '));
    await new Promise(r => setTimeout(r, 2000));
  }

  // 3proxy log tail - recent activity
  console.log('\n=== 3PROXY LOG TAIL (shard1) ===');
  const log = await exec(conn, '/container/shell proxy3p-hub cmd="' + sq('ls -la /var/log/3proxy/ 2>/dev/null; tail -5 /var/log/3proxy/shard1-*.log 2>/dev/null | tail -20') + '"', 20000);
  console.log(log.trim().slice(0, 3000));

  conn.end();
}

main().catch(e => { console.error(e); process.exit(1); });