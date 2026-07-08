// Parse 3proxy hub structured log lines (HUB_LOGFORMAT)
import { HUB_MONITOR_USERNAME } from './hubUtils';

/** Users excluded from request log ingestion (admin/monitor). */
const SKIP_USERS = new Set([HUB_MONITOR_USERNAME, 'ADMIN', '-']);

export interface ParsedProxyLogLine {
  ts: Date;
  errorCode: number;
  username: string;
  clientIp: string;
  clientPort: number;
  destHost: string;
  destPort: number;
  /** Upload bytes (client → remote, 3proxy %O). */
  txBytes: bigint;
  /** Download bytes (remote → client, 3proxy %I). */
  rxBytes: bigint;
  service: string;
  durationMs: number;
}

/**
 * Strip optional 3proxy logformat prefix (- +_L) before timestamp.
 * Example: "1780427602.181 00000 u4899 ..."
 */
export function normalizeLogLine(raw: string): string {
  let line = raw.trim();
  if (!line) return line;
  // Drop RouterOS / container/shell noise lines
  if (line.startsWith('#') || line.includes('error:') || line.includes('syntax error')) return '';
  const tsIdx = line.search(/\d{9,11}\.\d+\s+\d{5}/);
  if (tsIdx > 0) line = line.slice(tsIdx);
  return line;
}

/**
 * Parse one 3proxy log line.
 * Format: %t.%. %E %U %C %c %n %r %O %I %N %D
 */
export function parseProxyLogLine(raw: string): ParsedProxyLogLine | null {
  const line = normalizeLogLine(raw);
  if (!line) return null;

  const m = line.match(
    /^(\d+)\.(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\d+)\s+(\S+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\d+)\s*$/,
  );
  if (!m) return null;

  const [, sec, frac, errStr, username, clientIp, clientPortStr, destHost, destPortStr, outStr, inStr, service, durStr] = m;
  if (SKIP_USERS.has(username)) return null;

  const tsMs = parseInt(sec, 10) * 1000 + Math.min(999, parseInt(frac.padEnd(3, '0').slice(0, 3), 10));
  const ts = new Date(tsMs);
  if (Number.isNaN(ts.getTime())) return null;

  return {
    ts,
    errorCode: parseInt(errStr, 10) || 0,
    username,
    clientIp,
    clientPort: parseInt(clientPortStr, 10) || 0,
    destHost,
    destPort: parseInt(destPortStr, 10) || 0,
    txBytes: BigInt(outStr || '0'),
    rxBytes: BigInt(inStr || '0'),
    service,
    durationMs: parseInt(durStr, 10) || 0,
  };
}

export function dedupeKey(parsed: ParsedProxyLogLine, proxyId: number): string {
  return `${proxyId}:${parsed.ts.getTime()}:${parsed.clientIp}:${parsed.destHost}:${parsed.destPort}:${parsed.txBytes}:${parsed.rxBytes}`;
}

export function shouldIngestLog(username: string): boolean {
  return !SKIP_USERS.has(username);
}