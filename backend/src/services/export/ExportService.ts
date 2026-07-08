// Export service - render proxy list to various formats
import type { ProxyUser } from '@prisma/client';

export type ExportFormat =
  | 'ipportuserpass'      // 1.2.3.4:30055:user:pass
  | 'userpassipport'      // user:pass@1.2.3.4:30055
  | 'httpurl'             // http://user:pass@1.2.3.4:30055
  | 'socks5url'           // socks5://user:pass@1.2.3.4:31055
  | 'ipport'              // 1.2.3.4:30055 (no auth)
  | 'template';           // {scheme}://{user}:{pass}@{ip}:{port}

export interface ExportInput {
  proxies: Array<ProxyUser>;
  format: ExportFormat;
  template?: string; // for format=template
  includeSocks?: boolean;
}

function pickPort(p: ProxyUser, socks = false): number {
  if (socks) return p.extSocksPort || p.socksPort || 0;
  return p.extHttpPort || p.httpPort || 0;
}

function pickScheme(socks = false): string {
  return socks ? 'socks5' : 'http';
}

function getIp(p: ProxyUser): string {
  return p.publicIp || '';
}

function templateRender(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}

export function renderExport(input: ExportInput): string {
  const lines: string[] = [];

  for (const p of input.proxies) {
    const httpPort = pickPort(p, false);
    const socksPort = pickPort(p, true);
    const ip = getIp(p);
    if (!ip) continue;

    if (input.format === 'ipportuserpass') {
      lines.push(`${ip}:${httpPort}:${p.username}:${p.password}`);
      if (input.includeSocks && socksPort) {
        lines.push(`${ip}:${socksPort}:${p.username}:${p.password}`);
      }
    } else if (input.format === 'userpassipport') {
      lines.push(`${p.username}:${p.password}@${ip}:${httpPort}`);
      if (input.includeSocks && socksPort) {
        lines.push(`${p.username}:${p.password}@${ip}:${socksPort}`);
      }
    } else if (input.format === 'httpurl') {
      lines.push(`http://${p.username}:${p.password}@${ip}:${httpPort}`);
      if (input.includeSocks && socksPort) {
        lines.push(`socks5://${p.username}:${p.password}@${ip}:${socksPort}`);
      }
    } else if (input.format === 'socks5url') {
      lines.push(`socks5://${p.username}:${p.password}@${ip}:${socksPort || httpPort}`);
    } else if (input.format === 'ipport') {
      lines.push(`${ip}:${httpPort}`);
      if (input.includeSocks && socksPort) {
        lines.push(`${ip}:${socksPort}`);
      }
    } else if (input.format === 'template') {
      const tpl = input.template || '{scheme}://{user}:{pass}@{ip}:{port}';
      lines.push(templateRender(tpl, {
        scheme: 'http', ip, port: String(httpPort), user: p.username, pass: p.password,
      }));
      if (input.includeSocks && socksPort) {
        lines.push(templateRender(tpl, {
          scheme: 'socks5', ip, port: String(socksPort), user: p.username, pass: p.password,
        }));
      }
    }
  }
  return lines.join('\n');
}

export function exportToFile(format: 'txt' | 'csv' | 'json', content: string, proxies: ProxyUser[]): { content: string; mime: string; ext: string } {
  if (format === 'txt') return { content, mime: 'text/plain', ext: 'txt' };
  if (format === 'csv') {
    const rows = ['pppoe_name,ip,http_port,socks_port,username,password,enabled,status,public_ip'];
    for (const p of proxies) {
      rows.push([
        p.pppoeName, p.publicIp || '', String(p.extHttpPort), String(p.extSocksPort || ''),
        p.username, p.password, String(p.enabled), p.status, p.publicIp || '',
      ].map(x => `"${(x || '').replace(/"/g, '""')}"`).join(','));
    }
    return { content: rows.join('\n'), mime: 'text/csv', ext: 'csv' };
  }
  // json
  return { content: JSON.stringify(proxies.map(p => ({
    pppoeIdx: p.pppoeIdx, pppoeName: p.pppoeName, publicIp: p.publicIp,
    extHttpPort: p.extHttpPort, extSocksPort: p.extSocksPort,
    username: p.username, password: p.password, enabled: p.enabled, status: p.status,
  })), null, 2), mime: 'application/json', ext: 'json' };
}