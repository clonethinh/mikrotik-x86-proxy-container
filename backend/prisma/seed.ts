// Seed script - create default admin and load current Mikrotik PPPoE state
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const prisma = new PrismaClient();

async function main() {
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'changeme123';
  const hash = await argon2.hash(password, { type: argon2.argon2id });
  await prisma.adminUser.upsert({
    where: { username },
    create: { username, passwordHash: hash, role: 'admin', enabled: true },
    update: { passwordHash: hash, enabled: true },
  });
  console.log(`Seeded admin: ${username}`);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());