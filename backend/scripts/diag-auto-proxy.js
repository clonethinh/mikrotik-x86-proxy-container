const { Client } = require('ssh2');
const http = require('http');

const HOST = '113.22.235.54';
const USER = 'admin';
const PASS = 'toanthinh';
const WEBUI = `http://${HOST}:8088`;

function sshExec(conn, cmd, t = 120000) {
  return new Promise((res, rej) => {
    let o = '';
    const timer = setTimeout(() => rej(new Error('timeout')), t);
    conn.exec(cmd, (e, s) => {
      if (e) { clearTimeout(timer); return rej(e); }
      s.on('close', () => { clearTimeout(timer); res(o); });
      s.on('data', d => { o += d; });
      s.stderr.on('data', d => { o += d; });
    });
  });
}

function httpJson(method, path, body, token) {
  return new Promise((res, rej) => {
    const u = new URL(path, WEBUI);
    const payload = body != null ? JSON.stringify(body) : null;
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (payload) headers['Content-Type'] = 'application/json';
    const req = http.request({
      hostname: u.hostname, port: u.port || 80, path: u.pathname, method, headers,
    }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        let j = d;
        try { j = JSON.parse(d); } catch {}
        res({ status: r.statusCode, data: j });
      });
    });
    req.on('error', rej);
    if (payload) req.write(payload);
    req.end();
  });
}

(async () => {
  console.log('=== ROUTER PPPoE ===');
  const c = new Client();
  await new Promise((r, j) => { c.on('ready', r); c.on('error', j); c.connect({ host: HOST, port: 22, username: USER, password: PASS }); });
  console.log((await sshExec(c, '/interface/pppoe-client/print')).trim());
  console.log('\n=== pppoe-out2 IP ===');
  console.log((await sshExec(c, '/ip/address/print where interface=pppoe-out2')).trim() || '(no IP yet)');
  console.log('\n=== containers ===');
  console.log((await sshExec(c, '/container/print')).trim());
  console.log('\n=== veth-3p ===');
  console.log((await sshExec(c, '/interface/veth/print where name~"veth-3p"')).trim() || '(none)');

  console.log('\n=== WebUI container logs (last 80 lines) ===');
  const logs = await sshExec(c, '/log/print where topics~"container"');
  const lines = logs.split('\n').filter(l => /webuiproxymikrotik|proxy|wan|pppoe|auto|error|fail/i.test(l));
  console.log(lines.slice(-80).join('\n') || logs.slice(-3000));

  console.log('\n=== container env AUTO_PROXY ===');
  const detail = await sshExec(c, '/container/print detail where name=webuiproxymikrotik');
  const auto = detail.match(/AUTO_PROXY[^\n]*/g) || [];
  console.log(auto.join('\n') || '(not found)');

  console.log('\n=== shell: recent app logs ===');
  const shell = await sshExec(c, '/container/shell webuiproxymikrotik cmd="tail -n 60 /proc/1/fd/1 2>/dev/null || ls -la /app/dist/services/auto/"', 60000).catch(e => e.message);
  console.log(shell.slice(-4000) || '(no shell output)');

  c.end();

  console.log('\n=== WEBUI API ===');
  const login = await httpJson('POST', '/api/auth/login', { username: 'admin', password: 'admin123' });
  if (login.status !== 200) {
    console.log('LOGIN FAILED:', login.status, login.data);
    return;
  }
  const token = login.data.token;
  const [wan, disc, proxies, settings, health] = await Promise.all([
    httpJson('GET', '/api/wan', null, token),
    httpJson('GET', '/api/wan/discovery', null, token),
    httpJson('GET', '/api/proxies', null, token),
    httpJson('GET', '/api/settings/auto-proxy', null, token),
    httpJson('GET', '/api/health'),
  ]);
  console.log('health:', health.data);
  console.log('auto-proxy settings:', settings.data);
  console.log('\nWAN list:');
  if (Array.isArray(wan.data)) wan.data.forEach(w => console.log(`  ${w.name} idx=${w.index} run=${w.running} ip=${w.publicIp} wf=${w.workflowState} hasProxy=${w.hasProxy} hasCtn=${w.hasContainer}`));
  console.log('\nDiscovery:');
  if (Array.isArray(disc.data)) disc.data.forEach(d => console.log(`  ${d.pppoeName} idx=${d.pppoeIdx} wf=${d.workflowState} err=${d.error || '-'}`));
  else console.log(disc.status, disc.data);
  console.log('\nProxies:', Array.isArray(proxies.data) ? proxies.data.length : proxies.data);
})();