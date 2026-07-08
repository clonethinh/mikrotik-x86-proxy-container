// Auth service - JWT + argon2
import argon2 from 'argon2';
import { prisma } from '../../db/prisma';
import { logger } from '../../lib/logger';

export class AuthService {
  async hashPassword(pw: string): Promise<string> {
    return argon2.hash(pw, { type: argon2.argon2id });
  }

  async verifyPassword(hash: string, pw: string): Promise<boolean> {
    try { return await argon2.verify(hash, pw); } catch { return false; }
  }

  async ensureAdminUser(username: string, password: string): Promise<void> {
    const existing = await prisma.adminUser.findUnique({ where: { username } });
    if (existing) return;
    const hash = await this.hashPassword(password);
    await prisma.adminUser.create({
      data: { username, passwordHash: hash, role: 'admin', enabled: true },
    });
    logger.info({ username }, 'seeded admin user');
  }

  async login(username: string, password: string): Promise<{ id: number; username: string; role: string } | null> {
    const user = await prisma.adminUser.findUnique({ where: { username } });
    if (!user || !user.enabled) return null;
    const ok = await this.verifyPassword(user.passwordHash, password);
    if (!ok) return null;
    await prisma.adminUser.update({ where: { id: user.id }, data: { lastLogin: new Date() } });
    return { id: user.id, username: user.username, role: user.role };
  }

  async changePassword(userId: number, oldPw: string, newPw: string): Promise<boolean> {
    const user = await prisma.adminUser.findUnique({ where: { id: userId } });
    if (!user) return false;
    const ok = await this.verifyPassword(user.passwordHash, oldPw);
    if (!ok) return false;
    const hash = await this.hashPassword(newPw);
    await prisma.adminUser.update({ where: { id: userId }, data: { passwordHash: hash } });
    return true;
  }
}

export const authService = new AuthService();