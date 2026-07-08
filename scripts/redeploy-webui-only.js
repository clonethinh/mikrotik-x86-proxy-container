#!/usr/bin/env node
/** Upload webuiproxymikrotik.docker.tar + redeploy container (keep DB). */
const fs = require('fs');
const path = require('path');
const { loadConfig } = require('../setup/lib/config');
const { connect, exec, sftpPut, nextRootDir } = require('../setup/lib/ssh');
const { buildContainerEnv } = require('../setup/lib/env');
const { login } = require('../setup/lib/http');
const { step, warn } = require('../setup/lib/logger');

const VETH_WEBUI = 'veth-webui';

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function containerExists(printOut) {
  return printOut.includes('webuiproxymikrotik');
}

function containerRunning(printOut) {
  return /\s[RCUH]\s/.test(printOut) || printOut.includes('RUNNING') || printOut.includes('HEALTHY');
}

function containerId(printOut) {
  return (printOut.match(/^\s*(\d+)/m) || [])[1] || null;
}

async function forceRemoveContainer(conn) {
  step('webui', 'Stop + remove webuiproxymikrotik (fast stop→remove)...');
  await exec(conn, '/container/set [find name=webuiproxymikrotik] start-on-boot=no').catch(() => {});

  for (let i = 0; i < 12; i++) {
    const st = await exec(conn, '/container/print where name=webuiproxymikrotik');
    if (!containerExists(st)) {
      step('webui', 'Container removed');
      return;
    }

    const id = containerId(st);
    const target = id || '[find name=webuiproxymikrotik]';
    if (containerRunning(st)) {
      await exec(conn, `/container/stop ${target}`).catch(() => {});
      await sleep(1500);
    }
    await exec(conn, `/container/remove ${target}`).catch(() => {});
    await sleep(3000);

    const st2 = await exec(conn, '/container/print where name=webuiproxymikrotik');
    if (!containerExists(st2)) {
      step('webui', 'Container removed');
      return;
    }
    warn('webui', `stop→remove retry ${i + 1}`);
  }

  await exec(conn, ':do {/disk/remove [find name~"webuiproxymikrotik-root"]} on-error={}').catch(() => {});
  throw new Error('Container still exists after stop→remove retries');
}

async function waitForLogin(cfg, attempts = 18, intervalMs = 10_000) {
  for (let i = 0; i < attempts; i++) {
    try {
      const token = await login(cfg.webuiUrl, cfg.webui.adminUser, cfg.webui.adminPass);
      return token;
    } catch (e) {
      if (i === attempts - 1) throw e;
      warn('webui', `login retry ${i + 1}/${attempts}...`);
      await sleep(intervalMs);
    }
  }
  throw new Error('login failed');
}

async function main() {
  const cfg = loadConfig();
  const tar = fs.existsSync(cfg.paths.tarDocker) ? cfg.paths.tarDocker : cfg.paths.tarOci;
  if (!fs.existsSync(tar)) throw new Error(`Missing tar: ${tar}`);

  const conn = await connect(cfg);
  await exec(conn, ':do {/file/remove [find name~"webuiproxymikrotik.tar"]} on-error={}').catch(() => {});
  step('webui', `Upload ${path.basename(tar)} (${(fs.statSync(tar).size / 1024 / 1024).toFixed(1)} MiB)...`);
  await sftpPut(conn, tar, '/disk1/webuiproxymikrotik.tar');

  await forceRemoveContainer(conn);

  await exec(conn, `:do {/container/mounts/remove [find list=MOUNT_DATA]} on-error={}
/container/mounts/add list=MOUNT_DATA src=disk1/data dst=/data`).catch(() => {});

  const rootDir = await nextRootDir(conn);
  const env = buildContainerEnv(cfg);
  const addOut = await exec(
    conn,
    `/container/add file=disk1/webuiproxymikrotik.tar interface=${VETH_WEBUI} root-dir=${rootDir} name=webuiproxymikrotik mountlists=MOUNT_DATA logging=yes start-on-boot=yes env="${env}"`,
    90_000,
  );
  if (addOut.includes('failure:')) throw new Error(`add failed: ${addOut.trim().slice(0, 240)}`);

  let running = false;
  for (let i = 0; i < 30; i++) {
    await sleep(5000);
    const st = await exec(conn, '/container/print where name=webuiproxymikrotik');
    if (containerRunning(st)) { running = true; break; }
    if (st.includes('FAILED')) throw new Error('extract FAILED');
  }
  if (!running) warn('webui', 'extract slow — trying start anyway');

  await exec(conn, '/container/start [find name=webuiproxymikrotik]').catch(() => {});
  conn.end();

  step('webui', 'Wait WebUI boot + login...');
  const token = await waitForLogin(cfg);
  step('webui', 'Login OK — deploy complete');
  console.log(JSON.stringify({ ok: true, rootDir, token: !!token }));
}

main().catch(e => { console.error(e.message); process.exit(1); });