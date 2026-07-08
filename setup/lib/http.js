const http = require('http');
const https = require('https');

function request(method, url, body, token) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = body != null ? JSON.stringify(body) : null;
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method,
      headers,
      timeout: 30000,
    }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        let parsed = data;
        try { parsed = JSON.parse(data); } catch {}
        resolve({ status: res.statusCode, data: parsed, raw: data });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error(`HTTP timeout ${method} ${url}`)); });
    if (payload) req.write(payload);
    req.end();
  });
}

async function login(webuiUrl, username, password) {
  const res = await request('POST', `${webuiUrl}/api/auth/login`, { username, password });
  if (res.status !== 200 || !res.data?.token) {
    throw new Error(`Login failed (${res.status}): ${res.raw?.slice?.(0, 200) || res.data}`);
  }
  return res.data.token;
}

module.exports = { request, login };