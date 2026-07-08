/** Apply NAT/routing SSH cho pppoe-out2,3 */
const { Client } = require('ssh2');

const HOST = '113.22.235.54';

function ssh(conn, cmd) {
  return new Promise((r, j) => {
    let o = '';
    conn.exec(cmd, (e, s) => {
      if (e) return j(e);
      s.on('close', () => r(o));
      s.on('data', d => { o += d; process.stdout.write(d); });
      s.stderr.on('data', d => { o += d; });
    });
  });
}

function applyIdx(idx, wanIp) {
  const ifName = `pppoe-out${idx}`;
  const rmark = `to_pppoe${idx}`;
  const slot = idx - 1;
  const oct2 = 18 + Math.floor(slot / 255);
  const oct3 = (slot % 255) + 1;
  const ctnIp = `172.${oct2}.${oct3}.2`;
  const gw = `172.${oct2}.${oct3}.1`;
  const httpExt = 30055 + idx;
  const socksExt = 31055 + idx;
  const httpInt = 20000 + idx;
  const socksInt = 21000 + idx;

  return `
:put "=== apply ${ifName} wan=${wanIp} ==="
:do {/ip/firewall/nat/remove [find comment=ctn-${ifName}]} on-error={}
:do {/ip/firewall/nat/remove [find comment=ctn-${ifName}-HTTP]} on-error={}
:do {/ip/firewall/nat/remove [find comment=ctn-${ifName}-SOCKS]} on-error={}
:do {/ip/firewall/mangle/remove [find comment=ctn-mangle-${ifName}]} on-error={}
:do {/ip/route/remove [find routing-table=${rmark}]} on-error={}
:do {/routing/table/remove [find name=${rmark}]} on-error={}
:if ([:len [/routing/table/find name=${rmark}]] = 0) do={/routing/table/add name=${rmark} fib}
/ip/route/add dst-address=0.0.0.0/0 gateway=${ifName} routing-table=${rmark} comment=multi-ip-${ifName}
/ip/firewall/mangle/add chain=prerouting src-address=${ctnIp} action=mark-routing new-routing-mark=${rmark} passthrough=yes comment=ctn-mangle-${ifName}
/ip/firewall/nat/add chain=srcnat src-address=${ctnIp}/32 out-interface=${ifName} action=src-nat to-addresses=${wanIp} comment=ctn-${ifName}
/ip/firewall/nat/add chain=dstnat dst-port=${httpExt} protocol=tcp action=dst-nat to-addresses=${ctnIp} to-ports=${httpInt} comment=ctn-${ifName}-HTTP
/ip/firewall/nat/add chain=dstnat dst-port=${socksExt} protocol=tcp action=dst-nat to-addresses=${ctnIp} to-ports=${socksInt} comment=ctn-${ifName}-SOCKS
:do {/ip/firewall/filter/add chain=forward connection-state=new dst-port=${httpExt} protocol=tcp action=accept comment=webuiproxymikrotik-fwd-http-${idx}} on-error={}
:do {/ip/firewall/filter/add chain=forward connection-state=new dst-port=${socksExt} protocol=tcp action=accept comment=webuiproxymikrotik-fwd-socks-${idx}} on-error={}
:do {/ip/firewall/filter/add chain=input connection-state=new dst-port=${httpExt} protocol=tcp action=accept comment=webuiproxymikrotik-in-http-${idx}} on-error={}
`;
}

(async () => {
  const c = new Client();
  await new Promise((r, j) => { c.on('ready', r); c.on('error', j); c.connect({ host: HOST, port: 22222, username: 'admin', password: 'toanthinh' }); });

  const ips = await ssh(c, '/ip/address/print where interface~"pppoe-out"');
  console.log('PPPoE IPs:\n', ips);

  // out3 only — out2 has APIPA
  await ssh(c, applyIdx(3, '113.22.13.116'));

  console.log('\n=== NAT ===\n', (await ssh(c, '/ip/firewall/nat/print where comment~"ctn-pppoe-out3"')).trim());
  console.log('\n=== mangle ===\n', (await ssh(c, '/ip/firewall/mangle/print where comment~"ctn-mangle-pppoe-out3"')).trim());
  c.end();
})().catch(e => { console.error(e); process.exit(1); });