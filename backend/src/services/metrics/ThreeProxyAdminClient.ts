// Poll 3proxy admin HTTP interface (GET /S → XML services/clients)
import * as http from 'http';
import {
  hubAdminPort,
  hubContainerName,
  hubShardContainerIp,
  HUB_MONITOR_USERNAME,
} from '../../lib/hubUtils';
import { getHubMonitorPassword } from '../proxy/HubConfigService';
import { getMikrotikService } from '../mikrotik/MikrotikService';
import { logger } from '../../lib/logger';

export interface AdminUserStats {
  username: string;
  rxBytes: bigint;
  txBytes: bigint;
  activeClients: number;
}

export interface AdminCounterStats {
  counterId: number;
  bytesMb: number;
}

/** True when body looks like legacy admin XML (3proxy < 0.9 HTML UI returns welcome page). */
export function isAdminXmlPayload(body: string): boolean {
  if (!body || body.length < 40) return false;
  if (body.includes('Welcome to 3proxy Web Interface')) return false;
  return body.includes('<item>') || (body.includes('<name>') && body.includes('username'));
}

/** Parse 3proxy admin XML — nested <item> blocks with <name>/<value> pairs. */
export function parseAdminServicesXml(xml: string): AdminUserStats[] {
  if (!isAdminXmlPayload(xml)) return [];
  const byUser = new Map<string, { rx: bigint; tx: bigint; clients: number }>();

  const itemBlocks = xml.split(/<item>/i).slice(1);
  for (const block of itemBlocks) {
    const params = new Map<string, string>();
    const re = /<name>([^<]*)<\/name>\s*<value>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([^<]*))<\/value>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(block)) !== null) {
      const key = (m[1] || '').trim();
      const val = (m[2] ?? m[3] ?? '').trim();
      if (key) params.set(key, val);
    }

    const username = params.get('username');
    if (!username || username === '-') continue;

    const rx = BigInt(params.get('statssrv64') || params.get('srvbuf') || '0');
    const tx = BigInt(params.get('statscli64') || params.get('clibuf') || '0');

    const prev = byUser.get(username) || { rx: 0n, tx: 0n, clients: 0 };
    prev.rx += rx;
    prev.tx += tx;
    prev.clients += 1;
    byUser.set(username, prev);
  }

  return [...byUser.entries()].map(([username, s]) => ({
    username,
    rxBytes: s.rx,
    txBytes: s.tx,
    activeClients: s.clients,
  }));
}

/** Parse GET /C XML — traffic counter records (MB). */
export function parseAdminCountersXml(xml: string): AdminCounterStats[] {
  if (!isAdminXmlPayload(xml)) return [];
  const out: AdminCounterStats[] = [];
  const itemBlocks = xml.split(/<item>/i).slice(1);
  for (const block of itemBlocks) {
    const params = new Map<string, string>();
    const re = /<name>([^<]*)<\/name>\s*<value>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([^<]*))<\/value>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(block)) !== null) {
      const key = (m[1] || '').trim();
      const val = (m[2] ?? m[3] ?? '').trim();
      if (key) params.set(key, val);
    }
    const idRaw = params.get('number') || params.get('counter') || params.get('id');
    const trafRaw = params.get('traf') || params.get('traffic') || params.get('bytes');
    if (!idRaw) continue;
    const counterId = parseInt(idRaw, 10);
    const bytesMb = parseFloat(trafRaw || '0');
    if (!Number.isNaN(counterId)) {
      out.push({ counterId, bytesMb: Number.isNaN(bytesMb) ? 0 : bytesMb });
    }
  }
  return out;
}

function fetchAdminXml(
  host: string,
  port: number,
  path: string,
  user: string,
  pass: string,
  timeoutMs: number,
): Promise<string> {
  const auth = Buffer.from(`${user}:${pass}`).toString('base64');
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host,
        port,
        path,
        method: 'GET',
        headers: { Authorization: `Basic ${auth}`, Connection: 'close' },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`admin HTTP ${res.statusCode}: ${body.slice(0, 120)}`));
            return;
          }
          if (!isAdminXmlPayload(body) && body.includes('3proxy')) {
            reject(new Error('admin returned HTML UI (not XML)'));
            return;
          }
          resolve(body);
        });
      },
    );
    req.on('timeout', () => { req.destroy(); reject(new Error('admin timeout')); });
    req.on('error', reject);
    req.end();
  });
}

async function fetchAdminXmlViaHubShell(
  shardId: number,
  path: string,
  pass: string,
  timeoutMs: number,
): Promise<string> {
  const host = hubShardContainerIp(shardId);
  const port = hubAdminPort(shardId);
  const ctn = hubContainerName(shardId);
  const mik = getMikrotikService();
  const inner = `wget -qO- http://${HUB_MONITOR_USERNAME}:${pass}@${host}:${port}${path} 2>/dev/null`;
  const out = await mik.containerShell(ctn, inner, timeoutMs);
  if (!out || out.length < 20) {
    throw new Error(`hub shell admin empty (${out?.slice(0, 60) || 'no output'})`);
  }
  if (!isAdminXmlPayload(out)) {
    throw new Error('hub shell admin HTML (3proxy 0.9 — /S not XML)');
  }
  return out;
}

export class ThreeProxyAdminClient {
  async pollShard(shardId: number, timeoutMs = 8000): Promise<AdminUserStats[]> {
    const host = hubShardContainerIp(shardId);
    const port = hubAdminPort(shardId);
    const pass = await getHubMonitorPassword();
    try {
      const xml = await fetchAdminXml(host, port, '/S', HUB_MONITOR_USERNAME, pass, timeoutMs);
      return parseAdminServicesXml(xml);
    } catch (e: any) {
      try {
        const xml = await fetchAdminXmlViaHubShell(shardId, '/S', pass, timeoutMs);
        return parseAdminServicesXml(xml);
      } catch (e2: any) {
        logger.warn({ shardId, host, port, err: e.message?.slice(0, 80), fallback: e2.message?.slice(0, 80) }, 'admin poll failed');
        return [];
      }
    }
  }

  async pollShardCounters(shardId: number, timeoutMs = 8000): Promise<AdminCounterStats[]> {
    const host = hubShardContainerIp(shardId);
    const port = hubAdminPort(shardId);
    const pass = await getHubMonitorPassword();
    try {
      const xml = await fetchAdminXml(host, port, '/C', HUB_MONITOR_USERNAME, pass, timeoutMs);
      return parseAdminCountersXml(xml);
    } catch (e: any) {
      try {
        const xml = await fetchAdminXmlViaHubShell(shardId, '/C', pass, timeoutMs);
        return parseAdminCountersXml(xml);
      } catch (e2: any) {
        logger.warn({ shardId, err: e.message?.slice(0, 60), fallback: e2.message?.slice(0, 60) }, 'admin /C poll failed');
        return [];
      }
    }
  }
}

export const threeProxyAdminClient = new ThreeProxyAdminClient();