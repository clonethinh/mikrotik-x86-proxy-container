/**
 * Test HTTP + SOCKS5 cho tất cả proxy trong DB
 * Connect qua IP public của chính PPPoE (đúng kiến trúc multi-WAN)
 */
const { exec } = require('child_process');
const path = require('path');

process.env.DATABASE_URL = 'file:' + path.resolve(__dirname, '../../data/proxy.db').replace(/\\/g, '/');

const TEST_URL = 'https://api.ipify.org?format=json';
const TIMEOUT = 12;

function curl(proxyUrl) {
  return new Promise((resolve) => {
    const cmd = `curl -s -x "${proxyUrl}" "${TEST_URL}" --max-time ${TIMEOUT} -w "\\n%{http_code}"`;
    exec(cmd, { timeout: (TIMEOUT + 5) * 1000 }, (err, stdout) => {
      if (err) return resolve({ ok: false, error: err.message.split('\n')[0].slice(0, 120) });
      const lines = stdout.trim().split('\n');
      const code = lines.pop();
      const body = lines.join('\n').trim();
      if (code !== '200') return resolve({ ok: false, error: `HTTP ${code}: ${body.slice(0, 80)}` });
      try {
        const ip = JSON.parse(body).ip;
        resolve({ ok: true, exitIp: ip });
      } catch {
        resolve({ ok: false, error: `Bad response: ${body.slice(0, 80)}` });
      }
    });
  });
}

async function main() {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  const proxies = await prisma.proxyUser.findMany({
    where: { pppoeIdx: { gte: 2, lte: 10 } },
    orderBy: { pppoeIdx: 'asc' },
  });

  console.log(`Testing ${proxies.length} proxies (HTTP + SOCKS5)...\n`);
  const results = [];

  for (const p of proxies) {
    const host = p.publicIp;
    if (!host) {
      results.push({ idx: p.pppoeIdx, name: p.pppoeName, http: { ok: false, error: 'no public IP' }, socks: { ok: false, error: 'no public IP' } });
      console.log(`${p.pppoeName}: SKIP (no public IP)`);
      continue;
    }

    const httpUrl = `http://${p.username}:${p.password}@${host}:${p.extHttpPort}`;
    const socksUrl = `socks5h://${p.username}:${p.password}@${host}:${p.extSocksPort}`;

    process.stdout.write(`${p.pppoeName} (${host}) HTTP... `);
    const http = await curl(httpUrl);
    console.log(http.ok ? `PASS exit=${http.exitIp}` : `FAIL ${http.error}`);

    process.stdout.write(`${p.pppoeName} (${host}) SOCKS5... `);
    const socks = await curl(socksUrl);
    console.log(socks.ok ? `PASS exit=${socks.exitIp}` : `FAIL ${socks.error}`);

    const ipMatchHttp = http.ok && http.exitIp === host;
    const ipMatchSocks = socks.ok && socks.exitIp === host;

    results.push({
      idx: p.pppoeIdx,
      name: p.pppoeName,
      expectedIp: host,
      http: { ...http, ipMatch: ipMatchHttp },
      socks: { ...socks, ipMatch: ipMatchSocks },
      allPass: http.ok && socks.ok,
    });
  }

  await prisma.$disconnect();

  const httpPass = results.filter(r => r.http?.ok).length;
  const socksPass = results.filter(r => r.socks?.ok).length;
  const allPass = results.filter(r => r.allPass).length;

  console.log('\n========== SUMMARY ==========');
  console.log(`Total tested: ${results.length}`);
  console.log(`HTTP PASS:    ${httpPass}/${results.length}`);
  console.log(`SOCKS5 PASS:  ${socksPass}/${results.length}`);
  console.log(`BOTH PASS:    ${allPass}/${results.length}`);

  console.log('\n| PPPoE | HTTP | SOCKS5 | Exit IP match |');
  console.log('|-------|------|--------|---------------|');
  for (const r of results) {
    const h = r.http?.ok ? 'OK' : 'FAIL';
    const s = r.socks?.ok ? 'OK' : 'FAIL';
    const m = r.allPass && r.http?.ipMatch && r.socks?.ipMatch ? 'YES' : (r.allPass ? 'partial' : 'NO');
    console.log(`| ${r.name} | ${h} | ${s} | ${m} |`);
  }

  const fs = require('fs');
  fs.writeFileSync(path.join(__dirname, '../proxy-test-all-results.json'), JSON.stringify(results, null, 2));
  process.exit(allPass === results.length && results.length > 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });