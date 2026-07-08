#!/usr/bin/env node
/**
 * Apply SSH brute-force blacklist (rule + script + scheduler).
 * Hub backend cũng tự gọi SshBlacklistService khi khởi động.
 */
const { loadConfig } = require('../setup/lib/config');
const { connect, exec } = require('../setup/lib/ssh');

async function main() {
  const cfg = loadConfig();
  const conn = await connect(cfg);
  const out = await exec(conn, '/import file=disk1/webuiproxymikrotik/ensure-ssh-blacklist.rsc', 90_000);
  console.log(out.trim() || 'imported');
  const blacklisted = await exec(conn, '/ip firewall address-list print count-only where list=hub-scan-deny and comment~"ssh-brute"', 8_000);
  const strikes = await exec(conn, '/ip firewall address-list print count-only where list=hub-ssh-strikes', 8_000);
  console.log('blacklisted:', blacklisted.trim(), '| strikes:', strikes.trim());
  conn.end();
}

main().catch(e => { console.error(e); process.exit(1); });