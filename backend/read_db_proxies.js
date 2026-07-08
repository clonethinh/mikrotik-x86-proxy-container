const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: 'file:proxy.db'
    }
  }
});

async function main() {
  const proxies = await prisma.proxyUser.findMany({
    include: {
      healthChecks: { orderBy: { checkedAt: 'desc' }, take: 1 }
    }
  });
  console.log(JSON.stringify(proxies, null, 2));
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
