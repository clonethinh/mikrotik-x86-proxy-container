import { Client as SshClient } from 'ssh2';
import { createReadStream } from 'fs';
import { unlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { config } from '../../lib/config';
import { logger } from '../../lib/logger';
import { getMikrotikService } from '../mikrotik/MikrotikService';

const VETH_WEBUI = 'veth-webui';

function sshSftpPut(localPath: string, remotePath: string): Promise<void> {
  const mik = config.mikrotik;
  return new Promise((resolve, reject) => {
    const conn = new SshClient();
    conn.on('ready', () => {
      conn.sftp((err, sftp) => {
        if (err) { conn.end(); return reject(err); }
        const rs = createReadStream(localPath);
        const ws = sftp.createWriteStream(remotePath);
        ws.on('close', () => { conn.end(); resolve(); });
        ws.on('error', (e: Error) => { conn.end(); reject(e); });
        rs.pipe(ws);
      });
    });
    conn.on('error', reject);
    conn.connect({
      host: mik.host,
      port: mik.sshPort,
      username: mik.sshUser,
      password: mik.sshPass,
      readyTimeout: 20_000,
    });
  });
}

async function nextRootDir(): Promise<string> {
  const mik = getMikrotikService();
  const out = await mik.sshExec('/file/print where name~"webuiproxymikrotik-root"', 15_000).catch(() => '');
  let max = 0;
  for (const m of out.matchAll(/webuiproxymikrotik-root(\d*)/g)) {
    const n = m[1] ? parseInt(m[1], 10) : 0;
    if (n > max) max = n;
  }
  return `disk1/webuiproxymikrotik-root${max + 1}`;
}

function buildEnv(): string {
  const mik = config.mikrotik;
  return [
    'NODE_ENV=production', 'PORT=8088', 'DEPLOY_TARGET=router', 'MIKROTIK_HOST=172.17.0.1',
    `MIKROTIK_API_USER=${mik.apiUser}`, `MIKROTIK_API_PASS=${mik.apiPass}`,
    'MIKROTIK_REST_PORT=80', 'MIKROTIK_REST_SCHEME=http',
    `MIKROTIK_SSH_PORT=${mik.sshPort}`, `MIKROTIK_SSH_USER=${mik.sshUser}`, `MIKROTIK_SSH_PASS=${mik.sshPass}`,
    `MIKROTIK_WAN_HOST=${mik.wanHost || ''}`, 'JWT_SECRET=' + config.jwtSecret,
    `ADMIN_USERNAME=${process.env.ADMIN_USERNAME || 'admin'}`, `ADMIN_PASSWORD=${process.env.ADMIN_PASSWORD || 'admin123'}`,
    'DATABASE_URL=file:/data/proxy.db', 'PROXY_DEPLOY_MODE=hub', 'LOW_CPU_MODE=true', 'ENABLE_REALTIME=true',
    'MIKROTIK_REST_CACHE_MS=10000', 'AUTO_PROXY_POLL_MS=15000', 'LOG_LEVEL=warn',
  ].filter(Boolean).join(',');
}

export async function downloadTarFromUrl(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed HTTP ${res.status}`);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

export async function redeployWebuiFromTarBuffer(tar: Buffer): Promise<{ rootDir: string; bytes: number }> {
  if (tar.length < 1_000_000) throw new Error('tar too small');
  const tmp = join(tmpdir(), `webui-deploy-${Date.now()}.tar`);
  await writeFile(tmp, tar);
  const remoteDisk = '/disk1/webuiproxymikrotik.tar';
  const mik = getMikrotikService();

  try {
    logger.info({ bytes: tar.length }, 'redeploy-webui: upload tar via internal SSH');
    await sshSftpPut(tmp, remoteDisk);

    await mik.sshExec('/container/stop [find name=webuiproxymikrotik]', 30_000).catch(() => {});
    await new Promise(r => setTimeout(r, 10_000));
    await mik.sshExec('/container/remove [find name=webuiproxymikrotik]', 30_000).catch(() => {});
    await new Promise(r => setTimeout(r, 5000));

    await mik.sshExec(
      ':do {/container/mounts/remove [find list=MOUNT_DATA]} on-error={}; ' +
      '/container/mounts/add list=MOUNT_DATA src=disk1/data dst=/data',
      15_000,
    ).catch(() => {});

    const rootDir = await nextRootDir();
    const env = buildEnv();
    const addOut = await mik.sshExec(
      `/container/add file=disk1/webuiproxymikrotik.tar interface=${VETH_WEBUI} root-dir=${rootDir} ` +
      `name=webuiproxymikrotik mountlists=MOUNT_DATA logging=no start-on-boot=yes env="${env}"`,
      120_000,
    );
    if (addOut.includes('failure:')) throw new Error(`container add failed: ${addOut.slice(0, 200)}`);

    const start = Date.now();
    while (Date.now() - start < 240_000) {
      const st = await mik.sshExec('/container/print where name=webuiproxymikrotik', 15_000).catch(() => '');
      if (/\sR\s/.test(st) || st.includes('RUNNING') || st.includes('HEALTHY')) break;
      if (st.includes('FAILED')) throw new Error('container extract FAILED');
      await new Promise(r => setTimeout(r, 5000));
    }

    await mik.sshExec('/container/start [find name=webuiproxymikrotik]', 20_000).catch(() => {});
    return { rootDir, bytes: tar.length };
  } finally {
    await unlink(tmp).catch(() => {});
  }
}