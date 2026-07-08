// Chạy TRONG container: cd /app && node /data/purge-once.js
process.chdir('/app');
process.env.DATABASE_URL = 'file:/data/proxy.db';
const { PrismaClient } = require('/app/node_modules/@prisma/client');
const p = new PrismaClient();

(async () => {
  const disc = await p.wanDiscovery.deleteMany({ where: { pppoeIdx: { gt: 1 } } });
  const wan = await p.wanStatus.deleteMany({ where: { pppoeIdx: { gt: 1 } } });
  const routes = await p.deviceRoute.deleteMany({});
  const proxies = await p.proxyUser.deleteMany({ where: { pppoeIdx: { gt: 1 } } });
  console.log(JSON.stringify({ proxies: proxies.count, wanDiscovery: disc.count, wanStatus: wan.count, deviceRoutes: routes.count }));
  await p.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });