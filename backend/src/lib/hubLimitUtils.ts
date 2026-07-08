// Helpers to generate 3proxy limit directives (bandlim, countall, connlim, time ACL)

export interface ProxyLimitInput {
  quotaDailyMb?: number | null;
  quotaWeeklyMb?: number | null;
  quotaMonthlyMb?: number | null;
  speedDownKbps?: number | null;
  speedUpKbps?: number | null;
  maxConnections?: number | null;
  allowedHours?: string | null;
  expiresAt?: Date | null;
  enabled?: boolean;
}

export interface AllowedHoursConfig {
  weekdays?: string;
  periods?: string[];
}

export function parseAllowedHours(raw: string | null | undefined): AllowedHoursConfig | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as AllowedHoursConfig;
    if (!v?.weekdays && !v?.periods?.length) return null;
    return v;
  } catch {
    return null;
  }
}

export function isLimitExpired(limit: ProxyLimitInput | null | undefined): boolean {
  if (!limit?.expiresAt) return false;
  return limit.expiresAt.getTime() < Date.now();
}

/** Unique counter slot numbers per pppoeIdx (daily=+0, weekly=+1000, monthly=+2000). */
export function counterNumbers(pppoeIdx: number): { daily: number; weekly: number; monthly: number } {
  return { daily: pppoeIdx, weekly: pppoeIdx + 1000, monthly: pppoeIdx + 2000 };
}

export function buildUserLimitLines(
  username: string,
  pppoeIdx: number,
  limit: ProxyLimitInput | null | undefined,
): string[] {
  if (!limit?.enabled) return [];
  if (isLimitExpired(limit)) return [`# ${username}: expired — excluded from users`];

  const u = username;
  const lines: string[] = [];

  if (limit.speedDownKbps && limit.speedDownKbps > 0) {
    lines.push(`bandlimin ${limit.speedDownKbps * 1000} ${u}`);
  }
  if (limit.speedUpKbps && limit.speedUpKbps > 0) {
    lines.push(`bandlimout ${limit.speedUpKbps * 1000} ${u}`);
  }

  const nums = counterNumbers(pppoeIdx);
  if (limit.quotaDailyMb && limit.quotaDailyMb > 0) {
    lines.push(`countall ${nums.daily} D ${limit.quotaDailyMb} ${u}`);
  }
  if (limit.quotaWeeklyMb && limit.quotaWeeklyMb > 0) {
    lines.push(`countall ${nums.weekly} W ${limit.quotaWeeklyMb} ${u}`);
  }
  if (limit.quotaMonthlyMb && limit.quotaMonthlyMb > 0) {
    lines.push(`countall ${nums.monthly} M ${limit.quotaMonthlyMb} ${u}`);
  }

  if (limit.maxConnections && limit.maxConnections > 0) {
    lines.push(`connlim ${limit.maxConnections} 0 ${u}`);
  }

  return lines;
}

export function buildUserTimeAllowLine(username: string, limit: ProxyLimitInput | null | undefined): string | null {
  const hours = parseAllowedHours(limit?.allowedHours ?? null);
  if (!hours) return null;
  const weekdays = hours.weekdays || '*';
  const periods = (hours.periods || []).join(',') || '*';
  return `allow ${username} * * * * ${weekdays} ${periods}`;
}

export function buildUserTimeDenyLine(username: string, limit: ProxyLimitInput | null | undefined): string | null {
  const hours = parseAllowedHours(limit?.allowedHours ?? null);
  if (!hours) return null;
  return `deny ${username}`;
}