// Prisma client singleton
import { PrismaClient } from '@prisma/client';
import { config } from '../lib/config';
import { logger } from '../lib/logger';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma || new PrismaClient({
  log: config.env === 'development' ? ['query', 'warn', 'error'] : ['warn', 'error'],
});

if (config.env !== 'production') globalForPrisma.prisma = prisma;

export async function initDb(): Promise<void> {
  try {
    await prisma.$connect();
    try {
      // PRAGMA * trả về row — dùng $queryRawUnsafe, không $executeRawUnsafe
      await prisma.$queryRawUnsafe('PRAGMA journal_mode=WAL;');
      await prisma.$queryRawUnsafe('PRAGMA synchronous=NORMAL;');
    } catch { /* non-sqlite */ }
    logger.info('Prisma connected to ' + config.databaseUrl);
  } catch (e) {
    logger.error({ err: e }, 'Prisma connect failed');
    throw e;
  }
}

export async function closeDb(): Promise<void> {
  await prisma.$disconnect();
}