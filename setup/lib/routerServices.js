/**
 * Bật SSH (và www cho REST) trên router — factory reset thường tắt hoặc chưa dùng được từ PC.
 */
const http = require('http');
const { connect, exec } = require('./ssh');

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function restRequest(cfg, method, path, body) {
  const payload = body != null ? JSON.stringify(body) : null;
  const port = cfg.router.restPort || 80;
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: cfg.router.host,
      port,
      path,
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${cfg.router.sshUser}:${cfg.router.sshPass}`).toString('base64')}`,
        ...(payload ? {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        } : {}),
      },
      timeout: 20_000,
    }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('REST timeout')); });
    if (payload) req.write(payload);
    req.end();
  });
}

async function enableSshViaRest(cfg) {
  const sshPort = cfg.router.sshPort || 22222;
  const tries = [
    { method: 'PATCH', path: '/rest/ip/service/ssh', body: { disabled: false, port: String(sshPort) } },
    { method: 'POST', path: '/rest/ip/service/set', body: { '.id': '*ssh', disabled: false, port: String(sshPort) } },
  ];
  let lastErr = null;
  for (const t of tries) {
    try {
      const r = await restRequest(cfg, t.method, t.path, t.body);
      if (r.status >= 200 && r.status < 300) return true;
      lastErr = new Error(`REST ${t.method} ${t.path} → ${r.status}`);
    } catch (e) {
      lastErr = e;
    }
  }
  // Bật www để lần sau REST được (factory đôi khi tắt)
  try {
    await restRequest(cfg, 'PATCH', '/rest/ip/service/www', { disabled: false, port: '80' });
  } catch { /* ignore */ }
  if (lastErr) throw lastErr;
  return false;
}

async function ensureSshEnabled(conn, cfg) {
  const port = cfg.router.sshPort || 22222;
  await exec(conn, `/ip/service/set ssh disabled=no port=${port}`, 15_000);
  try {
    await exec(conn, '/ip/service/set www disabled=no port=80', 10_000);
  } catch { /* www optional */ }

  const st = await exec(conn, '/ip/service/print detail where name=ssh', 10_000);
  if (/disabled=yes/i.test(st)) throw new Error('SSH vẫn disabled sau khi set');
  return true;
}

/** Kết nối SSH; nếu fail thì thử bật SSH qua REST (www :80) rồi thử lại. */
async function connectWithSshBootstrap(cfg) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const conn = await connect(cfg);
      await ensureSshEnabled(conn, cfg);
      return conn;
    } catch (e) {
      lastErr = e;
      if (attempt === 0) {
        try {
          await enableSshViaRest(cfg);
          await sleep(2500);
        } catch (restErr) {
          lastErr = new Error(`${e.message} (REST bật SSH: ${restErr.message})`);
        }
      }
    }
  }
  throw lastErr || new Error('Không kết nối SSH được — vào Winbox bật IP → Services → SSH');
}

module.exports = {
  connectWithSshBootstrap,
  ensureSshEnabled,
  enableSshViaRest,
};