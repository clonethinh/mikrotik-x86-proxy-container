const fs = require('fs');
const path = require('path');
const { connect, exec, sftpPut } = require('../lib/ssh');
const { step } = require('../lib/logger');

async function ensureRemoteDir(conn, remoteDir) {
  await exec(conn, `:do {/file/add name=${remoteDir} type=directory} on-error={}`).catch(() => {});
}

async function uploadMikrotikScripts(conn, cfg) {
  const remoteBase = 'disk1/webuiproxymikrotik';
  await ensureRemoteDir(conn, remoteBase);
  const localDir = cfg.paths.mikrotikDir;
  const files = fs.readdirSync(localDir).filter(f => f.endsWith('.rsc'));
  for (const f of files) {
    const local = path.join(localDir, f);
    const remote = `/${remoteBase}/${f}`;
    const n = await sftpPut(conn, local, remote);
    step('20-upload', `${f} (${(n / 1024).toFixed(0)} KiB)`);
  }
}

async function run(cfg) {
  const tarLocal = fs.existsSync(cfg.paths.tarDocker)
    ? cfg.paths.tarDocker
    : cfg.paths.tarOci;
  if (!fs.existsSync(tarLocal)) {
    throw new Error(`Image tar missing: ${tarLocal}`);
  }

  const conn = await connect(cfg);
  try {
    step('20-upload', 'Removing old webuiproxymikrotik.tar on router...');
    await exec(conn, `:do {/file/remove [find name~"webuiproxymikrotik.tar"]} on-error={}`).catch(() => {});

    step('20-upload', `Uploading ${path.basename(tarLocal)}...`);
    const bytes = await sftpPut(conn, tarLocal, '/disk1/webuiproxymikrotik.tar');
    step('20-upload', `webuiproxymikrotik.tar (${(bytes / 1024 / 1024).toFixed(1)} MiB)`);

    step('20-upload', 'Uploading mikrotik/*.rsc...');
    await uploadMikrotikScripts(conn, cfg);

    if (cfg.options.upload3proxyHubTar) {
      const localHub = cfg.paths.tar3proxyHub;
      if (!fs.existsSync(localHub)) {
        throw new Error(`Missing ${localHub} — chạy build (npm run setup) hoặc npm run build:3proxy-hub`);
      }
      step('20-upload', 'Uploading 3proxy-hub.tar...');
      await exec(conn, `:do {/file/remove [find name=${cfg.threeProxy.hubTarball}]} on-error={}`).catch(() => {});
      const nHub = await sftpPut(conn, localHub, `/${cfg.threeProxy.hubTarball}`);
      step('20-upload', `3proxy-hub.tar (${(nHub / 1024 / 1024).toFixed(1)} MiB)`);
    }

    if (cfg.options.upload3proxyTar) {
      const local3p = cfg.paths.tar3proxyLegacy;
      if (fs.existsSync(local3p)) {
        step('20-upload', 'Uploading 3proxy.tar (legacy)...');
        const n = await sftpPut(conn, local3p, `/${cfg.threeProxy.tarball}`);
        step('20-upload', `3proxy.tar (${(n / 1024 / 1024).toFixed(1)} MiB)`);
      } else {
        step('20-upload', 'Skip 3proxy.tar — không có file local (hub mode không bắt buộc)');
      }
    }
  } finally {
    conn.end();
  }
  return { ok: true };
}

module.exports = { run };