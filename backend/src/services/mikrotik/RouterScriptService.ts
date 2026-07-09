// RouterOS system scripts — quayip, duckdns, protect (import + run + status)
import { getMikrotikService } from './MikrotikService';
import { logger } from '../../lib/logger';

export const MANAGED_ROUTER_SCRIPTS = [
  {
    name: 'quayip',
    label: 'Quay IP PPPoE',
    description: 'Kiểm tra IP pool pppoe-out1..N, quay số khi IP xấu/mất net. Bỏ qua pppoe-wan.',
    rsc: 'disk1/webuiproxymikrotik/quayip.rsc',
    schedulerNames: ['quayip-scheduler', 'schedule1'],
    defaultInterval: '5m',
    longRunning: true,
  },
  {
    name: 'duckdns-pppoe-wan',
    label: 'DuckDNS',
    description: 'Cập nhật DuckDNS từ IP pppoe-wan (luồng quản trị).',
    rsc: 'disk1/webuiproxymikrotik/duckdns-pppoe-wan.rsc',
    schedulerNames: ['duckdns-pppoe-wan'],
    defaultInterval: '5m',
    longRunning: false,
  },
  {
    name: 'protect-pppoe-wan',
    label: 'Bảo vệ pppoe-wan',
    description: 'Không cho disable/xóa pppoe-wan — WebUI & SSH luôn reachable.',
    rsc: 'disk1/webuiproxymikrotik/protect-pppoe-wan.rsc',
    schedulerNames: ['protect-pppoe-wan'],
    defaultInterval: '2m',
    longRunning: false,
  },
  {
    name: 'hub-ssh-blacklist',
    label: 'SSH blacklist',
    description: 'Đọc log login failure SSH → blacklist IP sau 5 lần sai (1 ngày).',
    rsc: 'disk1/webuiproxymikrotik/ensure-ssh-blacklist.rsc',
    schedulerNames: ['hub-ssh-blacklist'],
    defaultInterval: '1m',
    longRunning: false,
  },
] as const;

export type ManagedRouterScriptName = (typeof MANAGED_ROUTER_SCRIPTS)[number]['name'];

export interface RouterScriptStatus {
  name: ManagedRouterScriptName;
  label: string;
  description: string;
  installed: boolean;
  runCount: number;
  lastStarted: string | null;
  scheduler: {
    name: string;
    interval: string | null;
    nextRun: string | null;
    disabled: boolean;
  } | null;
}

export interface RouterScriptIpChange {
  pppoeName: string;
  before: string | null;
  after: string | null;
}

export interface RouterScriptInstallChange {
  name: ManagedRouterScriptName;
  label: string;
  wasInstalled: boolean;
  nowInstalled: boolean;
  runCountBefore: number;
  runCountAfter: number;
}

export interface RouterScriptActionResult {
  ok: boolean;
  action: 'ensure' | 'run';
  script?: ManagedRouterScriptName;
  durationMs: number;
  summary: string;
  outputLines: string[];
  logLines: string[];
  installChanges: RouterScriptInstallChange[];
  ipChanges: RouterScriptIpChange[];
  at: string;
}

function normalizeRos(text: string): string {
  return text.replace(/\r/g, '');
}

function parseKeyValues(text: string): Record<string, string> {
  const map: Record<string, string> = {};
  const re = /([\w-]+)=("[^"]*"|\S+)/g;
  let m: RegExpExecArray | null;
  const normalized = normalizeRos(text);
  while ((m = re.exec(normalized)) !== null) {
    map[m[1]] = m[2].replace(/^"|"$/g, '');
  }
  return map;
}

/** RouterOS marks disabled entries with X on the header line (before indented name=). */
function entryDisabled(out: string, name: string): boolean {
  const text = normalizeRos(out);
  const needle = `name="${name}"`;
  const idx = text.indexOf(needle);
  if (idx < 0) return false;
  const nameLineStart = text.lastIndexOf('\n', idx) + 1;
  const nameLineEnd = text.indexOf('\n', idx);
  const nameLine = text.slice(nameLineStart, nameLineEnd === -1 ? undefined : nameLineEnd);
  if (/^\s*X\s+\d/.test(nameLine)) return true;
  const headerStart = text.lastIndexOf('\n', Math.max(0, nameLineStart - 2)) + 1;
  const headerLine = text.slice(headerStart, nameLineStart).replace(/\n$/, '');
  return /^\s*X\s+\d/.test(headerLine);
}

function parseNextRun(chunk: string): string | null {
  const m = normalizeRos(chunk).match(/next-run=([0-9-]+ [0-9:]+)/);
  return m?.[1] || null;
}

