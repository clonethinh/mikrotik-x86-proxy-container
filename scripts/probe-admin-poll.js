process.chdir('/app');
const http = require('http');
const { getHubMonitorPassword } = require('/app/dist/services/proxy/HubConfigService');

function fetch(host, port, path, auth, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host, port, path, method: 'GET',
      headers: { Authorization: `Basic ${auth}`, Connection: 'close' },
      timeout: timeoutMs,
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  const pass = await getHubMonitorPassword();
  const auth = Buffer.from(`_webui_mon:${pass}`).toString('base64');
  for (const host of ['172.18.0.2', '172.18.0.3', '172.17.0.1', '127.0.0.1']) {
    try {
      const r = await fetch(host, 31800, '/S', auth, 5000);
      console.log(host, r.status, 'len', r.body.length, 'u4899', r.body.includes('u4899'));
    } catch (e) {
      console.log(host, 'ERR', e.message);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });