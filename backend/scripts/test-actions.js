const http = require('http');

function req(m, p, b, h) {
  return new Promise((res, rej) => {
    const r = http.request({ hostname: '113.22.235.54', port: 8088, path: p, method: m, headers: h }, s => {
      let d = '';
      s.on('data', c => d += c);
      s.on('end', () => res({ s: s.statusCode, d }));
    });
    r.on('error', rej);
    if (b) r.write(b);
    r.end();
  });
}

(async () => {
  const login = await req('POST', '/api/auth/login', JSON.stringify({ username: 'admin', password: 'admin123' }), { 'Content-Type': 'application/json' });
  const token = JSON.parse(login.d).token;
  const auth = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  const wan = JSON.parse((await req('GET', '/api/wan', null, { Authorization: 'Bearer ' + token })).d);
  const row = wan.find(w => w.proxyId);
  console.log('Testing', row.name, 'proxyId', row.proxyId);

  const test = await req('POST', `/api/proxies/${row.proxyId}/test`, null, auth);
  console.log('test:', test.s, test.d.includes('Bad Request') ? 'STILL BAD REQUEST' : test.d.slice(0, 100));

  const cancel = await req('POST', `/api/wan/${row.index}/provision/cancel`, null, auth);
  console.log('provision/cancel:', cancel.s, cancel.d.slice(0, 80));
})();