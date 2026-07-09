#!/usr/bin/env node
/** Bật proxy traffic metrics trên container WebUI đang chạy (LOW_CPU + log tail 10s). */
const { spawnSync } = require('child_process');
const { loadDeployConfig, buildContainerEnv } = require('./lib/deploy-config');

const cfg = loadDeployConfig();
const env = buildContainerEnv(cfg);
const SSH_OPTS = [
  '-p', String(cfg.sshPort),
  '-o', 'StrictHostKeyChecking=no',
  '-o', `KexAlgorithms=+diffie-hellman-group1-sha1`,
  '-o', 'HostKeyAlgorithms=+ssh-rsa',
  '-o', 'PubkeyAcceptedKeyTypes=+ssh-rsa',
  '-o', 'ConnectTimeout=20',
];

function ssh(cmd) {
  const r = spawnSync(
    'sshpass',
    ['-p', cfg.pass, 'ssh', ...SSH_OPTS, `${cfg.user}@${cfg.host}`, cmd],
    { encoding: 'utf8', timeout: 120_000 },
  );
  if (r.status !== 0) throw new Error(r.stderr || r.stdout || `ssh exit ${r.status}`);
  return (r.stdout || '').trim();
}

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function waitWebui() {
  for (let i = 0; i < 30; i++) {
    await sleep(5000);
    try {
      const res = await fetch(`${cfg.webui}/api/health`);
      if (res.ok) return;
    } catch { /* booting */ }
    console.log(`[metrics] wait health ${i + 1}/30...`);
  }
  throw new Error('WebUI health timeout');
}

async function login() {
  const res = await fetch(`${cfg.webui}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: cfg.adminPass }),
  });
  const j = await res.json();
  if (!j.token) throw new Error('login failed');
  return j.token;
}

async function main() {
  const esc = env.replace(/"/g, '\\"');
  console.log('[metrics] Updating container env + restart...');
  ssh(`/container/set [find name=webuiproxymikrotik] logging=no env="${esc}"`);
  ssh(':do {/container/stop [find name=webuiproxymikrotik]} on-error={}');
  await sleep(10_000);
  ssh(':do {/container/start [find name=webuiproxymikrotik]} on-error={}');
  await waitWebui();

  const token = await login();
  console.log('[metrics] Trigger hub log tail once...');
  const tail = await fetch(`${cfg.webui}/api/system/logs/tail`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  const tailOut = await tail.json().catch(() => ({}));
  console.log('[metrics] tail:', JSON.stringify(tailOut));

  const live = await fetch(`${cfg.webui}/api/proxies/metrics/live-all`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => r.json());
  const active = Array.isArray(live)
    ? live.filter((x) => (x.clients || 0) > 0 || (x.rxBps || 0) > 0 || (x.txBps || 0) > 0).length
    : 0;
  console.log(JSON.stringify({
    ok: true,
    proxies: live?.length ?? 0,
    withLiveTraffic: active,
    hubRequestLog: true,
    logsTailMs: 10000,
    metricsPollMs: 10000,
  }));
}

main().catch((e) => {
  console.error('enable-proxy-metrics failed:', e.message);
  process.exit(1);
});