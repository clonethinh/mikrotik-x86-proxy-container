#!/usr/bin/env node
/**
 * Wizard tối giản — tạo setup.config.json cho router MikroTik mới.
 * Chỉ hỏi: host, SSH pass, (tuỳ chọn) pass WebUI.
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ROOT = path.resolve(__dirname, '..');
const TEMPLATE = path.join(ROOT, 'setup.config.minimal.json');
const OUT = process.env.SETUP_CONFIG || path.join(ROOT, 'setup.config.json');

function ask(rl, question, def = '') {
  const hint = def ? ` [${def}]` : '';
  return new Promise(resolve => {
    rl.question(`${question}${hint}: `, answer => {
      resolve((answer || '').trim() || def);
    });
  });
}

async function main() {
  console.log('');
  console.log('============================================================');
  console.log('  webuiproxymikrotik — Setup wizard (router mới)');
  console.log('============================================================');
  console.log('');
  console.log('Yêu cầu router: RouterOS 7.4+, package container, pppoe-wan UP');
  console.log('Máy PC: Node.js + Docker Desktop');
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
    const host = await ask(rl, 'Router host (IP hoặc DuckDNS)', '');
    if (!host) throw new Error('Cần router host');

    const sshPass = await ask(rl, 'SSH password (admin)', '');
    if (!sshPass) throw new Error('Cần SSH password');

    const wanHost = await ask(rl, 'WAN host cho WebUI (thường = host router)', host);
    const webuiPass = await ask(rl, 'WebUI admin password', 'admin123');
    const shardCount = await ask(rl, 'Số hub shard (1 shard = 50 proxy)', '2');

    const cfg = JSON.parse(fs.readFileSync(TEMPLATE, 'utf8'));
    cfg.router.host = host;
    cfg.router.sshPass = sshPass;
    cfg.wan.host = wanHost;
    cfg.webui.adminPass = webuiPass;
    cfg.hub.shardCount = Math.max(1, Math.min(6, parseInt(shardCount, 10) || 2));
    cfg.hub.maxPppoeOut = cfg.hub.shardCount * (cfg.hub.shardSize || 50);

    fs.writeFileSync(OUT, `${JSON.stringify(cfg, null, 2)}\n`, 'utf8');
    console.log('');
    console.log(`Đã lưu ${OUT}`);
    console.log(`WebUI sau setup: http://${wanHost}:${cfg.webui.port || 8088}`);
    console.log(`Login: ${cfg.webui.adminUser} / ${webuiPass}`);
    console.log('');
    console.log('Chạy tiếp: npm run setup   hoặc   ./setup.sh   hoặc   setup.bat');
    console.log('');
  } finally {
    rl.close();
  }
}

main().catch(e => {
  console.error('\nWizard lỗi:', e.message);
  process.exit(1);
});