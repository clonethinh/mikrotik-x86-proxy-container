// Input validation helpers - lightweight, no class-validator (hangs in WSL Node 22)
import { z } from 'zod';
import { maxPppoeIdx } from './networkUtils';

export const pppoeIdxSchema = z.number().int().min(1).max(maxPppoeIdx());
export const proxyTypeSchema = z.enum(['http', 'socks5', 'both']);
export const usernameSchema = z.string().regex(/^[a-zA-Z0-9_-]{3,32}$/, 'username chỉ gồm chữ/số/_/- dài 3-32');
export const passwordSchema = z.string().min(6).max(64);

export function safeInterfaceName(s: string): boolean {
  return /^veth-3p-\d+$/.test(s);
}

export function sanitizeForRouterOS(s: string, maxLen = 64): string {
  // RouterOS command injection: only allow safe chars
  return s.replace(/[^a-zA-Z0-9_.\-:=@\/]/g, '').slice(0, maxLen);
}

// Strip HTML/JS from user-provided notes (defense in depth - frontend cũng escape)
export function sanitizeNote(s: string, maxLen = 255): string {
  return s
    .replace(/<[^>]*>/g, '')              // strip HTML tags
    .replace(/javascript:/gi, '')        // strip js: protocol
    .replace(/on\w+\s*=/gi, '')           // strip on*= handlers
    .replace(/[\x00-\x08\x0B-\x1F\x7F]/g, '') // strip control chars
    .trim()
    .slice(0, maxLen);
}

export function randomPassword(len = 12): string {
  const charset = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let pwd = '';
  for (let i = 0; i < len; i++) {
    pwd += charset[Math.floor(Math.random() * charset.length)];
  }
  return pwd;
}

export function randomUsername(prefix = 'u'): string {
  return `${prefix}${Math.floor(Math.random() * 9000 + 1000)}`;
}

const MAC_RE = /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/;
const IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)$/;

export function isValidMac(mac: string): boolean {
  return MAC_RE.test(mac.trim());
}

export function isValidIpv4(ip: string): boolean {
  return IPV4_RE.test(ip.trim());
}

export function normalizeMac(mac: string): string {
  return mac.trim().toUpperCase().replace(/-/g, ':');
}

export function safePppoeName(name: string): boolean {
  const m = name.match(/^pppoe-out(\d+)$/);
  if (!m) return false;
  const idx = parseInt(m[1], 10);
  return idx >= 1 && idx <= maxPppoeIdx();
}