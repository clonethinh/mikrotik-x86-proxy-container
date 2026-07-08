// Auto-proxy settings — persisted in Setting table, env as bootstrap default
import { prisma } from '../../db/prisma';
import { config } from '../../lib/config';

export type AutoProxyMode = 'off' | 'semi' | 'full';

export interface AutoProxySettings {
  mode: AutoProxyMode;
  pollIntervalMs: number;
  countdownMs: number;
  ipWaitTimeoutMs: number;
  maxConcurrent: number;
  warnConcurrent: number;
  staleTtlMs: number;
  goneDebouncePolls: number;
}

const KEY = 'auto_proxy_settings';

function defaults(): AutoProxySettings {
  return { ...config.autoProxy };
}

export async function getAutoProxySettings(): Promise<AutoProxySettings> {
  try {
    const row = await prisma.setting.findUnique({ where: { key: KEY } });
    if (!row) return defaults();
    const parsed = JSON.parse(row.value);
    return { ...defaults(), ...parsed };
  } catch {
    return defaults();
  }
}

export async function setAutoProxySettings(patch: Partial<AutoProxySettings>): Promise<AutoProxySettings> {
  const current = await getAutoProxySettings();
  const next: AutoProxySettings = { ...current, ...patch };
  if (!['off', 'semi', 'full'].includes(next.mode)) {
    throw new Error('mode phải là off | semi | full');
  }
  await prisma.setting.upsert({
    where: { key: KEY },
    create: { key: KEY, value: JSON.stringify(next) },
    update: { value: JSON.stringify(next) },
  });
  return next;
}