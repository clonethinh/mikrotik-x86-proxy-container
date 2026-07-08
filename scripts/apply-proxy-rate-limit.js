#!/usr/bin/env node
/**
 * Rate-limit bot scan trên cổng proxy WAN.
 * - SYN > 40/s mỗi IP → drop (per pppoe-out)
 * - > 60 concurrent conn mỗi IP → drop (all-ppp)
 * Idempotent — chạy lại an toàn.
 * HubProxyService cũng tự gọi logic tương đương (HubRateLimitService) sau mỗi lần tạo proxy.
 */
const { loadConfig } = require('../setup/lib/config');
const { connect, exec } = require('../setup/lib/ssh');

const COMMENTS = [
  'hub-rate-limit-scan-drop',
  'hub-rate-limit-http-conn',
  'hub-rate-limit-socks-conn',
  'hub-rate-limit-http-syn',
  'hub-rate-limit-socks-syn',
];

async function main() {
  const cfg = loadConfig();
  const conn = await connect(cfg);
  const extHttp = cfg.network?.extHttpBase || 30055;
  const extSocks = cfg.network?.extSocksBase || 31055;
  const maxOut = cfg.hub?.maxPppoeOut || 300;
  const httpFrom = extHttp + 1;
  const httpTo = extHttp + maxOut;
  const socksFrom = extSocks + 1;
  const socksTo = extSocks + maxOut;
  const proxyPlaceBefore = '[find comment=hub-in-http-pppoe-out1-s1]';
  const scanDropPlaceBefore = '[find comment="INPUT: Allow port 22222 (SSH) from WAN"]';

  for (const c of COMMENTS) {
    await exec(conn, `:do {/ip firewall filter remove [find comment=${c}]} on-error={}`, 8_000);
  }
  await exec(conn, ':do {/ip firewall filter remove [find comment~"hub-rate-limit-syn-"]} on-error={}', 10_000);
  await exec(conn, ':foreach i in=[/ip firewall/filter/find where comment~"hub-rate-limit" and invalid] do={/ip firewall/filter/remove $i}', 10_000);

  const base = [
    `/ip firewall filter add chain=input in-interface=all-ppp src-address-list=hub-scan-deny action=drop comment=hub-rate-limit-scan-drop place-before=${scanDropPlaceBefore}`,
    `/ip firewall filter add chain=input in-interface=all-ppp protocol=tcp connection-state=new dst-port=${httpFrom}-${httpTo} connection-limit=60,32 action=drop comment=hub-rate-limit-http-conn place-before=${proxyPlaceBefore}`,
    `/ip firewall filter add chain=input in-interface=all-ppp protocol=tcp connection-state=new dst-port=${socksFrom}-${socksTo} connection-limit=60,32 action=drop comment=hub-rate-limit-socks-conn place-before=${proxyPlaceBefore}`,
  ];
  for (const cmd of base) {
    await exec(conn, `:do {${cmd}} on-error={}`, 10_000);
  }

  const pp = await exec(conn, '/interface print terse where name~"^pppoe-out"', 15_000);
  const ifaces = [...pp.matchAll(/name=([^\s]+)/g)].map(m => m[1]).filter(n => /^pppoe-out\d+$/.test(n));
  const dest = '[find comment=hub-rate-limit-scan-drop]';
  for (const ifn of ifaces) {
    for (const [suffix, range] of [['http', `${httpFrom}-${httpTo}`], ['socks', `${socksFrom}-${socksTo}`]]) {
      await exec(conn,
        `/ip firewall filter add chain=input in-interface=${ifn} protocol=tcp tcp-flags=syn connection-state=new dst-port=${range} limit=40,32:packet action=drop comment=hub-rate-limit-syn-${ifn}-${suffix} place-before=${dest}`,
        8_000,
      );
    }
  }

  // scan-drop TRƯỚC accept SSH WAN; các rule proxy TRƯỚC hub-in-http accept
  await exec(conn, `:do {/ip firewall filter move [find comment=hub-rate-limit-scan-drop] destination=${scanDropPlaceBefore}} on-error={}`, 8_000);
  for (const c of ['hub-rate-limit-http-conn', 'hub-rate-limit-socks-conn']) {
    await exec(conn, `:do {/ip firewall filter move [find comment=${c}] destination=${proxyPlaceBefore}} on-error={}`, 8_000);
  }
  for (const ifn of ifaces) {
    for (const s of ['http', 'socks']) {
      await exec(conn, `:do {/ip firewall filter move [find comment=hub-rate-limit-syn-${ifn}-${s}] destination=${proxyPlaceBefore}} on-error={}`, 5_000);
    }
  }

  console.log('=== APPLIED ===');
  console.log(await exec(conn, '/ip firewall filter print count-only where comment~"hub-rate-limit"', 8_000));
  console.log('invalid:', await exec(conn, '/ip firewall filter print count-only where comment~"hub-rate-limit" and invalid', 8_000));
  console.log('\nCPU:', await exec(conn, '/system resource cpu print', 8_000));
  conn.end();
}

main().catch(e => { console.error(e); process.exit(1); });