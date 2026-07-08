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
    defaultInterval: '10m',
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

  async run(name: ManagedRouterScriptName): Promise<{ ok: boolean; message: string }> {
    const meta = this.meta(name);
    const mik = getMikrotikService();
    const timeout = meta.longRunning ? 600_000 : 60_000;
    logger.info({ script: name }, 'RouterScriptService.run');
    await mik.sshExec(`/system script run ${name}`, timeout);
    return { ok: true, message: `Đã chạy ${meta.label}` };
  }

  async ensureInstalled(): Promise<void> {
    const mik = getMikrotikService();
    logger.info('RouterScriptService.ensureInstalled');
    await mik.sshImportRsc('disk1/webuiproxymikrotik/ensure-router-scripts.rsc', 120_000);
  }
}

let _instance: RouterScriptService | null = null;
export function getRouterScriptService(): RouterScriptService {
  if (!_instance) _instance = new RouterScriptService();
  return _instance;
}