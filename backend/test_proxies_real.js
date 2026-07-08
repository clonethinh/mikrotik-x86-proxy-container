const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const targetIp = '113.22.235.54';
const testUrl = 'http://api.ipify.org/?format=json';

// Read proxies from all_proxies.json
const rawProxies = JSON.parse(fs.readFileSync(path.join(__dirname, 'all_proxies.json'), 'utf8'));

function runCurl(proxyUrl) {
  return new Promise((resolve) => {
    // -s: silent, -x: proxy, --max-time: timeout, -w: format output time
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
  
  for (const p of rawProxies) {
    if (!p.enabled) {
      console.log(`Skipping Disabled Proxy ${p.pppoeName} (idx ${p.pppoeIdx})`);
      continue;
    }
    console.log(`Checking Proxy ${p.pppoeName} (idx ${p.pppoeIdx})...`);
    
    // Test HTTP
    const httpUrl = `http://${p.username}:${p.password}@${targetIp}:${p.extHttpPort}`;
    const httpRes = await runCurl(httpUrl);
    
    // Test SOCKS5
    const socksUrl = `socks5h://${p.username}:${p.password}@${targetIp}:${p.extSocksPort}`;
    const socksRes = await runCurl(socksUrl);
    
    const result = {
      pppoeName: p.pppoeName,
      pppoeIdx: p.pppoeIdx,
      username: p.username,
      password: p.password,
      expectedPublicIp: p.publicIp,
      http: {
        port: p.extHttpPort,
        ok: httpRes.ok,
        ip: httpRes.ip || null,
        timeMs: httpRes.time || null,
        error: httpRes.error || null
      },
      socks5: {
        port: p.extSocksPort,
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
  
  fs.writeFileSync(path.join(__dirname, 'proxy_test_results_real.json'), JSON.stringify(results, null, 2));
  console.log(`\nResults saved to proxy_test_results_real.json`);
}

main();
