const http = require('http');

const WEBUI = process.env.WEBUI_URL || 'http://113.22.235.54:8088';

function req(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const u = new URL(path, WEBUI);
    const payload = body !== undefined ? JSON.stringify(body) : null;
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (payload) headers['Content-Type'] = 'application/json';
    const r = http.request({ hostname: u.hostname, port: u.port || 80, path: u.pathname, method, headers }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(d) }); }
        catch { resolve({ status: res.statusCode, data: d }); }
      });
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

(async () => {
  const login = await req('POST', '/api/auth/login', { username: 'admin', password: 'admin123' });
  if (login.status !== 200) throw new Error('login failed: ' + JSON.stringify(login.data));
  const token = login.data.token;

  const [proxies, wan, dash, disc] = await Promise.all([
    req('GET', '/api/proxies', undefined, token),
    req('GET', '/api/wan', undefined, token),
    req('GET', '/api/dashboard', undefined, token),
    req('GET', '/api/wan/discovery', undefined, token),
  ]);

  console.log('=== DB STATE ===');
  console.log('ProxyUser:', Array.isArray(proxies.data) ? proxies.data.length : proxies.data);
  if (Array.isArray(proxies.data) && proxies.data.length) {
    proxies.data.forEach(p => console.log(`  - id=${p.id} ${p.pppoeName} status=${p.status} ip=${p.publicIp}`));
  }
  console.log('Wan (live):', Array.isArray(wan.data) ? wan.data.map(w => `${w.name} ${w.publicIp || 'no-ip'}`).join(', ') : wan.data);
  console.log('Dashboard:', {
    totalProxies: dash.data?.totalProxies,
    runningProxies: dash.data?.runningProxies,
    totalWan: dash.data?.totalWan,
  });
  console.log('WanDiscovery:', Array.isArray(disc.data) ? disc.data.length : disc.status, disc.status === 200 && disc.data?.length
    ? disc.data.slice(0, 5).map(d => `${d.pppoeName} ${d.workflowState}`).join(', ')
    : '');

  console.log('purge-fleet available: (skipped — read-only check)');
})();