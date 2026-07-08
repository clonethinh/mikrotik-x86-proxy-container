const { Client } = require('ssh2');
const c = new Client();
c.on('ready', async () => {
  const e = cmd => new Promise(r => c.exec(cmd, (er, s) => { let o=''; s.on('data',d=>o+=d); s.on('close',()=>r(o)); }));
  console.log('PPPoE:', (await e('/interface/pppoe-client/print')).trim());
  console.log('\nRemove invalid NAT/mangle for missing pppoe...');
  for (let i = 2; i <= 20; i++) {
    await e(`:do {/ip/firewall/nat/remove [find comment~"pppoe-out${i}"]} on-error={}`);
    await e(`:do {/ip/firewall/mangle/remove [find comment~"pppoe-out${i}"]} on-error={}`);
    await e(`:do {/ip/route/remove [find routing-table=to_pppoe${i}]} on-error={}`);
    await e(`:do {/routing/table/remove [find name=to_pppoe${i}]} on-error={}`);
  }
  console.log('NAT left:', (await e('/ip/firewall/nat/print where comment~"ctn-"')).trim() || '(none)');
  c.end();
});
c.connect({ host: '113.22.235.54', port: 22, username: 'admin', password: 'toanthinh' });