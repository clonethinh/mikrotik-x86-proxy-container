#!/usr/bin/env node
/**
 * Audit + dọn filter rate-limit/scan thừa, rồi apply lại sạch.
 * Xóa: invalid, test, SSH blacklist drop cũ, firewall SSH legacy, syn generic legacy.
 */
const fs = require('fs');
const path = require('path');
const { loadConfig } = require('../setup/lib/config');
const { connect, exec } = require('../setup/lib/ssh');

const ROOT = path.resolve(__dirname, '..');
const ACCESS = path.join(ROOT, 'router-access.json');

function mergeSshPort(cfg) {
  try {
    const access = JSON.parse(fs.readFileSync(ACCESS, 'utf8'));
    if (access?.ssh?.port) cfg.router.sshPort = access.ssh.port;
  } catch { /* ignore */ }
  return cfg;
}

/** Comment firewall cũ trước khi đổi SSH → 22222 (chỉ dùng để remove, không tạo lại). */
const LEGACY_SSH_FW_ACCEPT = 'INPUT: Allow port 22 (SSH) from WAN';

const REMOVE_COMMENT_EXACT = [
  'hub-ssh-blacklist-drop',
  'hub-ssh-blacklist-lan-ok',
  LEGACY_SSH_FW_ACCEPT,
  'hub-rate-limit-http-syn',
  'hub-rate-limit-socks-syn',
];

const REMOVE_COMMENT_PATTERNS = [
  'test',
  'tname',
  'simple-test',
  'simple',
  'test-bl',
  'test-h3',
  'test-deny',
  'test-final',
  'test-scan',
  'test1',
  'test2',
  'test3',
  'a1',
  'a2',
  'a3',
  'a4',
  'a5',
];

async function count(conn, cmd) {
  const n = parseInt((await exec(conn, cmd, 15_000)).trim(), 10);
  return Number.isFinite(n) ? n : 0;
}

async function removeOrphans(conn) {
  let removed = 0;
  for (const c of REMOVE_COMMENT_EXACT) {
    const n = await count(conn, `/ip firewall filter print count-only where comment="${c}"`);
    if (n > 0) {
      await exec(conn, `:do {/ip firewall filter remove [find comment="${c}"]} on-error={}`, 10_000);
      removed += n;
      console.log(`  - removed comment="${c}" x${n}`);
    }
  }
  for (const c of REMOVE_COMMENT_PATTERNS) {
    const n = await count(conn, `/ip firewall filter print count-only where comment="${c}"`);
    if (n > 0) {
      await exec(conn, `:do {/ip firewall filter remove [find comment="${c}"]} on-error={}`, 10_000);
      removed += n;
      console.log(`  - removed comment="${c}" x${n}`);
    }
  }
  const inv = await count(conn, '/ip firewall filter print count-only where invalid=yes');
  if (inv > 0) {
    await exec(conn, ':foreach i in=[/ip firewall/filter/find where invalid=yes] do={/ip firewall/filter/remove $i}', 15_000);
    console.log(`  - removed invalid x${inv}`);
    removed += inv;
  }
  // address-list test / list cũ không dùng
  await exec(conn, ':do {/ip firewall address-list remove [find list=hub-ssh-deny]} on-error={}', 10_000);
  await exec(conn, ':do {/ip firewall address-list remove [find list=hub-ssh-blacklist]} on-error={}', 10_000);
  return removed;
}

