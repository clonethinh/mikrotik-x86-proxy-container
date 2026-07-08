process.chdir('/app');
const { PrismaClient } = require('/app/node_modules/@prisma/client');
const p = new PrismaClient();

async function main() {
  const tables = await p.$queryRaw`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`;
  console.log('tables', tables.map((t) => t.name).join(','));

  const n = await p.proxyTrafficSample.count();
  console.log('samples_total', n);

  try {
    await p.proxyTrafficSample.create({
      data: {
        proxyId: 18,
        ts: new Date(),
        rxBytes: 100n,
        txBytes: 50n,
        rxBps: 10,
        txBps: 5,
        clients: 1,
      },
    });
    console.log('insert_test', 'ok');
  } catch (e) {
    console.log('insert_test', 'fail', e.message);
  }

  const n2 = await p.proxyTrafficSample.count();
  console.log('samples_after_insert', n2);
}

main().finally(() => p.$disconnect());