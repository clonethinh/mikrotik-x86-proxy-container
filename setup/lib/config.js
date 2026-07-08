const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');

function loadConfig() {
  const cfgPath = process.env.SETUP_CONFIG || path.join(ROOT, 'setup.config.json');
  const example = path.join(ROOT, 'setup.config.example.json');
  if (!fs.existsSync(cfgPath)) {
    if (fs.existsSync(example)) {
      throw new Error(`Chưa có setup.config.json — copy từ setup.config.example.json và điền sshPass`);
    }
    throw new Error('Missing setup.config.json');
  }
  const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  if (!raw.router?.host || !raw.router?.sshPass || raw.router.sshPass === 'CHANGE_ME') {
    throw new Error('setup.config.json: điền router.host và router.sshPass');
  }
  let sshPort = raw.router.sshPort || 22222;
  try {
    const accessPath = path.join(ROOT, 'router-access.json');
    if (fs.existsSync(accessPath)) {
      const access = JSON.parse(fs.readFileSync(accessPath, 'utf8'));
      if (access?.ssh?.port) sshPort = access.ssh.port;
    }
  } catch { /* ignore */ }
  return {
    root: ROOT,
    router: {
      host: raw.router.host,
      sshUser: raw.router.sshUser || 'admin',
      sshPass: raw.router.sshPass,
      sshPort,
    },
    wan: {
      host: raw.wan?.host || '',
      managementPppoe: raw.wan?.managementPppoe || 'pppoe-wan',
      duckDomain: raw.wan?.duckDomain || '',
      duckToken: raw.wan?.duckToken || '',
    },
    webui: {
      adminUser: raw.webui?.adminUser || 'admin',
      adminPass: raw.webui?.adminPass || 'admin123',
      jwtSecret: raw.webui?.jwtSecret || 'webuiproxymikrotik-change-in-prod-32chars-x',
      port: raw.webui?.port || 8088,
    },
    autoProxy: {
      mode: raw.autoProxy?.mode || 'semi',
      pollMs: raw.autoProxy?.pollMs || 20000,
      countdownMs: raw.autoProxy?.countdownMs || 8000,
      maxConcurrent: raw.autoProxy?.maxConcurrent || 16,
      staleTtlMs: raw.autoProxy?.staleTtlMs || 1800000,
    },
    network: raw.network || {},
    threeProxy: {
      tarball: raw.threeProxy?.tarball || 'disk1/3proxy.tar',
      hubTarball: raw.threeProxy?.hubTarball || 'disk1/3proxy-hub.tar',
      hubImage: raw.threeProxy?.hubImage || 'webuiproxymikrotik/3proxy-hub:2',
    },
    proxy: {
      deployMode: raw.proxy?.deployMode || 'hub',
    },
    hub: {
      shardSize: raw.hub?.shardSize || 50,
      shardCount: raw.hub?.shardCount || 2,
      maxPppoeOut: raw.hub?.maxPppoeOut || 100,
    },
    mode: resolveMode(raw.mode),
    options: {
      skipBuild: !!raw.options?.skipBuild,
      skipCleanup: !!raw.options?.skipCleanup,
      upload3proxyTar: raw.options?.upload3proxyTar !== false,
      upload3proxyHubTar: raw.options?.upload3proxyHubTar !== false,
      purgeDbOnFresh: raw.options?.purgeDbOnFresh !== false,
    },
    setup: {
      fullSystem: raw.setup?.fullSystem !== false,
      importRouterScripts: raw.setup?.importRouterScripts !== false,
      ensureRouterScriptsApi: raw.setup?.ensureRouterScriptsApi !== false,
      syncClock: raw.setup?.syncClock !== false,
      autoProvisionRunningWan: raw.setup?.autoProvisionRunningWan !== false,
      wanDiscoveryWaitSec: raw.setup?.wanDiscoveryWaitSec || 120,
      provisionDelayMs: raw.setup?.provisionDelayMs || 12_000,
      maxProvisionWaitSec: raw.setup?.maxProvisionWaitSec || 900,
      initialProxyCount: Math.max(0, parseInt(String(raw.setup?.initialProxyCount ?? 0), 10) || 0),
    },
    paths: {
      tarOci: path.join(ROOT, 'webuiproxymikrotik.tar'),
      tarDocker: path.join(ROOT, 'webuiproxymikrotik.docker.tar'),
      tar3proxyHub: path.join(ROOT, '3proxy-hub.tar'),
      tar3proxyLegacy: path.join(ROOT, '3proxy.tar'),
      mikrotikDir: path.join(ROOT, 'mikrotik'),
      report: path.join(ROOT, 'setup-report.json'),
    },
    webuiUrl: `http://${raw.wan?.host || raw.router.host}:${raw.webui?.port || 8088}`,
  };
}

function resolveMode(rawMode) {
  const name = rawMode || 'fresh+cleanup';
  const cleanup = name.includes('cleanup') || name === 'reset';
  const fresh = name.startsWith('fresh') || name === 'reset';
  return { name, fresh, cleanup };
}

module.exports = { loadConfig, ROOT, resolveMode };