async function applyClean(conn, cfg) {
  const extHttp = cfg.network?.extHttpBase || 30055;
  const extSocks = cfg.network?.extSocksBase || 31055;
  const maxOut = cfg.hub?.maxPppoeOut || 300;
  const httpFrom = extHttp + 1;
  const httpTo = extHttp + maxOut;
  const socksFrom = extSocks + 1;
  const socksTo = extSocks + maxOut;
  const proxyPlaceBefore = '[find comment=hub-in-http-pppoe-out1-s1]';
  const scanDropPlaceBefore = '[find comment="INPUT: Allow port 22222 (SSH) from WAN"]';

  const legacy = ['hub-rate-limit-scan-drop', 'hub-rate-limit-http-conn', 'hub-rate-limit-socks-conn',
    'hub-rate-limit-http-syn', 'hub-rate-limit-socks-syn'];
  for (const c of legacy) {
    await exec(conn, `:do {/ip firewall filter remove [find comment=${c}]} on-error={}`, 8_000);
  }
  await exec(conn, ':do {/ip firewall filter remove [find comment~"hub-rate-limit-syn-"]} on-error={}', 15_000);
  await exec(conn, ':foreach i in=[/ip firewall/filter/find where comment~"hub-rate-limit" and invalid] do={/ip/firewall/filter/remove $i}', 10_000);

  const base = [
    `/ip firewall filter add chain=input in-interface=all-ppp src-address-list=hub-scan-deny action=drop comment=hub-rate-limit-scan-drop place-before=${scanDropPlaceBefore}`,
    `/ip firewall filter add chain=input in-interface=all-ppp protocol=tcp connection-state=new dst-port=${httpFrom}-${httpTo} connection-limit=60,32 action=drop comment=hub-rate-limit-http-conn place-before=${proxyPlaceBefore}`,
    `/ip firewall filter add chain=input in-interface=all-ppp protocol=tcp connection-state=new dst-port=${socksFrom}-${socksTo} connection-limit=60,32 action=drop comment=hub-rate-limit-socks-conn place-before=${proxyPlaceBefore}`,
  ];
  for (const cmd of base) await exec(conn, `:do {${cmd}} on-error={}`, 10_000);

  const pp = await exec(conn, '/interface print terse where name~"^pppoe-out"', 20_000);
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
  await exec(conn, `:do {/ip firewall filter move [find comment=hub-rate-limit-scan-drop] destination=${scanDropPlaceBefore}} on-error={}`, 8_000);
  for (const c of ['hub-rate-limit-http-conn', 'hub-rate-limit-socks-conn']) {
    await exec(conn, `:do {/ip firewall filter move [find comment=${c}] destination=${proxyPlaceBefore}} on-error={}`, 8_000);
  }
  for (const ifn of ifaces) {
    for (const s of ['http', 'socks']) {
      await exec(conn, `:do {/ip firewall filter move [find comment=hub-rate-limit-syn-${ifn}-${s}] destination=${proxyPlaceBefore}} on-error={}`, 5_000);
    }
  }
  return ifaces.length;
}

async function report(conn, label) {
  console.log(`\n=== ${label} ===`);
  console.log('rate-limit rules:', await exec(conn, '/ip firewall filter print count-only where comment~"hub-rate-limit"', 8_000));
  console.log('invalid:', await exec(conn, '/ip firewall filter print count-only where comment~"hub-rate-limit" and invalid', 8_000));
  console.log('ssh-blacklist drop rules:', await exec(conn, '/ip firewall filter print count-only where comment~"hub-ssh-blacklist"', 8_000));
  console.log('legacy SSH accept (remove if >0):', await exec(conn, `/ip firewall filter print count-only where comment="${LEGACY_SSH_FW_ACCEPT}"`, 8_000));
  console.log('accept SSH 22222:', await exec(conn, '/ip firewall filter print count-only where comment="INPUT: Allow port 22222 (SSH) from WAN"', 8_000));
  const sample = await exec(conn, '/ip firewall filter print where comment~"hub-rate-limit-scan-drop|Allow port 22222"', 10_000);
  console.log(sample.trim().split('\n').slice(0, 8).join('\n'));
  console.log('scan-drop stats:', await exec(conn, '/ip firewall filter print stats where comment=hub-rate-limit-scan-drop', 8_000));
}

async function main() {
  const cfg = mergeSshPort(loadConfig());
  console.log(`SSH ${cfg.router.host}:${cfg.router.sshPort}`);
  const conn = await connect(cfg);

  await report(conn, 'BEFORE');
  console.log('\n=== REMOVE ORPHANS ===');
  const removed = await removeOrphans(conn);
  console.log(`orphans removed: ${removed}`);

  console.log('\n=== RE-APPLY CLEAN RATE-LIMIT ===');
  const pppoe = await applyClean(conn, cfg);
  console.log(`pppoe-out interfaces: ${pppoe}`);

  await report(conn, 'AFTER');
  conn.end();
}

main().catch(e => { console.error(e); process.exit(1); });