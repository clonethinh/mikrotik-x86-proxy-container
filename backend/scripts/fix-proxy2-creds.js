const path = require('path');
process.env.DATABASE_URL = 'file:' + path.resolve(__dirname, '../../data/proxy.db').replace(/\\/g, '/');
process.env.SYNC_INDICES = '2';

const { PrismaClient } = require('@prisma/client');
const { execSync } = require('child_process');

async function main() {
  const p = new PrismaClient();
  await p.proxyUser.delete({ where: { pppoeIdx: 2 } }).catch(() => {});
  await p.$disconnect();
  execSync('node scripts/sync-containers.js', { stdio: 'inherit', cwd: __dirname + '/..' });
}

main();