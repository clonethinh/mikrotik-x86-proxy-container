const { exec } = require('../lib/ssh');
const { connectWithSshBootstrap } = require('../lib/routerServices');
const { buildNetworkPlan } = require('../lib/networkBootstrap');
const { step, warn } = require('../lib/logger');

async function run(cfg) {
  const net = cfg.network;
  if (!net?.configure) {
    step('05-network', 'Skipped (network.configure=false — router đã cấu hình sẵn)');
    return { ok: true, skipped: true };
  }

  if (!net.wanPort) throw new Error('network.wanPort bắt buộc khi configure=true');
  if (!net.lanPorts?.length) throw new Error('network.lanPorts bắt buộc (ít nhất 1 cổng LAN)');
  if (!net.pppoeWan?.user) throw new Error('network.pppoeWan.user bắt buộc');

  const conn = await connectWithSshBootstrap(cfg);
  try {
    step('05-network', `WAN=${net.wanPort} | LAN=${net.lanPorts.join(',')} | DHCP=${net.dhcpEnabled !== false}`);
    const script = buildNetworkPlan({ ...net, initialProxyCount: cfg.setup?.initialProxyCount });
    const out = await exec(conn, script, 120_000);
    const tail = out.split('\n').filter(Boolean).slice(-10).join('\n');
    if (tail) step('05-network', tail);

    step('05-network', 'Chờ pppoe-wan dial (30s)...');
    await sleep(30_000);
    const st = await exec(conn, '/interface/pppoe-client/print where name=pppoe-wan');
    const running = st.includes(' R ') || /running=yes/i.test(st);
    if (!running) warn('pppoe-wan chưa RUNNING — kiểm tra user/pass hoặc dây WAN');
    else step('05-network', 'pppoe-wan RUNNING');

    if (net.dhcpEnabled !== false) {
      const dhcp = await exec(conn, '/ip/dhcp-server/print where disabled=no');
      if (dhcp.includes(net.dhcpServerName || 'dhcp-lan')) step('05-network', 'DHCP Server OK');
      else warn('DHCP server chưa active');
    }
  } finally {
    conn.end();
  }
  return { ok: true };
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

module.exports = { run };