/** Lọc dòng SSH/RouterOS có nội dung hữu ích cho UI. */
function isRosNoiseLine(line: string): boolean {
  return /sshd failed|ssh-cmd:|no such item|\/container\/shell|syntax error|please check it manually/i.test(line);
}

function parseOutputLines(text: string): string[] {
  const skip = /^(Flags:|Columns:|\d+\s|$)/;
  return normalizeRos(text)
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0 && !skip.test(l) && !isRosNoiseLine(l));
}

function parseLogLines(text: string): string[] {
  return normalizeRos(text)
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0 && !l.startsWith('Flags:') && !l.startsWith('Columns:') && !isRosNoiseLine(l))
    .slice(-40);
}

function diffInstallChanges(
  before: RouterScriptStatus[],
  after: RouterScriptStatus[],
): RouterScriptInstallChange[] {
  const beforeMap = new Map(before.map(s => [s.name, s]));
  return after.map(s => {
    const prev = beforeMap.get(s.name);
    return {
      name: s.name,
      label: s.label,
      wasInstalled: prev?.installed ?? false,
      nowInstalled: s.installed,
      runCountBefore: prev?.runCount ?? 0,
      runCountAfter: s.runCount,
    };
  }).filter(c => !c.wasInstalled && c.nowInstalled
    || c.wasInstalled !== c.nowInstalled
    || c.runCountAfter !== c.runCountBefore);
}

function diffIpChanges(
  before: Map<string, string | null>,
  after: Map<string, string | null>,
): RouterScriptIpChange[] {
  const changes: RouterScriptIpChange[] = [];
  for (const [pppoeName, afterIp] of after) {
    const beforeIp = before.get(pppoeName) ?? null;
    if (beforeIp !== afterIp) {
      changes.push({ pppoeName, before: beforeIp, after: afterIp });
    }
  }
  return changes.sort((a, b) => a.pppoeName.localeCompare(b.pppoeName));
}

function buildEnsureSummary(
  outputLines: string[],
  installChanges: RouterScriptInstallChange[],
): string {
  const newly = installChanges.filter(c => !c.wasInstalled && c.nowInstalled).length;
  const steps = outputLines.filter(l => l.includes('[router-scripts]') || l.includes('DONE') || l.includes(':')).length;
  if (newly > 0) return `Cài mới ${newly} script · ${steps || outputLines.length} bước import`;
  if (outputLines.some(l => l.includes('DONE'))) return `Đã cập nhật script trên router · ${steps || outputLines.length} bước`;
  return `Import xong · ${outputLines.length} dòng output`;
}

function buildRunSummary(
  name: ManagedRouterScriptName,
  meta: (typeof MANAGED_ROUTER_SCRIPTS)[number],
  ipChanges: RouterScriptIpChange[],
  logLines: string[],
  runCountDelta: number,
): string {
  if (name === 'quayip') {
    const rotated = ipChanges.filter(c => c.before !== c.after && c.after).length;
    const dead = logLines.filter(l => /DISABLED|bi TAT|TAT/.test(l)).length;
    if (rotated > 0) return `Quay IP: ${rotated} WAN đổi IP${dead > 0 ? ` · ${dead} WAN tắt` : ''}`;
    if (ipChanges.length > 0) return `Quay IP: kiểm tra ${ipChanges.length} WAN · không đổi IP`;
    return 'Quay IP xong — xem log chi tiết bên dưới';
  }
  if (runCountDelta > 0) return `${meta.label}: chạy xong (run +${runCountDelta})`;
  return `${meta.label}: chạy xong`;
}

/** Script metadata (run-count, last-started) sits on lines before source=. */
function parseScriptMeta(out: string, name: string): { runCount: number; lastStarted: string | null } {
  const text = normalizeRos(out);
  const needle = `name="${name}"`;
  const idx = text.indexOf(needle);
  if (idx < 0) return { runCount: 0, lastStarted: null };
  const sourceIdx = text.indexOf('source=', idx);
  const metaBlock = sourceIdx > idx ? text.slice(idx, sourceIdx) : text.slice(idx, idx + 800);
  const runCount = parseInt(metaBlock.match(/run-count=(\d+)/)?.[1] || '0', 10) || 0;
  const lastStarted = metaBlock.match(/last-started=([0-9-]+ [0-9:]+)/)?.[1] || null;
  return { runCount, lastStarted };
}

export class RouterScriptService {
  private meta(name: string) {
    const m = MANAGED_ROUTER_SCRIPTS.find(s => s.name === name);
    if (!m) throw new Error(`Script không được quản lý: ${name}`);
    return m;
  }

