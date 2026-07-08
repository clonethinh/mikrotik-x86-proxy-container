const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const proxies = [
  { idx: 2, user: 'u002', pass: 'test1234', http: 30057, socks: 31057, pppoe: 'pppoe-out2' },
  { idx: 3, user: 'u003', pass: 'test1234', http: 30058, socks: 31058, pppoe: 'pppoe-out3' },
  { idx: 4, user: 'u004', pass: 'test1234', http: 30059, socks: 31059, pppoe: 'pppoe-out4' },
  { idx: 5, user: 'u005', pass: 'test1234', http: 30060, socks: 31060, pppoe: 'pppoe-out5' },
  { idx: 6, user: 'u006', pass: 'test1234', http: 30061, socks: 31061, pppoe: 'pppoe-out6' },
  { idx: 7, user: 'u007', pass: 'test1234', http: 30062, socks: 31062, pppoe: 'pppoe-out7' },
  { idx: 8, user: 'u008', pass: 'test1234', http: 30063, socks: 31063, pppoe: 'pppoe-out8' },
  { idx: 9, user: 'u009', pass: 'test1234', http: 30064, socks: 31064, pppoe: 'pppoe-out9' },
  { idx: 10, user: 'u010', pass: 'test1234', http: 30065, socks: 31065, pppoe: 'pppoe-out10' }
];

const targetIp = '113.22.235.54';
const testUrl = 'http://api.ipify.org/?format=json';

function runCurl(proxyUrl) {
  return new Promise((resolve) => {
    const cmd = `curl -s -x "${proxyUrl}" "${testUrl}" --max-time 8 -w "\\n%{time_total}"`;
    const start = Date.now();
    exec(cmd, (err, stdout, stderr) => {
      const duration = Date.now() - start;
      if (err) {
        resolve({ ok: false, error: err.message.trim(), duration });
        return;
      }
      
      const lines = stdout.trim().split('\n');
      const timeStr = lines.pop();
      const responseBody = lines.join('\n').trim();
      
      try {
        const json = JSON.parse(responseBody);
        resolve({ ok: true, ip: json.ip, time: parseFloat(timeStr) * 1000, duration });
      } catch (e) {
        resolve({ ok: false, error: `Invalid JSON response: ${responseBody.slice(0, 100)}`, duration });
      }
    });
  });
}

async function main() {
  console.log(`Starting Proxy Validation on Host: ${targetIp}\n`);
  const results = [];
  
  for (const p of proxies) {
    console.log(`Checking Proxy ${p.pppoe} (idx ${p.idx})...`);
    
    // Test HTTP
    const httpUrl = `http://${p.user}:${p.pass}@${targetIp}:${p.http}`;
    const httpRes = await runCurl(httpUrl);
    
    // Test SOCKS5
    const socksUrl = `socks5h://${p.user}:${p.pass}@${targetIp}:${p.socks}`;
    const socksRes = await runCurl(socksUrl);
    
    const result = {
      pppoe: p.pppoe,
      idx: p.idx,
      http: {
        port: p.http,
        ok: httpRes.ok,
        ip: httpRes.ip || null,
        timeMs: httpRes.time || null,
        error: httpRes.error || null
      },
      socks5: {
        port: p.socks,
        ok: socksRes.ok,
        ip: socksRes.ip || null,
        timeMs: socksRes.time || null,
        error: socksRes.error || null
      }
    };
    
    console.log(`  HTTP   : ${result.http.ok ? `PASS (${result.http.ip}, ${result.http.timeMs.toFixed(0)}ms)` : `FAIL (${result.http.error})`}`);
    console.log(`  SOCKS5 : ${result.socks5.ok ? `PASS (${result.socks5.ip}, ${result.socks5.timeMs.toFixed(0)}ms)` : `FAIL (${result.socks5.error})`}`);
    results.push(result);
  }
  
  fs.writeFileSync(path.join(__dirname, 'proxy_test_results.json'), JSON.stringify(results, null, 2));
  console.log(`\nResults saved to proxy_test_results.json`);
}

main();
