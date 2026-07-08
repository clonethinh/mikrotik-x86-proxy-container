const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { step } = require('../lib/logger');

function runCmd(cmd, cwd) {
  step('10-build', `> ${cmd}`);
  execSync(cmd, { stdio: 'inherit', cwd, shell: true });
}

function pythonCmd() {
  try {
    execSync('python3 --version', { stdio: 'ignore', shell: true });
    return 'python3';
  } catch {
    try {
      execSync('python --version', { stdio: 'ignore', shell: true });
      return 'python';
    } catch {
      return 'py';
    }
  }
}

async function run(cfg) {
  if (cfg.options.skipBuild) {
    step('10-build', 'Skipped (options.skipBuild=true)');
    if (!fs.existsSync(cfg.paths.tarDocker) && !fs.existsSync(cfg.paths.tarOci)) {
      throw new Error('skipBuild but no webuiproxymikrotik.docker.tar or .tar found');
    }
    return { ok: true, skipped: true };
  }

  step('10-build', 'Building frontend...');
  runCmd('npm run build', path.join(cfg.root, 'frontend'));

  step('10-build', 'Docker buildx (linux/amd64)...');
  runCmd('docker buildx build --platform linux/amd64 -t webuiproxymikrotik:latest --load .', cfg.root);

  step('10-build', 'Saving OCI image...');
  runCmd(`docker save webuiproxymikrotik:latest -o "${cfg.paths.tarOci}"`, cfg.root);

  step('10-build', 'Converting to RouterOS docker tar...');
  const py = pythonCmd();
  const script = path.join(cfg.root, 'scripts/_oci_to_docker.py');
  runCmd(`${py} "${script}" "${cfg.root.replace(/\\/g, '/')}"`, cfg.root);

  if (!fs.existsSync(cfg.paths.tarDocker)) {
    step('10-build', 'Converter missing output — using OCI tar as fallback');
    fs.copyFileSync(cfg.paths.tarOci, cfg.paths.tarDocker);
  }

  const mb = (fs.statSync(cfg.paths.tarDocker).size / 1024 / 1024).toFixed(1);
  step('10-build', `WebUI image ready: ${cfg.paths.tarDocker} (${mb} MiB)`);

  if (cfg.options.upload3proxyHubTar) {
    step('10-build', 'Building 3proxy-hub image (multi-slot)...');
    const buildHub = path.join(cfg.root, 'scripts/build-3proxy-hub.sh');
    runCmd(`bash "${buildHub}"`, cfg.root);
    if (!fs.existsSync(cfg.paths.tar3proxyHub)) {
      throw new Error('3proxy-hub.tar missing after build');
    }
    const hubMb = (fs.statSync(cfg.paths.tar3proxyHub).size / 1024 / 1024).toFixed(1);
    step('10-build', `Hub image ready: ${cfg.paths.tar3proxyHub} (${hubMb} MiB)`);
  }

  return { ok: true, tarMb: mb };
}

module.exports = { run };

if (require.main === module) {
  const { loadConfig } = require('../lib/config');
  run(loadConfig())
    .then(() => process.exit(0))
    .catch((e) => { console.error(e.message); process.exit(1); });
}