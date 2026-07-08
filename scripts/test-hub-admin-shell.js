#!/usr/bin/env node
const { loadConfig } = require('../setup/lib/config');
const { connect, exec } = require('../setup/lib/ssh');

function shellQuote(cmd) {
  return `/bin/sh -c '${cmd.replace(/'/g, "'\\''")}'`;
}

async function buildFetchCmd(c) {
  const cfg = await exec(c, '/file/print detail where name=disk1/hub-3proxy.cfg', 20000);
  const pass = (cfg.match(/_webui_mon:CL:([A-Za-z0-9_-]+)/) || [])[1];
  return `wget -qO- http://_webui_mon:${pass}@172.18.0.2:31800/S 2>/dev/null`;
}

async function main() {
  const c = await connect(loadConfig());
  const fetchCmd = await buildFetchCmd(c);
  const out = await exec(
    c,
    `/container/shell proxy3p-hub cmd="${shellQuote(fetchCmd)}"`,
    30000,
  );
  console.log(out.trim());
  console.log('u4899', out.includes('u4899'));
  c.end();
}

main().catch(e => { console.error(e); process.exit(1); });