  async getStatus(name: ManagedRouterScriptName): Promise<RouterScriptStatus> {
    const meta = this.meta(name);
    const mik = getMikrotikService();
    const scriptOut = await mik.sshExec(
      `/system script print detail where name=${name}`,
      12_000,
    ).catch(() => '');

    const installed = scriptOut.includes(`name="${name}"`);
    const { runCount, lastStarted } = parseScriptMeta(scriptOut, name);

    let scheduler: RouterScriptStatus['scheduler'] = null;
    for (const schedName of meta.schedulerNames) {
      const schedOut = await mik.sshExec(
        `/system scheduler print detail where name=${schedName}`,
        8_000,
      ).catch(() => '');
      if (!schedOut.includes(`name="${schedName}"`)) continue;
      const idx = schedOut.indexOf(`name="${schedName}"`);
      const chunk = schedOut.slice(Math.max(0, idx - 80), idx + 280);
      const sf = parseKeyValues(chunk);
      scheduler = {
        name: schedName,
        interval: sf.interval || meta.defaultInterval,
        nextRun: parseNextRun(chunk) || sf['next-run'] || null,
        disabled: entryDisabled(schedOut, schedName) || sf.disabled === 'yes',
      };
      break;
    }

    return {
      name: meta.name,
      label: meta.label,
      description: meta.description,
      installed,
      runCount,
      lastStarted,
      scheduler,
    };
  }

  async listStatus(): Promise<RouterScriptStatus[]> {
    return Promise.all(MANAGED_ROUTER_SCRIPTS.map(s => this.getStatus(s.name)));
  }

  private async snapshotPppoeIps(): Promise<Map<string, string | null>> {
    const mik = getMikrotikService();
    const pppoes = await mik.getPppoeInterfaces().catch(() => []);
    const map = new Map<string, string | null>();
    for (const p of pppoes) {
      if (p.name.startsWith('pppoe-out')) map.set(p.name, p.publicIp || null);
    }
    return map;
  }

  private async fetchRecentScriptLogs(scriptName: string): Promise<string[]> {
    const mik = getMikrotikService();
    const where = scriptName === 'quayip'
      ? 'message~"quayip" || message~"KETQUA" || message~"BAO CAO"'
      : `message~"${scriptName}"`;
    const out = await mik.sshExec(`/log print where (${where})`, 12_000).catch(() => '');
    return parseLogLines(out).slice(-25);
  }

  async run(name: ManagedRouterScriptName): Promise<RouterScriptActionResult> {
    const meta = this.meta(name);
    const mik = getMikrotikService();
    const timeout = meta.longRunning ? 600_000 : 60_000;
    const t0 = Date.now();
    logger.info({ script: name }, 'RouterScriptService.run');

    const beforeStatus = await this.getStatus(name);
    const beforeIps = meta.longRunning ? await this.snapshotPppoeIps() : new Map<string, string | null>();

    const raw = await mik.sshExec(`/system script run ${name}`, timeout);
    const outputLines = parseOutputLines(raw);

    if (meta.longRunning) await new Promise(r => setTimeout(r, 1500));

    const afterStatus = await this.getStatus(name);
    const afterIps = meta.longRunning ? await this.snapshotPppoeIps() : beforeIps;
    const ipChanges = meta.longRunning ? diffIpChanges(beforeIps, afterIps) : [];
    const logLines = await this.fetchRecentScriptLogs(name);
    const runCountDelta = afterStatus.runCount - beforeStatus.runCount;

    const summary = buildRunSummary(name, meta, ipChanges, logLines, runCountDelta);
    return {
      ok: true,
      action: 'run',
      script: name,
      durationMs: Date.now() - t0,
      summary,
      outputLines,
      logLines,
      installChanges: [],
      ipChanges,
      at: new Date().toISOString(),
    };
  }

  async ensureInstalled(): Promise<RouterScriptActionResult> {
    const mik = getMikrotikService();
    const t0 = Date.now();
    logger.info('RouterScriptService.ensureInstalled');
    const before = await this.listStatus();
    const raw = await mik.sshImportRsc('disk1/webuiproxymikrotik/ensure-router-scripts.rsc', 120_000);
    const after = await this.listStatus();
    const outputLines = parseOutputLines(raw);
    const installChanges = diffInstallChanges(before, after);
    const summary = buildEnsureSummary(outputLines, installChanges);
    return {
      ok: true,
      action: 'ensure',
      durationMs: Date.now() - t0,
      summary,
      outputLines,
      logLines: [],
      installChanges,
      ipChanges: [],
      at: new Date().toISOString(),
    };
  }
}

let _instance: RouterScriptService | null = null;
export function getRouterScriptService(): RouterScriptService {
  if (!_instance) _instance = new RouterScriptService();
  return _instance;
}