const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { exec } = require('../lib/ssh');
const { connectWithSshBootstrap } = require('../lib/routerServices');
const { step, warn } = require('../lib/logger');

function checkCmd(cmd, args = ['--version']) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', shell: true });
  if (r.status !== 0) throw new Error(`${cmd} not available`);
  return (r.stdout || r.stderr || '').trim().split('\n')[0];
}

async function run(cfg) {
  step('00-preflight', 'Checking local tools...');
  const nodeVer = checkCmd('node', ['-v']);
  step('00-preflight', `Node ${nodeVer}`);

  try {
    const dockerVer = checkCmd('docker', ['--version']);
    step('00-preflight', `Docker ${dockerVer}`);
  } catch {
    throw new Error('Docker required — install Docker Desktop');
  }

  try {
    const pyVer = checkCmd('python3', ['--version']);
    step('00-preflight', `Python ${pyVer}`);
  } catch {
    try {
      const pyVer = checkCmd('python', ['--version']);
      step('00-preflight', `Python ${pyVer}`);
    } catch {
      try {
        const pyVer = checkCmd('py', ['--version']);
        step('00-preflight', `Python ${pyVer}`);
      } catch {
        throw new Error('Python required for OCI→Docker tar conversion');
      }
    }
  }

  if (!fs.existsSync(path.join(cfg.root, 'Dockerfile'))) {
    throw new Error('Dockerfile missing at repo root');
  }
  if (!fs.existsSync(path.join(cfg.root, 'frontend/package.json'))) {
    throw new Error('frontend/package.json missing');
  }

  step('00-preflight', `SSH ${cfg.router.sshUser}@${cfg.router.host}:${cfg.router.sshPort}...`);
  const conn = await connectWithSshBootstrap(cfg);
  try {
    step('00-preflight', 'SSH service enabled (auto)');
    const identity = await exec(conn, '/system/identity/print');
    step('00-preflight', `Router: ${identity.match(/name:\s*(.+)/)?.[1]?.trim() || 'connected'}`);

    if (cfg.network?.configure) {
      step('00-preflight', 'network.configure=true — pppoe-wan sẽ tạo ở bước network-bootstrap');
    } else {
      const pppoe = await exec(conn, `/interface/pppoe-client/print where name=${cfg.wan.managementPppoe}`);
      if (!pppoe.includes(cfg.wan.managementPppoe)) {
        if (cfg.mode.fresh && cfg.options.skipCleanup) {
          warn(`${cfg.wan.managementPppoe} chưa có — tạo WAN quản lý trên router trước khi provision proxy`);
        } else {
          throw new Error(`${cfg.wan.managementPppoe} not found on router`);
        }
      } else if (!pppoe.includes(' R ') && !pppoe.toLowerCase().includes('running')) {
        warn(`${cfg.wan.managementPppoe} exists but may not be running`);
      } else {
        step('00-preflight', `${cfg.wan.managementPppoe} running`);
      }
    }

    if (cfg.proxy.deployMode === 'hub') {
      const hubTar = await exec(conn, `/file/print where name=${cfg.threeProxy.hubTarball}`);
      if (!hubTar.includes('3proxy-hub')) {
        step('00-preflight', `${cfg.threeProxy.hubTarball} will be uploaded in setup`);
      } else {
        step('00-preflight', `${cfg.threeProxy.hubTarball} present on router`);
      }
    } else {
      const proxyTar = await exec(conn, `/file/print where name=${cfg.threeProxy.tarball}`);
      if (!proxyTar.includes('3proxy')) {
        warn(`${cfg.threeProxy.tarball} not found — provision proxies will fail until uploaded`);
      } else {
        step('00-preflight', `${cfg.threeProxy.tarball} present`);
      }
    }

    if (!fs.existsSync(cfg.paths.tar3proxyHub) && cfg.options.upload3proxyHubTar && !cfg.options.skipBuild) {
      step('00-preflight', '3proxy-hub.tar will be built in setup step');
    }
  } finally {
    conn.end();
  }

  step('00-preflight', `Mode: ${cfg.mode.name} | cleanup=${cfg.mode.cleanup} | skipBuild=${cfg.options.skipBuild}`);
  return { ok: true };
}

module.exports = { run };