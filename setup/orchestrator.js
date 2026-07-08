#!/usr/bin/env node
/**
 * 1-click setup — mode fresh+cleanup
 * Pipeline: preflight → build → cleanup → upload → router/deploy → purge → verify
 */
const { assertWindowsAdmin } = require('./lib/platform');
const { loadConfig } = require('./lib/config');

assertWindowsAdmin();
const { step, warn, finish, writeReport } = require('./lib/logger');
const preflight = require('./steps/preflight');
const networkBootstrap = require('./steps/network-bootstrap');
const build = require('./steps/build');
const cleanup = require('./steps/cleanup');
const upload = require('./steps/upload');
const router = require('./steps/router');
const hubPrep = require('./steps/hub-prep');
const prerequisites = require('./steps/prerequisites');
const purge = require('./steps/purge');
const fleetBootstrap = require('./steps/fleet-bootstrap');
const verify = require('./steps/verify');

const STEPS = [
  ['preflight', preflight],
  ['network-bootstrap', networkBootstrap],
  ['build', build],
  ['cleanup', cleanup],
  ['upload', upload],
  ['prerequisites', prerequisites],
  ['router', router],
  ['hub-prep', hubPrep],
  ['purge', purge],
  ['fleet-bootstrap', fleetBootstrap],
  ['verify', verify],
];

function applyCliOverrides(cfg, argv) {
  if (argv.includes('--skip-build')) cfg.options.skipBuild = true;
  if (argv.includes('--skip-cleanup')) cfg.options.skipCleanup = true;
  if (argv.includes('--no-purge-db')) cfg.options.purgeDbOnFresh = false;
  return {
    preflightOnly: argv.includes('--preflight-only'),
    fromStep: (() => {
      const i = argv.indexOf('--from');
      return i >= 0 ? argv[i + 1] : null;
    })(),
  };
}

async function main() {
  const cli = { preflightOnly: false, fromStep: null };
  let cfg;
  try {
    cfg = loadConfig();
    Object.assign(cli, applyCliOverrides(cfg, process.argv.slice(2)));
  } catch (e) {
    console.error('\nSETUP CONFIG ERROR:', e.message);
    console.error('\nChạy setup.bat (tự chạy wizard) hoặc copy setup.config.example.json → setup.config.json');
    process.exit(1);
  }

  console.log('============================================================');
  console.log('  webuiproxymikrotik — 1-click setup HỆ THỐNG PROXY (Windows)');
  console.log(`  Target: ${cfg.router.host} | Mode: ${cfg.mode.name}`);
  console.log(`  WebUI:  ${cfg.webuiUrl}`);
  if (cfg.network?.configure) {
    console.log(`  Network: WAN=${cfg.network.wanPort} LAN=${(cfg.network.lanPorts || []).join(',')} DHCP=${cfg.network.dhcpEnabled !== false}`);
  }
  if (cfg.setup?.fullSystem !== false) {
    console.log('  Fleet:  router scripts + hub + auto-provision pppoe-out RUNNING');
  }
  console.log('============================================================\n');

  const results = {};
  let started = !cli.fromStep;

  for (const [name, mod] of STEPS) {
    if (!started) {
      if (name === cli.fromStep) started = true;
      else continue;
    }
    if (cli.preflightOnly && name !== 'preflight') break;
    try {
      results[name] = await mod.run(cfg);
    } catch (e) {
      console.error(`\n[FAILED @ ${name}] ${e.message}`);
      if (e.stack) console.error(e.stack.split('\n').slice(1, 4).join('\n'));
      const report = finish(false, { failedStep: name, error: e.message, results });
      writeReport(cfg.paths.report, report);
      process.exit(1);
    }
  }

  const v = results.verify || {};
  const report = finish(v.ok !== false, {
    mode: cfg.mode.name,
    webuiUrl: cfg.webuiUrl,
    router: cfg.router.host,
    checks: v.checks,
    results: Object.fromEntries(Object.entries(results).map(([k, val]) => [k, { ok: val?.ok, skipped: val?.skipped }])),
  });
  writeReport(cfg.paths.report, report);

  console.log('\n============================================================');
  if (report.success) {
    console.log('  SETUP COMPLETE');
    console.log(`  WebUI: ${cfg.webuiUrl}`);
    console.log(`  Login: ${cfg.webui.adminUser} / ${cfg.webui.adminPass}`);
    console.log(`  Report: ${cfg.paths.report} (${report.durationSec}s)`);
  } else {
    console.log('  SETUP FINISHED WITH WARNINGS — xem setup-report.json');
    if (report.warnings?.length) report.warnings.forEach(w => console.log(`  - ${w}`));
  }
  console.log('============================================================\n');

  process.exit(report.success ? 0 : 2);
}

main().catch(e => {
  console.error('\nSETUP CRASHED:', e.message);
  process.exit(1);
});