/**
 * Comprehensive MikroTik proxy audit via SSH
 */
const { Client } = require('ssh2');
const http = require('http');

const HOST = process.env.MIKROTIK_HOST || '113.22.235.54';
const USER = process.env.MIKROTIK_SSH_USER || 'admin';
const PASS = process.env.MIKROTIK_SSH_PASS || 'toanthinh';

function sshExec(conn, cmd, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`timeout: ${cmd.slice(0, 80)}`)), timeoutMs);
    conn.exec(cmd, (err, stream) => {
      if (err) { clearTimeout(timer); return reject(err); }
      stream.on('close', () => { clearTimeout(timer); resolve(output.trim()); });
      stream.on('data', (d) => { output += d.toString(); });
      stream.stderr.on('data', (d) => { output += d.toString(); });
    });
  });
}

function restGet(path) {
  return new Promise((resolve, reject) => {
    const auth = Buffer.from(`${USER}:${PASS}`).toString('base64');
    const req = http.request({
      hostname: HOST,
      port: 80,
      path,
      method: 'GET',
      headers: { Authorization: `Basic ${auth}` },
      timeout: 15000,
    }, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(data); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('REST timeout')); });
    req.end();
  });
}

async function main() {
  const report = {
    host: HOST,
    timestamp: new Date().toISOString(),
    system: {},
    pppoe: [],
    containers: [],
    veth: [],
    routingTables: [],
    mangleRules: [],
    natRules: { dstnat: [], srcnat: [] },
    firewall: [],
    proxies: [],
    webui: null,
    issues: [],
    summary: {},
  };

  // REST queries
  try {
    report.system.resource = await restGet('/rest/system/resource');
    report.system.identity = await restGet('/rest/system/identity');
  } catch (e) {
    report.issues.push(`REST failed: ${e.message}`);
  }

  const conn = new Client();
  await new Promise((resolve, reject) => {
    conn.on('ready', resolve);
    conn.on('error', reject);
    conn.connect({ host: HOST, port: 22222, username: USER, password: PASS, readyTimeout: 20000 });
  });

  console.log('SSH connected to', HOST);

  const cmds = {
    pppoe: '/interface/pppoe-client/print detail without-paging',
    containers: '/container/print detail without-paging',
    veth: '/interface/veth/print detail without-paging',
    bridge: '/interface/bridge/print detail without-paging',
    bridgePorts: '/interface/bridge/port/print detail without-paging',
    routingTables: '/routing/table/print without-paging',
    routes: '/ip/route/print detail where routing-table~"to_pppoe" without-paging',
    mangle: '/ip/firewall/mangle/print detail where comment~"ctn-mangle|dev-route" without-paging',
    dstnat: '/ip/firewall/nat/print detail where chain=dstnat and comment~"ctn-" without-paging',
    srcnat: '/ip/firewall/nat/print detail where chain=srcnat and comment~"ctn-" without-paging',
    filter: '/ip/firewall/filter/print detail where comment~"webuiproxymikrotik" without-paging',
    addresses: '/ip/address/print detail where interface~"pppoe-out|containers-veth|veth" without-paging',
    containerConfig: '/container/config/print without-paging',
  };

  const raw = {};
  for (const [key, cmd] of Object.entries(cmds)) {
    try {
      raw[key] = await sshExec(conn, cmd);
      console.log(`OK: ${key} (${raw[key].length} chars)`);
    } catch (e) {
      raw[key] = `ERROR: ${e.message}`;
      report.issues.push(`${key}: ${e.message}`);
    }
  }

  conn.end();

  // Parse PPPoE
  const pppoeBlocks = raw.pppoe.split(/\n(?=\d+ )/).filter(Boolean);
  for (const block of pppoeBlocks) {
    const name = (block.match(/name="([^"]+)"/) || [])[1];
    if (!name?.startsWith('pppoe-out')) continue;
    const idx = parseInt(name.replace('pppoe-out', ''), 10);
    const running = /running=yes/.test(block);
    const disabled = /disabled=yes/.test(block);
    const ipMatch = raw.addresses.match(new RegExp(`interface=${name}[\\s\\S]*?address=([\\d.]+)/`, 'm'));
    report.pppoe.push({
      name, idx, running, disabled,
      publicIp: ipMatch ? ipMatch[1] : null,
    });
  }
  report.pppoe.sort((a, b) => a.idx - b.idx);

  // Parse containers
  const containerBlocks = raw.containers.split(/\n(?=\d+ )/).filter(Boolean);
  for (const block of containerBlocks) {
    const name = (block.match(/name="([^"]+)"/) || [])[1];
    if (!name) continue;
    const status = (block.match(/status="([^"]*)"/) || [])[1] || (block.match(/status=([^\s]+)/) || [])[1] || '';
    const iface = (block.match(/interface=([^\s]+)/) || [])[1];
    report.containers.push({ name, status, interface: iface, raw: block.slice(0, 300) });
    if (name === 'webuiproxymikrotik') {
      report.webui = { name, status, interface: iface };
    }
    if (name.startsWith('proxy3p-')) {
      const idx = parseInt(name.replace('proxy3p-', ''), 10);
      const pppoe = report.pppoe.find(p => p.idx === idx);
      report.proxies.push({
        containerName: name,
        pppoeIdx: idx,
        pppoeName: `pppoe-out${idx}`,
        containerStatus: status,
        pppoeRunning: pppoe?.running ?? false,
        publicIp: pppoe?.publicIp ?? null,
        extHttpPort: 30055 + idx,
        extSocksPort: 31055 + idx,
        intHttpPort: 20000 + idx,
        intSocksPort: 21000 + idx,
        vethName: `veth-3p-${idx}`,
        vethIp: `172.18.${idx}.2`,
      });
    }
  }

  // Count rules
  report.mangleRules = (raw.mangle.match(/comment=/g) || []).length;
  report.natRules.dstnat = (raw.dstnat.match(/comment=/g) || []).length;
  report.natRules.srcnat = (raw.srcnat.match(/comment=/g) || []).length;
  report.routingTables = (raw.routingTables.match(/name=to_pppoe/g) || []).length;
  report.veth = (raw.veth.match(/name=veth-3p/g) || []).length;

  // Issues detection
  for (const p of report.proxies) {
    if (p.containerStatus !== 'running' && p.containerStatus !== 'R') {
      report.issues.push(`Container ${p.containerName} status=${p.containerStatus || 'unknown'}`);
    }
    if (!p.pppoeRunning) {
      report.issues.push(`PPPoE ${p.pppoeName} not running for ${p.containerName}`);
    }
    if (!p.publicIp) {
      report.issues.push(`No public IP on ${p.pppoeName}`);
    }
    const hasMangle = raw.mangle.includes(`ctn-mangle-${p.pppoeName}`);
    const hasSrcnat = raw.srcnat.includes(`ctn-${p.pppoeName}`);
    const hasDstHttp = raw.dstnat.includes(`${p.pppoeName}-HTTP`);
    if (!hasMangle) report.issues.push(`Missing mangle for ${p.pppoeName}`);
    if (!hasSrcnat) report.issues.push(`Missing srcnat for ${p.pppoeName}`);
    if (!hasDstHttp) report.issues.push(`Missing dst-nat HTTP for ${p.pppoeName}`);
  }

  if (!report.webui) {
    report.issues.push('WebUI container webuiproxymikrotik not found');
  } else if (report.webui.status !== 'running' && report.webui.status !== 'R') {
    report.issues.push(`WebUI container status=${report.webui.status}`);
  }

  report.summary = {
    totalPppoe: report.pppoe.length,
    pppoeUp: report.pppoe.filter(p => p.running).length,
    totalProxyContainers: report.proxies.length,
    proxyRunning: report.proxies.filter(p => p.containerStatus === 'running' || p.containerStatus === 'R').length,
    vethCount: report.veth,
    routingTableCount: report.routingTables,
    mangleRuleCount: report.mangleRules,
    dstnatRuleCount: report.natRules.dstnat,
    srcnatRuleCount: report.natRules.srcnat,
    issueCount: report.issues.length,
  };

  report.raw = raw;
  console.log('\n=== AUDIT REPORT ===\n');
  console.log(JSON.stringify({
    host: report.host,
    timestamp: report.timestamp,
    system: report.system,
    summary: report.summary,
    pppoe: report.pppoe.slice(0, 10),
    pppoeTotal: report.pppoe.length,
    proxies: report.proxies,
    webui: report.webui,
    issues: report.issues,
  }, null, 2));

  require('fs').writeFileSync(
    require('path').join(__dirname, '../mikrotik-audit-report.json'),
    JSON.stringify(report, null, 2),
  );
  console.log('\nFull report saved to backend/mikrotik-audit-report.json');
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });