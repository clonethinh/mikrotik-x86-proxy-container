const dns = require('dns').promises;
const { connect, exec } = require('../lib/ssh');
const { request, login } = require('../lib/http');
const { step, warn } = require('../lib/logger');

async function run(cfg) {
  const checks = {};

  step('99-verify', `Health ${cfg.webuiUrl}/api/health ...`);
  try {
    const health = await request('GET', `${cfg.webuiUrl}/api/health`);
    checks.health = health.status === 200;
    if (!checks.health) warn(`Health returned ${health.status}`);
    else step('99-verify', 'Health OK');
  } catch (e) {
    checks.health = false;
    warn(`Health check failed: ${e.message}`);
  }

  step('99-verify', 'Login + fleet + proxy count...');
  try {
    const token = await login(cfg.webuiUrl, cfg.webui.adminUser, cfg.webui.adminPass);
    checks.login = true;
    const wan = await request('GET', `${cfg.webuiUrl}/api/wan`, null, token);
    const wans = Array.isArray(wan.data) ? wan.data : [];
    checks.wanCount = wans.length;
    checks.wanRunning = wans.filter(w => w.running).length;
    const proxies = await request('GET', `${cfg.webuiUrl}/api/proxies`, null, token);
    const plist = Array.isArray(proxies.data) ? proxies.data : [];
    checks.proxyTotal = plist.length;
    checks.proxyRunning = plist.filter(p => p.status === 'running').length;
    step('99-verify', `WAN: ${checks.wanRunning}/${checks.wanCount} running | Proxy: ${checks.proxyRunning}/${checks.proxyTotal}`);
    if (cfg.setup?.autoProvisionRunningWan && checks.wanRunning > 0 && checks.proxyRunning === 0) {
      warn('Có WAN running nhưng chưa có proxy — kiểm tra WAN page hoặc chạy Provision now');
    }
  } catch (e) {
    checks.login = false;
    warn(`Login/fleet failed: ${e.message}`);
  }

  if (cfg.wan.host) {
    step('99-verify', `DNS ${cfg.wan.host}...`);
    try {
      const ips = await dns.resolve4(cfg.wan.host);
      checks.duckdns = ips;
      step('99-verify', `${cfg.wan.host} → ${ips.join(', ')}`);
      if (!ips.length) warn(`DuckDNS ${cfg.wan.host} không resolve được IP`);
    } catch (e) {
      checks.duckdns = null;
      warn(`DNS resolve failed: ${e.message}`);
    }
  }

  const conn = await connect(cfg);
  try {
    const proxy3p = await exec(conn, '/container/print count-only where name~"proxy3p"');
    const veth = await exec(conn, '/interface/veth/print count-only where name~"veth-3p"');
    const hubTar = await exec(conn, `/file/print where name=${cfg.threeProxy.hubTarball}`);
    checks.proxy3pContainers = parseInt(proxy3p.trim(), 10) || 0;
    checks.veth3p = parseInt(veth.trim(), 10) || 0;
    checks.hubTarball = hubTar.includes('3proxy-hub');
    step('99-verify', `Router: proxy3p=${checks.proxy3pContainers} veth-3p=${checks.veth3p} hub-tar=${checks.hubTarball}`);
    const st = await exec(conn, '/container/print where name=webuiproxymikrotik');
    checks.webuiRunning = st.includes(' R ') || st.includes('RUNNING');
  } finally {
    conn.end();
  }

  const ok = checks.health && checks.login && checks.webuiRunning;
  return { ok, checks };
}

module.exports = { run };