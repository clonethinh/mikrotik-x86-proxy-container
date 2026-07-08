#!/usr/bin/env node
/**
 * Wizard setup router MikroTik MỚI — hỏi mạng (WAN/LAN/DHCP) + deploy proxy.
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { exec } = require('../setup/lib/ssh');
const { connectWithSshBootstrap } = require('../setup/lib/routerServices');
const { parseEthernetPorts, parsePortList } = require('../setup/lib/networkDiscover');

const { assertWindowsAdmin } = require('../setup/lib/platform');

assertWindowsAdmin();

const ROOT = path.resolve(__dirname, '..');
const TEMPLATE = path.join(ROOT, 'setup.config.minimal.json');
const OUT = process.env.SETUP_CONFIG || path.join(ROOT, 'setup.config.json');

function ask(rl, question, def = '') {
  const hint = def !== '' && def != null ? ` [${def}]` : '';
  return new Promise(resolve => {
    rl.question(`${question}${hint}: `, answer => {
      resolve((answer || '').trim() || (def != null ? String(def) : ''));
    });
  });
}

async function discoverPorts(host, sshUser, sshPass, sshPort) {
  const conn = await connectWithSshBootstrap({ router: { host, sshUser, sshPass, sshPort } });
  try {
    const out = await exec(conn, '/interface ethernet print without-paging', 30_000);
    return parseEthernetPorts(out);
  } finally {
    conn.end();
  }
}

async function main() {
  console.log('');
  console.log('============================================================');
  console.log('  webuiproxymikrotik — Setup HOÀN CHỈNH (router mới)');
  console.log('============================================================');
  console.log('');
  console.log('Wizard sẽ hỏi: số cổng, WAN, LAN, DHCP, PPPoE, DuckDNS, rồi deploy proxy.');
  console.log('Yêu cầu: Windows (Administrator) + RouterOS 7.4+ + package container | Node + Docker');
  console.log('');
  console.log('Router MỚI (factory reset) — truy cập lần đầu:');
  console.log('  • Winbox → tab Neighbors → bấm MAC address (không cần IP)');
  console.log('  • Hoặc cắm PC vào cổng LAN → IP mặc định thường 192.168.88.1');
  console.log('  • Setup tự bật SSH khi đã kết nối được (REST :80 nếu SSH đang tắt)');
  console.log('  • PC chạy setup phải cùng mạng LAN với router (cáp trực tiếp)');
  console.log('');

  if (!fs.existsSync(TEMPLATE)) {
    console.error('Thiếu setup.config.minimal.json');
    process.exit(1);
  }

  if (fs.existsSync(OUT)) {
    const rl0 = readline.createInterface({ input: process.stdin, output: process.stdout });
    const overwrite = await ask(rl0, 'setup.config.json đã tồn tại — ghi đè? (y/N)', 'N');
    rl0.close();
    if (!/^y(es)?$/i.test(overwrite)) {
      console.log('Giữ nguyên setup.config.json');
      process.exit(0);
    }
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const host = await ask(
      rl,
      'Router host lúc setup (factory: 192.168.88.1 | Winbox MAC → xem IP Services)',
      '192.168.88.1',
    );
    if (!host) throw new Error('Cần router host');

    const sshPass = await ask(rl, 'SSH password (admin)', '');
    if (!sshPass) throw new Error('Cần SSH password');

    const configureNet = await ask(rl, 'Cấu hình mạng router từ đầu? (Y/n)', 'Y');
    const doNetwork = !/^n(o)?$/i.test(configureNet);

    let etherPorts = [];
    let wanPort = '';
    let lanPorts = [];
    let dhcpEnabled = true;
    let lanGateway = '192.168.88.1';
    let lanSubnet = '192.168.88.0/24';
    let dhcpStart = '192.168.88.10';
    let dhcpEnd = '192.168.88.254';
    let pppoeUser = '';
    let pppoePass = '';

    if (doNetwork) {
      console.log('\n--- Quét cổng ethernet trên router ---');
      try {
        etherPorts = await discoverPorts(host, 'admin', sshPass, 22222);
      } catch (e) {
        console.log(`  Không quét được (${e.message}) — nhập tay bên dưới`);
      }

      if (etherPorts.length) {
        console.log(`  Phát hiện ${etherPorts.length} cổng: ${etherPorts.join(', ')}`);
      } else {
        const n = await ask(rl, 'Router có mấy cổng ether?', '5');
        const count = Math.max(1, parseInt(n, 10) || 5);
        etherPorts = Array.from({ length: count }, (_, i) => `ether${i + 1}`);
        console.log(`  Giả định: ${etherPorts.join(', ')}`);
      }

      const wanIn = await ask(rl, `Cổng WAN là port nào? (${etherPorts.join(', ')})`, etherPorts[etherPorts.length - 1] || 'ether5');
      wanPort = /^ether\d+$/i.test(wanIn) ? wanIn : `ether${wanIn}`;
      if (!etherPorts.includes(wanPort)) etherPorts.push(wanPort);

      const defaultLan = etherPorts.filter(p => p !== wanPort).join(',');
      const lanIn = await ask(rl, `Cổng LAN (cách nhau dấu phẩy, ${etherPorts.length - 1} cổng còn lại)`, defaultLan);
      lanPorts = parsePortList(lanIn, etherPorts).filter(p => p !== wanPort);
      if (!lanPorts.length && defaultLan) {
        lanPorts = parsePortList(defaultLan, etherPorts).filter(p => p !== wanPort);
      }
      if (!lanPorts.length) throw new Error('Cần ít nhất 1 cổng LAN');

      console.log(`  → WAN: ${wanPort} | LAN (${lanPorts.length}): ${lanPorts.join(', ')}`);

      const dhcpAns = await ask(rl, 'Bật DHCP Server cho LAN? (Y/n)', 'Y');
      dhcpEnabled = !/^n(o)?$/i.test(dhcpAns);

      if (dhcpEnabled) {
        lanGateway = await ask(rl, 'IP gateway LAN (router)', '192.168.88.1');
        const prefix = await ask(rl, 'Subnet LAN (CIDR)', '192.168.88.0/24');
        lanSubnet = prefix.includes('/') ? prefix : `${lanGateway}/24`;
        dhcpStart = await ask(rl, 'DHCP pool từ', '192.168.88.10');
        dhcpEnd = await ask(rl, 'DHCP pool đến', '192.168.88.254');
      }

      console.log('  (pppoe-wan = WAN quản lý/DuckDNS — KHÔNG làm proxy)');
      console.log('  (proxy pool = pppoe-out1, out2, … — dùng chung user/pass ISP)');
      pppoeUser = await ask(rl, 'PPPoE user (ISP — cho pppoe-wan và pppoe-out1+)', '');
      if (!pppoeUser) throw new Error('Cần PPPoE user');
      pppoePass = await ask(rl, 'PPPoE password', '');
    }

    console.log('\n--- DuckDNS ---');
    const useDuck = await ask(rl, 'Dùng DuckDNS cập nhật IP WAN? (Y/n)', 'Y');
    let duckDomain = '';
    let duckToken = '';
    let wanHost = host;
    if (!/^n(o)?$/i.test(useDuck)) {
      const subIn = await ask(rl, 'DuckDNS subdomain (vd: myproxy — không gõ .duckdns.org)', '');
      duckDomain = subIn.replace(/\.duckdns\.org\/?$/i, '').trim();
      duckToken = await ask(rl, 'DuckDNS token (UUID từ https://www.duckdns.org)', '');
      if (!duckDomain) throw new Error('Cần DuckDNS subdomain');
      if (!duckToken) throw new Error('Cần DuckDNS token');
      wanHost = `${duckDomain}.duckdns.org`;
      console.log(`  → WebUI/WAN host: ${wanHost}`);
    } else {
      wanHost = await ask(rl, 'Hostname cho WebUI (IP hoặc domain)', host);
    }

    console.log('\n--- WebUI & proxy ---');
    const webuiPass = await ask(rl, 'WebUI admin password', 'admin123');
    const shardCount = await ask(rl, 'Số hub shard (1 shard = 50 proxy)', '2');
    const shardN = Math.max(1, Math.min(6, parseInt(shardCount, 10) || 2));
    const maxProxies = shardN * 50;
    const initialProxiesIn = await ask(
      rl,
      `Số proxy ban đầu — đếm từ pppoe-out1 (không gồm pppoe-wan), 0=template, max ${maxProxies}`,
      '10',
    );
    const initialProxyCount = Math.min(maxProxies, Math.max(0, parseInt(initialProxiesIn, 10) || 0));

    const cfg = JSON.parse(fs.readFileSync(TEMPLATE, 'utf8'));
    cfg.router.host = host;
    cfg.router.sshPass = sshPass;
    cfg.wan.host = wanHost;
    cfg.wan.duckDomain = duckDomain;
    cfg.wan.duckToken = duckToken;
    cfg.webui.adminPass = webuiPass;
    cfg.hub.shardCount = shardN;
    cfg.hub.maxPppoeOut = maxProxies;
    if (!cfg.setup) cfg.setup = {};
    cfg.setup.initialProxyCount = initialProxyCount;

    cfg.network = {
      ...cfg.network,
      configure: doNetwork,
      etherPorts,
      wanPort: wanPort || cfg.network?.wanPort,
      lanPorts: lanPorts.length ? lanPorts : cfg.network?.lanPorts,
      bridgeLan: 'bridge-lan',
      macvlanName: 'macvlan-wan',
      lanGateway,
      lanSubnet,
      dhcpEnabled,
      dhcpPoolStart: dhcpStart,
      dhcpPoolEnd: dhcpEnd,
      dhcpServerName: 'dhcp-lan',
      dhcpPoolName: 'dhcp-lan',
      pppoeWan: doNetwork ? { user: pppoeUser, password: pppoePass, profile: 'default' } : cfg.network?.pppoeWan,
      bridge: cfg.network?.bridge || 'containers-veth',
      extHttpBase: cfg.network?.extHttpBase || 30055,
      extSocksBase: cfg.network?.extSocksBase || 31055,
    };

    fs.writeFileSync(OUT, `${JSON.stringify(cfg, null, 2)}\n`, 'utf8');
    console.log('');
    console.log(`Đã lưu ${OUT}`);
    if (doNetwork) {
      console.log(`Mạng: WAN=${wanPort} | LAN=${lanPorts.join(',')} | DHCP=${dhcpEnabled ? 'có' : 'không'}`);
    }
    if (duckDomain) {
      console.log(`DuckDNS: ${duckDomain}.duckdns.org (token đã lưu trong config)`);
    }
    if (initialProxyCount > 0) {
      console.log(`Proxy ban đầu: ${initialProxyCount} → pppoe-out1 .. pppoe-out${initialProxyCount}`);
    } else {
      console.log('Proxy ban đầu: 0 (chỉ pppoe-out1 template — bật thêm trên WebUI)');
    }
    console.log('pppoe-wan: WAN quản lý riêng — không đếm vào proxy');
    console.log(`WebUI sau setup: http://${wanHost}:${cfg.webui.port || 8088}`);
    console.log(`Login: ${cfg.webui.adminUser} / ${webuiPass}`);
    console.log('');
    console.log('Chạy: setup.bat (Windows, quyền Administrator)');
    console.log('');
  } finally {
    rl.close();
  }
}

main().catch(e => {
  console.error('\nWizard lỗi:', e.message);
  process.exit(1);
});