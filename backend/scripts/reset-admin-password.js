const argon2 = require('argon2');
const { PrismaClient } = require('@prisma/client');
const path = require('path');

const dbPath = path.resolve(__dirname, '../../data/proxy.db');
const prisma = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } } });

async function main() {
  const password = process.argv[2] || 'admin123';
  const hash = await argon2.hash(password, { type: argon2.argon2id });
  await prisma.adminUser.upsert({
    where: { username: 'admin' },
    create: { username: 'admin', passwordHash: hash, role: 'admin', enabled: true },
    update: { passwordHash: hash, enabled: true },
  });
  console.log(`admin password -> ${password}`);
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });