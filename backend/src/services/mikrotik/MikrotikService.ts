// Mikrotik service - REST API (HTTP) + SSH client
// REST API works for ALL v7 operations: containers, veth, routing, NAT, etc.
// SSH is used for: .rsc import, file writes, /tool fetch, /container/mounts (REST fails for this)
import { Client as SshClient } from 'ssh2';
import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import { config } from '../../lib/config';
import { logger } from '../../lib/logger';
import { isProxyPoolPppoe } from '../../lib/pppoeUtils';
import {
  DEV_MGMT_BYPASS_COMMENT,
  DEV_MGMT_TCP_PORTS,
  DEV_ROUTE_SKIP_ADDRESS_LIST,
  HUB_LAN_ADDRESS_LIST,
  HUB_ROUTER_ADDRESS_LIST,
  hubShardSubnet,
} from '../../lib/hubUtils';
import {
  isValidLanIpv4,
  LAN_STATS_CONN_MARK,
  LAN_STATS_DL_COMMENT_PREFIX,
  LAN_STATS_MARK_DST_PREFIX,
  LAN_STATS_MARK_SRC_PREFIX,
  LAN_STATS_RULE_COMMENT_RE,
  LAN_STATS_UL_COMMENT_PREFIX,
  lanStatsDlComment,
  lanStatsIpFromComment,
  lanStatsMarkDstComment,
  lanStatsMarkSrcComment,
  lanStatsUlComment,
} from '../../lib/lanTrafficUtils';

export interface MikrotikCredentials {
  host: string;
  apiUser: string;
  apiPass: string;
  restPort: number;
  restScheme: 'http' | 'https';
  sshPort: number;
  sshUser: string;
  sshPass: string;
}

export interface PppoeInterface {
  name: string;
  disabled: boolean;
  running: boolean;
  uptime: string;
  publicIp: string | null;
  user: string;
  index: number;
  comment: string;
}

function normalizeGmtOffset(raw: string | undefined): string {
  if (!raw || !/^[+-]/.test(raw)) return '+07:00';
  if (/^[+-]\d{2}:\d{2}$/.test(raw)) return raw;
  if (/^[+-]\d{2}$/.test(raw)) return `${raw}:00`;
  return '+07:00';
}

