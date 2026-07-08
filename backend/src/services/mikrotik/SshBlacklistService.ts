// SSH brute-force blacklist — thêm IP vào hub-scan-deny (rule drop: hub-rate-limit-scan-drop)
import { config } from '../../lib/config';
import { logger } from '../../lib/logger';
import { getMikrotikService } from './MikrotikService';

export interface SshBlacklistStatus {
  enabled: boolean;
  blacklisted: number;
  strikes: number;
  scriptInstalled: boolean;
  schedulerInterval: string | null;
  dropRule: boolean;
}

export class SshBlacklistService {
  private ensuring = false;

  async ensure(): Promise<void> {
    if (!config.sshBlacklist.enabled) return;
    if (this.ensuring) return;
    this.ensuring = true;
    try {
      const mik = getMikrotikService();
      await mik.sshExec(
        ':do {/ip firewall filter remove [find comment=hub-ssh-blacklist-drop]} on-error={}',
        8_000,
      );
      await mik.sshExec(
        ':do {/ip firewall filter remove [find comment=hub-ssh-blacklist-lan-ok]} on-error={}',
        8_000,
      );
      await mik.sshImportRsc('disk1/webuiproxymikrotik/ensure-ssh-blacklist.rsc', 90_000);
      logger.info('SshBlacklistService.ensure OK');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn({ err: msg.slice(0, 120) }, 'SshBlacklistService.ensure failed');
      throw e;
    } finally {
      this.ensuring = false;
    }
  }

  async getStatus(): Promise<SshBlacklistStatus> {
    const mik = getMikrotikService();
    const blacklisted = await mik.sshExec(
      '/ip firewall address-list print count-only where list=hub-scan-deny and comment~"ssh-brute"',
      8_000,
    ).catch(() => '0');
    const strikes = await mik.sshExec(
      '/ip firewall address-list print count-only where list=hub-ssh-strikes',
      8_000,
    ).catch(() => '0');
    const scriptOut = await mik.sshExec(
      '/system script print count-only where name=hub-ssh-blacklist',
      8_000,
    ).catch(() => '0');
    const schedOut = await mik.sshExec(
      '/system scheduler print detail where name=hub-ssh-blacklist',
      8_000,
    ).catch(() => '');
    const dropOut = await mik.sshExec(
      '/ip firewall filter print count-only where comment=hub-rate-limit-scan-drop',
      8_000,
    ).catch(() => '0');
    const interval = schedOut.match(/interval=([^\s]+)/)?.[1] || null;

    return {
      enabled: config.sshBlacklist.enabled,
      blacklisted: parseInt(blacklisted.trim(), 10) || 0,
      strikes: parseInt(strikes.trim(), 10) || 0,
      scriptInstalled: (parseInt(scriptOut.trim(), 10) || 0) > 0,
      schedulerInterval: interval,
      dropRule: (parseInt(dropOut.trim(), 10) || 0) > 0,
    };
  }
}

export const sshBlacklistService = new SshBlacklistService();