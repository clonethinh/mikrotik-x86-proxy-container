#!/usr/bin/env node
const { loadConfig } = require('../setup/lib/config');
const { connect, exec } = require('../setup/lib/ssh');
const { login, request } = require('../setup/lib/http');

function shellQuote(cmd) {
  return `/bin/sh -c '${cmd.replace(/'/g, "'\\''")}'`;
}

async function main() {
  const cfg = loadConfig();
  const token = await login(cfg.webuiUrl, cfg.webui.adminUser, cfg.webui.adminPass);
  const conn = await connect(cfg);

  const passOut = await exec(conn, '/file/print detail where name=disk1/hub-3proxy.cfg', 20000);
  const m = passOut.match(/_webui_mon:CL:([A-Za-z0-9_-]+)/);
  const pass = m ? m[1] : '';
  console.log('monitor password:', pass ? 'found' : 'MISSING');

  const probe = `node -e "const http=require('http');const auth=Buffer.from('_webui_mon:${pass}').toString('base64');const host=process.argv[1];http.get({host,port:31800,path:'/S',headers:{Authorization:'Basic '+auth},timeout:5000},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{console.log(host,r.statusCode,'u4899='+d.includes('u4899'),'len='+d.length);});}).on('error',e=>console.log(host,'ERR',e.message));"`;
  for (const host of ['172.18.0.2', '172.18.0.3']) {
    const out = await exec(
      conn,
      `/container/shell webuiproxymikrotik cmd="${shellQuote(`${probe} ${host}`)}"`,
      20000,
    ).catch(e => e.message);
    console.log('probe', out.trim());
  }

  const db = await exec(
    conn,
    `/container/shell webuiproxymikrotik cmd="${shellQuote("sqlite3 /data/proxy.db '.tables'")}"`,
    15000,
  ).catch(e => e.message);
  console.log('tables:', db.trim());

  const samples = await exec(
    conn,
    `/container/shell webuiproxymikrotik cmd="${shellQuote("sqlite3 /data/proxy.db 'SELECT COUNT(*), MAX(datetime(ts)) FROM ProxyTrafficSample;'")}"`,
    15000,
  ).catch(e => e.message);
  console.log('samples total:', samples.trim());

  const rollups = await exec(
    conn,
    `/container/shell webuiproxymikrotik cmd="${shellQuote("sqlite3 /data/proxy.db 'SELECT period, COUNT(*) FROM ProxyTrafficRollup GROUP BY period;'")}"`,
    15000,
  ).catch(e => e.message);
  console.log('rollups:', rollups.trim() || '(none)');

  const debug = await request('GET', `${cfg.webuiUrl}/api/debug/network`, null, token);
  if (debug.status === 200) {
    const t = debug.data.tests?.find(x => x.name?.includes('proxy'));
    console.log('debug network proxy test:', t);
  }

  conn.end();
}

main().catch(e => { console.error(e); process.exit(1); });