function parseRouterClock(clock: Record<string, string> | null | undefined): Date | null {
  if (!clock?.date || !clock?.time) return null;
  const off = normalizeGmtOffset(clock['gmt-offset']);
  const d = new Date(`${clock.date}T${clock.time}${off}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseLinkUpTime(raw: string, gmtOffset?: string): Date | null {
  const off = normalizeGmtOffset(gmtOffset);
  const d = new Date(`${raw.replace(' ', 'T')}${off}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatMikrotikUptime(ms: number): string {
  if (ms < 0) return '';
  const sec = Math.floor(ms / 1000);
  const w = Math.floor(sec / 604_800);
  const d = Math.floor((sec % 604_800) / 86_400);
  const h = Math.floor((sec % 86_400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const parts: string[] = [];
  if (w) parts.push(`${w}w`);
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (s || !parts.length) parts.push(`${s}s`);
  return parts.join('');
}

function uptimeFromLinkUp(
  linkUp: string | undefined,
  routerNow: Date | null,
  running: boolean,
  gmtOffset?: string,
): string {
  if (!running || !linkUp || !routerNow) return '';
  const upAt = parseLinkUpTime(linkUp, gmtOffset);
  if (!upAt) return '';
  return formatMikrotikUptime(routerNow.getTime() - upAt.getTime());
}

export interface ContainerInfo {
  id: string;
  name: string;
  status: string;
  healthy?: boolean;
  healthcheckStatus?: string;
  tag?: string;
  interface?: string;
  env?: string;
}

export interface PppoeTrafficCounter {
  name: string;
  running: boolean;
  rxBytes: bigint;
  txBytes: bigint;
}

type RestCacheEntry<T> = { at: number; data: T };

export class MikrotikService {
  private creds: MikrotikCredentials;
  private pppoeCache: RestCacheEntry<PppoeInterface[]> | null = null;
  private containerCache: RestCacheEntry<ContainerInfo[]> | null = null;
  /** Reuse one SSH session — tránh spam "logged in/out" trên RouterOS */
  private sshConn: SshClient | null = null;
  private sshReady = false;
  private sshConnecting: Promise<SshClient> | null = null;
  private sshChain: Promise<unknown> = Promise.resolve();
  private sshIdleTimer: NodeJS.Timeout | null = null;
  private static readonly SSH_IDLE_MS = 45_000;

  constructor(creds?: Partial<MikrotikCredentials>) {
    this.creds = {
      host: creds?.host || config.mikrotik.host,
      apiUser: creds?.apiUser || config.mikrotik.apiUser,
      apiPass: creds?.apiPass || config.mikrotik.apiPass,
      restPort: creds?.restPort || config.mikrotik.restPort,
      restScheme: creds?.restScheme || config.mikrotik.restScheme,
      sshPort: creds?.sshPort || config.mikrotik.sshPort,
      sshUser: creds?.sshUser || config.mikrotik.sshUser,
      sshPass: creds?.sshPass || config.mikrotik.sshPass,
    };
  }

  // ============ REST API (HTTP, primary) ============

  restRequest(method: string, path: string, body?: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const url = new URL(`${this.creds.restScheme}://${this.creds.host}:${this.creds.restPort}${path}`);
      const lib = this.creds.restScheme === 'https' ? https : http;
      const auth = Buffer.from(`${this.creds.apiUser}:${this.creds.apiPass}`).toString('base64');
      const opts: any = {
        method,
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/json',
        },
        timeout: 15_000,
      };
      // HTTPS self-signed cert - we accept it; for http this is no-op
      if (this.creds.restScheme === 'https') {
        opts.rejectUnauthorized = false;
      }
      const req = lib.request(opts, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            return reject(new Error(`REST ${method} ${path} HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
          }
          if (!data) return resolve(null);
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve(data);
          }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('REST timeout')); });
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }

  async restGet(path: string) { return this.restRequest('GET', path); }
  async restPost(path: string, body?: any) { return this.restRequest('POST', path, body); }
  async restPut(path: string, body?: any) { return this.restRequest('PUT', path, body); }
  async restPatch(path: string, body?: any) { return this.restRequest('PATCH', path, body); }
  async restDelete(path: string) { return this.restRequest('DELETE', path); }

  // ============ SSH (file ops, mount lists, /tool fetch) ============

  private dropSsh(): void {
    this.sshReady = false;
    this.sshConnecting = null;
    if (this.sshIdleTimer) {
      clearTimeout(this.sshIdleTimer);
      this.sshIdleTimer = null;
    }
    const c = this.sshConn;
    this.sshConn = null;
    if (c) {
      try { c.end(); } catch { /* ignore */ }
    }
  }

  private scheduleSshIdleClose(): void {
    if (this.sshIdleTimer) clearTimeout(this.sshIdleTimer);
    this.sshIdleTimer = setTimeout(() => this.dropSsh(), MikrotikService.SSH_IDLE_MS);
  }

  private ensureSsh(): Promise<SshClient> {
    if (this.sshConn && this.sshReady) return Promise.resolve(this.sshConn);
    if (this.sshConnecting) return this.sshConnecting;

    this.sshConnecting = new Promise<SshClient>((resolve, reject) => {
      const conn = new SshClient();
      const fail = (err: Error) => {
        this.dropSsh();
        reject(err);
      };
      conn.on('ready', () => {
        this.sshConn = conn;
        this.sshReady = true;
        this.sshConnecting = null;
        resolve(conn);
      });
      conn.on('error', fail);
      conn.on('close', () => {
        if (this.sshConn === conn) this.dropSsh();
      });
      conn.connect({
        host: this.creds.host,
        port: this.creds.sshPort,
        username: this.creds.sshUser,
        password: this.creds.sshPass,
        readyTimeout: 15_000,
        tryKeyboard: true,
      });
    });
    return this.sshConnecting;
  }

  private sshExecOnce(command: string, timeoutMs: number): Promise<string> {
    return this.ensureSsh().then(conn => new Promise<string>((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => {
        this.dropSsh();
        reject(new Error(`SSH timeout ${timeoutMs}ms`));
      }, timeoutMs);
      conn.exec(command, (err, stream) => {
        if (err) {
          clearTimeout(timer);
          this.dropSsh();
          reject(err);
          return;
        }
        stream.on('close', () => {
          clearTimeout(timer);
          this.scheduleSshIdleClose();
          resolve(output);
        });
        stream.on('data', (data: Buffer) => { output += data.toString('utf8'); });
        stream.stderr.on('data', (data: Buffer) => { output += data.toString('utf8'); });
      });
    }));
  }

  /** Serialized SSH on a reused session (1 login thay vì login/logout mỗi lệnh). */
  sshExec(command: string, timeoutMs = 30_000): Promise<string> {
    const run = this.sshChain.then(() => this.sshExecOnce(command, timeoutMs));
    this.sshChain = run.catch(() => {});
    return run;
  }

  async sshImportRsc(rscName: string, timeoutMs = 60_000): Promise<string> {
    return this.sshExec(`/import file=${rscName}`, timeoutMs);
  }

  // ============ High-level queries ============

  bustRestCache(): void {
    this.pppoeCache = null;
    this.containerCache = null;
  }

  private restCacheFresh<T>(entry: RestCacheEntry<T> | null): T | null {
    const ttl = config.mikrotik.restCacheTtlMs;
    if (!ttl || !entry) return null;
    if (Date.now() - entry.at > ttl) return null;
    return entry.data;
  }

  async getPppoeInterfaces(opts?: { fresh?: boolean }): Promise<PppoeInterface[]> {
    if (!opts?.fresh) {
      const cached = this.restCacheFresh(this.pppoeCache);
      if (cached) return cached;
    }

    // Get pppoe clients via REST; RouterOS 7 has no uptime on pppoe-client — derive from interface last-link-up-time
    const [pppoesRaw, addrs, ifacesRaw, clockRaw] = await Promise.all([
      this.restGet('/rest/interface/pppoe-client').catch(() => []),
      this.restGet('/rest/ip/address?dynamic=yes').catch(() => []),
      this.restGet('/rest/interface?type=pppoe-out').catch(() => []),
      this.restGet('/rest/system/clock').catch(() => null),
    ]);
    const clockObj = clockRaw as Record<string, string> | null;
    const routerNow = parseRouterClock(clockObj);
    const gmtOffset = clockObj?.['gmt-offset'];
    const linkUpByName: Record<string, string> = {};
    if (Array.isArray(ifacesRaw)) {
      for (const iface of ifacesRaw) {
        const n = iface.name || '';
        if (n.startsWith('pppoe-out') && iface['last-link-up-time']) {
          linkUpByName[n] = iface['last-link-up-time'];
        }
      }
    }

    const ipByIf: Record<string, string> = {};
    if (Array.isArray(addrs)) {
      for (const a of addrs) {
        if (a.interface && a['dynamic'] === 'true') {
          const ip = (a.address || '').split('/')[0];
          ipByIf[a.interface] = ip;
        }
      }
    }

    const result: PppoeInterface[] = [];
    if (Array.isArray(pppoesRaw)) {
      for (const r of pppoesRaw) {
        const name = r.name || '';
        if (!name.startsWith('pppoe-out')) continue;
        const idx = parseInt(name.replace('pppoe-out', ''), 10);
        if (isNaN(idx)) continue;
        const running = r.running === 'true' || r.running === true;
        result.push({
          name,
          disabled: r.disabled === 'true' || r.disabled === true,
          running,
          uptime: uptimeFromLinkUp(linkUpByName[name], routerNow, running, gmtOffset) || r['uptime'] || '',
          publicIp: ipByIf[name] || null,
          user: r.user || '',
          index: idx,
          comment: (r.comment || '').trim(),
        });
      }
    }
    const sorted = result.sort((a, b) => a.index - b.index);
    if (config.mikrotik.restCacheTtlMs > 0) {
      this.pppoeCache = { at: Date.now(), data: sorted };
    }
    return sorted;
  }

  async reloadPppoeIp(ifName: string, timeoutMs = 30_000): Promise<string | 'TIMEOUT'> {
    if (ifName === 'pppoe-wan') throw new Error('refused: pppoe-wan là luồng chính, không reload');

    // Verify interface exists via REST
    const pppoes = await this.restGet('/rest/interface/pppoe-client');
    const me = Array.isArray(pppoes) ? pppoes.find((p: any) => p.name === ifName) : null;
    if (!me) throw new Error(`${ifName} not found`);

    // Use SSH (REST PATCH on *.id has inconsistent body handling on RouterOS)
    // /interface/pppoe-client/disable <name> + /enable <name> is reliable
    const sshCmd = `/interface/pppoe-client/disable ${ifName}; :delay 3s; /interface/pppoe-client/enable ${ifName}`;
    await this.sshExec(sshCmd, 15_000);
    this.bustRestCache();

    // Poll for new IP (SSH-based to avoid REST flakiness after PPPoE flap)
    const start = Date.now();
    let lastSeenIp: string | null = null;
    while (Date.now() - start < timeoutMs) {
      await new Promise(r => setTimeout(r, 2000));
      try {
        // Use SSH to query IP (REST may briefly fail during PPPoE reconnect)
        // Filter out link-local (169.254.x.x) and prefer dynamic public IPs
        const out = await this.sshExec(
          `:local ips ""; :foreach a in=[/ip/address/find where interface=${ifName} dynamic=yes] do={:local ip [/ip/address/get $a address]; :if (($ip ~ "^[0-9]+\\.")) do={:if (($ip !~ "^169\\.254\\.")) do={:set ips ($ips . "," . $ip)}}}; :put $ips`,
          8_000,
        );
        // Parse first valid public IP (not link-local)
        const candidates = out.match(/[\d]{1,3}\.[\d]{1,3}\.[\d]{1,3}\.[\d]{1,3}/g) || [];
        const publicIp = candidates.find((ip: string) => !ip.startsWith('169.254.'));
        if (publicIp) {
          // Check running state
          const runningOut = await this.sshExec(
            `:put [/interface/pppoe-client/get [/interface/pppoe-client/find name=${ifName}] running]`,
            5_000,
          );
          if (runningOut.includes('true')) {
            return publicIp;
          }
          lastSeenIp = publicIp;
        }
      } catch {}
    }
    return 'TIMEOUT';
  }

  // ============ PPPoE create (auto clone from template) ============

  async findNextPppoeOutIndex(maxIdx = 100): Promise<number> {
    const existing = await this.getPppoeInterfaces({ fresh: true });
    const used = new Set(existing.map(p => p.index));
    for (let i = 1; i <= maxIdx; i++) {
      if (!used.has(i)) return i;
    }
    throw new Error(`Không còn index trống (1..${maxIdx})`);
  }

  /**
   * Tạo pppoe-outN bằng cách clone pppoe-out1 (hoặc pppoe-out đầu tiên).
   * Mặc định disabled=yes — caller bật qua setPppoeEnabled nếu cần.
   */
  async createPppoeOut(preferredIdx?: number, maxIdx = 100): Promise<{
    index: number;
    name: string;
    created: boolean;
    disabled: boolean;
  }> {
    const idx = preferredIdx ?? await this.findNextPppoeOutIndex(maxIdx);
    if (!Number.isInteger(idx) || idx < 1 || idx > maxIdx) {
      throw new Error(`pppoeIdx ${idx} ngoài phạm vi 1..${maxIdx}`);
    }
    const name = `pppoe-out${idx}`;

    const raw = await this.restGet('/rest/interface/pppoe-client').catch(() => []);
    const list = Array.isArray(raw) ? raw : [];
    const existing = list.find((p: any) => p.name === name);
    if (existing) {
      const disabled = existing.disabled === 'true' || existing.disabled === true;
      return { index: idx, name, created: false, disabled };
    }

    const template = list.find((p: any) => p.name === 'pppoe-out1')
      || list.find((p: any) => /^pppoe-out\d+$/.test(p.name || ''));
    if (!template) {
      throw new Error('Không tìm thấy pppoe-out1 làm template — tạo thủ công 1 client trước');
    }

    const iface = template.interface || 'macvlan-wan';
    const user = (template.user || '').replace(/"/g, '\\"');
    const profile = template.profile || 'default';
    if (!user) throw new Error('Template PPPoE thiếu user');

    const addOut = await this.sshExec(
      `/interface/pppoe-client/add name=${name} interface=${iface} user="${user}" profile=${profile} ` +
      `add-default-route=no disabled=yes dial-on-demand=no use-peer-dns=no keepalive-timeout=10 ` +
      `comment="auto-created by webuiproxymikrotik"`,
      20_000,
    );
    if (addOut.includes('failure:')) {
      throw new Error(addOut.trim().slice(0, 200));
    }
    await this.ensurePoolPppoeIsolation(name);

    this.bustRestCache();
    logger.info({ name, idx, template: template.name }, 'createPppoeOut OK');
    return { index: idx, name, created: true, disabled: true };
  }

  /**
   * Pool proxy (pppoe-out1+): không được thêm default route/DNS vào bảng main —
   * nếu không LAN sẽ đi nhầm qua IP xấu khi phiên đó bật.
   */
  async ensurePoolPppoeIsolation(ifName?: string): Promise<void> {
    if (ifName) {
      if (!isProxyPoolPppoe(ifName)) return;
      await this.sshExec(
        `/interface/pppoe-client/set ${ifName} add-default-route=no use-peer-dns=no`,
        8_000,
      );
      return;
    }
    await this.sshExec(
      `:foreach i in=[/interface/pppoe-client/find where name~"^pppoe-out"] do={` +
      ` /interface/pppoe-client/set $i add-default-route=no use-peer-dns=no` +
      `}`,
      15_000,
    );
  }

  // ============ PPPoE enable/disable (WebUI control) ============

  /**
   * Bật hoặc tắt pppoe-outX.
   * Hard guard: pppoe-wan không bao giờ được disable (luồng chính / DuckDNS).
   * Trả về state mới + IP (nếu đang chạy).
   */
  async setPppoeEnabled(ifName: string, enabled: boolean): Promise<{ name: string; enabled: boolean; running: boolean; publicIp: string | null }> {
    if (ifName === 'pppoe-wan') {
      if (!enabled) throw new Error('refused: pppoe-wan là luồng chính, không thể tắt');
      // Management WAN — không nằm trong proxy pool (pppoe-out1+)
    }
    const pppoes = await this.restGet('/rest/interface/pppoe-client');
    const me = Array.isArray(pppoes) ? pppoes.find((p: any) => p.name === ifName) : null;
    if (!me) throw new Error(`${ifName} not found`);

    if (enabled) await this.ensurePoolPppoeIsolation(ifName);

    // Use SSH (REST PATCH body handling is unreliable for *.id targets)
    const cmd = enabled
      ? `/interface/pppoe-client/enable ${ifName}`
      : `/interface/pppoe-client/disable ${ifName}`;
    await this.sshExec(cmd, 10_000);
    this.bustRestCache();

    if (!enabled) {
      return { name: ifName, enabled: false, running: false, publicIp: null };
    }
    const publicIp = await this.peekPppoeIp(ifName);
    return { name: ifName, enabled, running: publicIp !== null, publicIp };
  }

  /** One-shot PPPoE IP check (no wait loop). */
  async peekPppoeIp(ifName: string): Promise<string | null> {
    try {
      const pppoes = await this.restGet('/rest/interface/pppoe-client');
      const me = Array.isArray(pppoes) ? pppoes.find((p: any) => p.name === ifName) : null;
      if (!(me?.running === 'true' || me?.running === true)) return null;
      const addrs = await this.restGet(`/rest/ip/address?interface=${ifName}&dynamic=yes`);
      if (Array.isArray(addrs) && addrs.length > 0) {
        const ip = (addrs[0].address || '').split('/')[0];
        if (ip && !ip.startsWith('169.254.')) return ip;
      }
    } catch { /* retry in wait loop */ }
    return null;
  }

  /**
   * Đợi pppoe-outX chạy (running=true) và có IP public.
   * Trả về IP nếu thành công; null nếu timeout.
   */
  async waitPppoeRunning(ifName: string, timeoutMs = 45_000): Promise<string | null> {
    const start = Date.now();
    let delayMs = 600;
    while (Date.now() - start < timeoutMs) {
      const ip = await this.peekPppoeIp(ifName);
      if (ip) return ip;
      await new Promise(r => setTimeout(r, delayMs));
      if (delayMs < 2000) delayMs = Math.min(2000, Math.round(delayMs * 1.35));
    }
    return null;
  }

  async getContainers(opts?: { fresh?: boolean }): Promise<ContainerInfo[]> {
    if (!opts?.fresh) {
      const cached = this.restCacheFresh(this.containerCache);
      if (cached) return cached;
    }

    try {
      const raw = await this.restGet('/rest/container');
      if (!Array.isArray(raw)) return [];
      const mapped = raw.map((c: any) => ({
        id: c['.id'] || '',
        name: c.name || '',
        status: c.status || '',
        healthy: c.healthy === true || c.healthy === 'true',
        healthcheckStatus: c['healthcheck-status'] || '',
        tag: c.tag,
        interface: c.interface,
        env: c['env-current'] || '',
      }));
      if (config.mikrotik.restCacheTtlMs > 0) {
        this.containerCache = { at: Date.now(), data: mapped };
      }
      return mapped;
    } catch (e: any) {
      logger.warn({ err: e.message }, 'getContainers failed');
      return [];
    }
  }

  /** Cumulative rx/tx byte counters on all PPPoE WAN interfaces (pppoe-wan + pppoe-out*). */
  async getPppoeTrafficCounters(): Promise<PppoeTrafficCounter[]> {
    const [outRaw, wanRaw] = await Promise.all([
      this.restGet('/rest/interface?type=pppoe-out').catch(() => []),
      this.restGet('/rest/interface?name=pppoe-wan').catch(() => []),
    ]);
    const rows: unknown[] = [];
    if (Array.isArray(outRaw)) rows.push(...outRaw);
    if (Array.isArray(wanRaw)) rows.push(...wanRaw);

    const out: PppoeTrafficCounter[] = [];
    for (const r of rows) {
      const row = r as Record<string, unknown>;
      const name = String(row.name || '');
      if (!name.startsWith('pppoe-')) continue;
      out.push({
        name,
        running: row.running === true || row.running === 'true',
        rxBytes: BigInt(String(row['rx-byte'] ?? 0)),
        txBytes: BigInt(String(row['tx-byte'] ?? 0)),
      });
    }
    return out;
  }

  async getSystemResource(): Promise<any> {
    try {
      const raw = await this.restGet('/rest/system/resource');
      return raw || {};
    } catch {
      return {};
    }
  }

  async ping(): Promise<boolean> {
    try {
      const raw = await this.restGet('/rest/system/identity');
      return !!raw;
    } catch {
      return false;
    }
  }

  /**
   * Ping qua interface PPPoE cụ thể — xác nhận WAN có internet thật.
   * count nhỏ (2) để giảm tải CPU MikroTik.
   */
  async pingViaInterface(
    ifName: string,
    target = '1.1.1.1',
    count = 2,
  ): Promise<{ ok: boolean; received: number; avgRttMs: number | null }> {
    try {
      const out = await this.sshExec(
        `/tool ping ${target} interface=${ifName} count=${count} interval=500ms`,
        Math.max(6_000, count * 2_500),
      );
      const receivedMatch = out.match(/received=(\d+)/);
      const received = receivedMatch ? parseInt(receivedMatch[1], 10) : 0;
      const rttMatch = out.match(/avg-rtt=([\d.]+)(ms|us)/);
      let avgRttMs: number | null = null;
      if (rttMatch) {
        const v = parseFloat(rttMatch[1]);
        avgRttMs = rttMatch[2] === 'us' ? Math.round(v / 1000) : Math.round(v);
      }
      return { ok: received > 0, received, avgRttMs };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn({ err: msg.slice(0, 100), ifName, target }, 'pingViaInterface failed');
      return { ok: false, received: 0, avgRttMs: null };
    }
  }

  // ============ DHCP leases (device routing UI) ============

  async getDhcpLeases(): Promise<Array<{
    id: string;
    address: string;
    macAddress: string;
    hostName: string;
    status: string;
    server: string;
  }>> {
    try {
      const raw = await this.restGet('/rest/ip/dhcp-server/lease');
      if (!Array.isArray(raw)) return [];
      return raw
        .filter((l: any) => l.address && l['mac-address'])
        .map((l: any) => ({
          id: l['.id'] || '',
          address: l.address || '',
          macAddress: (l['mac-address'] || '').toUpperCase(),
          hostName: l['host-name'] || l.comment || '',
          status: l.status || '',
          server: l.server || '',
        }));
    } catch (e: any) {
      logger.warn({ err: e.message }, 'getDhcpLeases failed');
      return [];
    }
  }

  // ============ Device LAN routing (mangle mark-routing) ============

  deviceRouteComment(id: number): string {
    return `dev-route-${id}`;
  }

  /** Địa chỉ/container/mgmt — không policy-route (giữ WebUI + LAN local reachable). */
  async ensureDeviceRouteSkipLists(): Promise<void> {
    const skip = DEV_ROUTE_SKIP_ADDRESS_LIST;
    const adds: string[] = [
      `:do {/ip/firewall/address-list/add list=${skip} address=172.17.0.0/16 comment=dev-webui-bridge} on-error={}`,
    ];
    for (const net of config.network.lanSubnets) {
      adds.push(`:do {/ip/firewall/address-list/add list=${skip} address=${net} comment=dev-lan} on-error={}`);
    }
    for (let sid = 0; sid < config.hub.shardCount; sid++) {
      adds.push(`:do {/ip/firewall/address-list/add list=${skip} address=${hubShardSubnet(sid)} comment=dev-hub} on-error={}`);
    }
    await this.sshExec(adds.join(' '), 12_000);

    const bypass = DEV_MGMT_BYPASS_COMMENT;
    await this.sshExec(
      `/ip/firewall/mangle/remove [find comment=${bypass}]`,
      8_000,
    ).catch(() => {});
    await this.sshExec(
      `/ip/firewall/mangle/add chain=prerouting action=accept protocol=tcp ` +
      `src-address-list=${HUB_LAN_ADDRESS_LIST} dst-port=${DEV_MGMT_TCP_PORTS} ` +
      `comment=${bypass} place-before=0`,
      10_000,
    );
  }

  async ensureDeviceRouteEgress(pppoeIdx: number): Promise<void> {
    const ifName = `pppoe-out${pppoeIdx}`;
    const rmark = `to_pppoe${pppoeIdx}`;
    const routeComment = `dev-route-egress-${ifName}`;
    await this.sshExec(
      `:if ([:len [/routing/table/find name=${rmark}]] = 0) do={/routing/table/add name=${rmark} fib}`,
      8_000,
    );
    await this.sshExec(
      `:if ([:len [/ip/route/find where comment=${routeComment}]] = 0) do={` +
      `/ip/route/add dst-address=0.0.0.0/0 gateway=${ifName} routing-table=${rmark} comment=${routeComment}` +
      `} else={` +
      `/ip/route/set [find comment=${routeComment}] gateway=${ifName} routing-table=${rmark} disabled=no` +
      `}`,
      10_000,
    );
  }

  async ensureDeviceRoute(opts: {
    id: number;
    matchType: 'ip' | 'mac' | 'dhcp';
    ipAddress?: string | null;
    macAddress?: string | null;
    pppoeIdx: number;
    enabled: boolean;
  }): Promise<void> {
    const comment = this.deviceRouteComment(opts.id);
    const rmark = `to_pppoe${opts.pppoeIdx}`;

    // Remove existing rule (idempotent update)
    await this.sshExec(
      `/ip/firewall/mangle/remove [find comment=${comment}]`,
      10_000,
    ).catch(() => {});

    if (!opts.enabled) return;

    await this.ensureDeviceRouteEgress(opts.pppoeIdx);
    await this.ensureDeviceRouteSkipLists();

    const srcIp = opts.ipAddress?.trim();
    const srcMac = opts.macAddress?.trim();
    if (!srcIp && !srcMac) throw new Error('Device route requires IP or MAC');

    const skipLists = `!${HUB_LAN_ADDRESS_LIST},!${HUB_ROUTER_ADDRESS_LIST},!${DEV_ROUTE_SKIP_ADDRESS_LIST}`;
    let addCmd = `/ip/firewall/mangle/add chain=prerouting action=mark-routing new-routing-mark=${rmark} passthrough=yes comment=${comment}`;
    addCmd += ` dst-address-list=${skipLists} dst-address-type=!local`;
    if (srcIp) addCmd += ` src-address=${srcIp}`;
    if (srcMac) addCmd += ` src-mac-address=${srcMac}`;

    await this.sshExec(addCmd, 10_000);
  }

  async repairAllDeviceRoutes(
    rows: Array<{
      id: number;
      matchType: string;
      ipAddress: string | null;
      macAddress: string | null;
      pppoeIdx: number;
      enabled: boolean;
    }>,
  ): Promise<void> {
    await this.ensureDeviceRouteSkipLists();
    for (const row of rows) {
      await this.ensureDeviceRoute({
        id: row.id,
        matchType: row.matchType as 'ip' | 'mac' | 'dhcp',
        ipAddress: row.matchType === 'mac' ? null : row.ipAddress,
        macAddress: row.macAddress,
        pppoeIdx: row.pppoeIdx,
        enabled: row.enabled,
      }).catch((e: Error) => {
        logger.warn({ err: e.message, id: row.id }, 'repairAllDeviceRoutes row failed');
      });
    }
  }

  async removeDeviceRoute(id: number): Promise<void> {
    const comment = this.deviceRouteComment(id);
    await this.sshExec(
      `/ip/firewall/mangle/remove [find comment=${comment}]`,
      10_000,
    ).catch(() => {});
  }

  // ============ LAN per-host traffic stats (mangle passthrough counters) ============

  /** Per-LAN-host traffic counters: forward mangle + conn-mark (FastTrack bỏ qua marked flows). */
  async syncLanStatsMangleRules(ips: string[]): Promise<void> {
    const unique = [...new Set(ips.filter(isValidLanIpv4))];
    const wantIps = new Set(unique);

    await this.sshExec(
      `:do {/ip firewall filter set [find where action=fasttrack-connection] connection-mark=no-mark connection-state=established,related} on-error={}`,
      10_000,
    ).catch(() => {});

    for (const ip of unique) {
      const ul = lanStatsUlComment(ip);
      const dl = lanStatsDlComment(ip);
      const markSrc = lanStatsMarkSrcComment(ip);
      const markDst = lanStatsMarkDstComment(ip);
      const block = [
        `:if ([:len [/ip/firewall/mangle/find where comment="${markSrc}"]] = 0) do={` +
        `/ip/firewall/mangle/add chain=prerouting action=mark-connection new-connection-mark=${LAN_STATS_CONN_MARK} passthrough=yes src-address=${ip} comment="${markSrc}"` +
        `}`,
        `:if ([:len [/ip/firewall/mangle/find where comment="${markDst}"]] = 0) do={` +
        `/ip/firewall/mangle/add chain=prerouting action=mark-connection new-connection-mark=${LAN_STATS_CONN_MARK} passthrough=yes dst-address=${ip} comment="${markDst}"` +
        `}`,
        `:if ([:len [/ip/firewall/mangle/find where comment="${ul}"]] = 0) do={` +
        `/ip/firewall/mangle/add chain=forward action=accept passthrough=yes src-address=${ip} comment="${ul}"` +
        `}`,
        `:if ([:len [/ip/firewall/mangle/find where comment="${dl}"]] = 0) do={` +
        `/ip/firewall/mangle/add chain=forward action=accept passthrough=yes dst-address=${ip} comment="${dl}"` +
        `}`,
        `:foreach r in=[/ip/firewall/mangle/find where comment="${ul}"] do={ :if ([/ip/firewall/mangle/get $r chain] = "prerouting") do={ /ip/firewall/mangle/remove $r } }`,
        `:foreach r in=[/ip/firewall/mangle/find where comment="${dl}"] do={ :if ([/ip/firewall/mangle/get $r chain] = "prerouting") do={ /ip/firewall/mangle/remove $r } }`,
      ].join('\n');
      await this.sshExec(block, 15_000).catch(() => {});
    }

    const raw = await this.restGet('/rest/ip/firewall/mangle').catch(() => []);
    if (!Array.isArray(raw)) return;

    const extractIp = (comment: string): string => {
      if (comment.startsWith(LAN_STATS_UL_COMMENT_PREFIX)) {
        return lanStatsIpFromComment(comment, LAN_STATS_UL_COMMENT_PREFIX);
      }
      if (comment.startsWith(LAN_STATS_DL_COMMENT_PREFIX)) {
        return lanStatsIpFromComment(comment, LAN_STATS_DL_COMMENT_PREFIX);
      }
      if (comment.startsWith(LAN_STATS_MARK_SRC_PREFIX)) {
        return lanStatsIpFromComment(comment, LAN_STATS_MARK_SRC_PREFIX);
      }
      if (comment.startsWith(LAN_STATS_MARK_DST_PREFIX)) {
        return lanStatsIpFromComment(comment, LAN_STATS_MARK_DST_PREFIX);
      }
      return '';
    };

    await Promise.all(
      raw
        .filter((row: Record<string, unknown>) => {
          const c = String(row.comment || '');
          if (!c.match(new RegExp(LAN_STATS_RULE_COMMENT_RE))) return false;
          const ip = extractIp(c);
          return !ip || !wantIps.has(ip);
        })
        .map(row => {
          const id = row['.id'];
          if (!id) return Promise.resolve();
          return this.restDelete(`/rest/ip/firewall/mangle/${encodeURIComponent(String(id))}`).catch(() => {});
        }),
    );
  }

  /** Read cumulative upload (tx) / download (rx) bytes per LAN host IP from mangle counters. */
  async getLanMangleTrafficCounters(): Promise<Map<string, { rxBytes: bigint; txBytes: bigint }>> {
    const raw = await this.restGet('/rest/ip/firewall/mangle').catch(() => []);
    const map = new Map<string, { rxBytes: bigint; txBytes: bigint }>();
    if (!Array.isArray(raw)) return map;

    for (const row of raw) {
      const r = row as Record<string, unknown>;
      const comment = String(r.comment || '');
      let ip = '';
      let dir: 'rx' | 'tx' | null = null;
      if (comment.startsWith(LAN_STATS_DL_COMMENT_PREFIX)) {
        ip = lanStatsIpFromComment(comment, LAN_STATS_DL_COMMENT_PREFIX);
        dir = 'rx';
      } else if (comment.startsWith(LAN_STATS_UL_COMMENT_PREFIX)) {
        ip = lanStatsIpFromComment(comment, LAN_STATS_UL_COMMENT_PREFIX);
        dir = 'tx';
      }
      if (!ip || !dir || !isValidLanIpv4(ip)) continue;
      // Chỉ đếm rule forward (bỏ prerouting legacy nếu còn)
      if (String(r.chain || '') !== 'forward') continue;

      const bytes = BigInt(String(r.bytes ?? 0));
      const cur = map.get(ip) ?? { rxBytes: 0n, txBytes: 0n };
      if (dir === 'rx') cur.rxBytes = bytes;
      else cur.txBytes = bytes;
      map.set(ip, cur);
    }
    return map;
  }
}

let _service: MikrotikService | null = null;
export function getMikrotikService(): MikrotikService {
  if (!_service) _service = new MikrotikService();
  return _service;
}
export function resetMikrotikService(): void {
  _service = null;
}