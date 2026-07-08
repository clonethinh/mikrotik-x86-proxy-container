/**
 * Cấu hình mạng router mới: WAN (macvlan + pppoe-wan), LAN bridge, DHCP.
 * Idempotent — chạy lại an toàn.
 */
function escapeRosStr(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function buildNetworkPlan(net) {
  const wan = net.wanPort;
  const lanPorts = net.lanPorts || [];
  const bridge = net.bridgeLan || 'bridge-lan';
  const macvlan = net.macvlanName || 'macvlan-wan';
  const gw = net.lanGateway || '192.168.88.1';
  const cidr = net.lanSubnet || '192.168.88.0/24';
  const poolName = net.dhcpPoolName || 'dhcp-lan';
  const dhcpName = net.dhcpServerName || 'dhcp-lan';
  const poolStart = net.dhcpPoolStart || '192.168.88.10';
  const poolEnd = net.dhcpPoolEnd || '192.168.88.254';
  const pppoe = net.pppoeWan || {};
  const user = escapeRosStr(pppoe.user);
  const pass = escapeRosStr(pppoe.password || pppoe.pass || '');

  const cmds = [];

  cmds.push(`:put "=== network-bootstrap: WAN=${wan} LAN=${lanPorts.join(',')} ==="`);

  // LAN bridge + ports
  cmds.push(`:if ([:len [/interface/bridge/find name=${bridge}]] = 0) do={/interface/bridge/add name=${bridge} comment=webui-lan}`);
  for (const lp of lanPorts) {
    cmds.push(`:if ([:len [/interface/bridge/port/find where bridge=${bridge} interface=${lp}]] = 0) do={/interface/bridge/port/add bridge=${bridge} interface=${lp} comment=lan-port}`);
  }

  cmds.push(`:if ([:len [/ip/address/find where address="${gw}/${cidr.split('/')[1] || '24'}" interface=${bridge}]] = 0) do={/ip/address/add address=${gw}/${cidr.split('/')[1] || '24'} interface=${bridge} comment=lan-gw}`);

  if (net.dhcpEnabled !== false) {
    cmds.push(`:if ([:len [/ip/pool/find name=${poolName}]] = 0) do={/ip/pool/add name=${poolName} ranges=${poolStart}-${poolEnd}}`);
    cmds.push(`:if ([:len [/ip/dhcp-server/find name=${dhcpName}]] = 0) do={/ip/dhcp-server/add name=${dhcpName} interface=${bridge} address-pool=${poolName} lease-time=1d disabled=no}`);
    cmds.push(`:if ([:len [/ip/dhcp-server/network/find where address=${cidr}]] = 0) do={/ip/dhcp-server/network/add address=${cidr} gateway=${gw} dns-server=${gw}}`);
  }

  // WAN macvlan + pppoe-wan
  cmds.push(`:if ([:len [/interface/macvlan/find name=${macvlan}]] = 0) do={/interface/macvlan/add name=${macvlan} interface=${wan} comment=wan-macvlan}`);
  cmds.push(`:if ([:len [/interface/pppoe-client/find name=pppoe-wan]] = 0) do={/interface/pppoe-client/add name=pppoe-wan interface=${macvlan} user="${user}" password="${pass}" profile=${pppoe.profile || 'default'} add-default-route=yes default-route-distance=1 disabled=no comment=WAN-DDNS-PROTECTED}`);
  cmds.push(`:if ([:len [/interface/pppoe-client/find name=pppoe-wan]] > 0) do={/interface/pppoe-client/set [find name=pppoe-wan] user="${user}" password="${pass}" disabled=no comment=WAN-DDNS-PROTECTED}`);

  const poolCount = Math.max(0, parseInt(String(net.initialProxyCount ?? 1), 10) || 0);
  const createN = poolCount > 0 ? poolCount : 1;
  for (let i = 1; i <= createN; i++) {
    const name = `pppoe-out${i}`;
    cmds.push(`:if ([:len [/interface/pppoe-client/find name=${name}]] = 0) do={/interface/pppoe-client/add name=${name} interface=${macvlan} user="${user}" password="${pass}" profile=${pppoe.profile || 'default'} add-default-route=no use-peer-dns=no disabled=yes comment="proxy pool ${i}"}`);
  }

  // NAT LAN → WAN
  cmds.push(`:if ([:len [/ip/firewall/nat/find where comment=webui-lan-masquerade]] = 0) do={/ip/firewall/nat/add chain=srcnat out-interface=pppoe-wan action=masquerade comment=webui-lan-masquerade}`);

  cmds.push(':put "=== network-bootstrap DONE ==="');
  return cmds.join('\n');
}

module.exports = { buildNetworkPlan, escapeRosStr };