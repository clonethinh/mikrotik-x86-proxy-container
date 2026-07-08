#!/usr/bin/env node
/** One-shot: áp LAN traffic mangle (forward + conn-mark) qua REST — không cần SSH WAN */
const { loadDeployConfig } = require('./lib/deploy-config');

const cfg = loadDeployConfig();

async function rest(method, path, body) {
  const res = await fetch(`${cfg.rest}${path}`, {
    method,
    headers: { Authorization: `Basic ${cfg.auth}`, 'Content-Type': 'application/json' },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} HTTP ${res.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

async function ros(script) {
  try {
    await rest('POST', '/rest/execute', { script });
  } catch (e) {
    if (!String(e.message).includes('Session closed')) throw e;
  }
}

async function main() {
  const leases = await rest('GET', '/rest/ip/dhcp-server/lease');
  const ips = [...new Set(
    (leases || [])
      .filter((l) => l.status === 'bound' && /^192\.168\.\d+\.\d+$/.test(String(l.address || '')))
      .map((l) => l.address),
  )];
  console.log(`Bound LAN IPs: ${ips.length}`);

  await ros(
    ':do {/ip firewall filter set [find where action=fasttrack-connection] connection-mark=no-mark connection-state=established,related} on-error={}',
  );

  for (const ip of ips) {
    const block = [
      `:if ([:len [/ip/firewall/mangle/find where comment="webui-lan-mark-src-${ip}"]] = 0) do={/ip/firewall/mangle/add chain=prerouting action=mark-connection new-connection-mark=webui-lan-stats passthrough=yes src-address=${ip} comment="webui-lan-mark-src-${ip}"}`,
      `:if ([:len [/ip/firewall/mangle/find where comment="webui-lan-mark-dst-${ip}"]] = 0) do={/ip/firewall/mangle/add chain=prerouting action=mark-connection new-connection-mark=webui-lan-stats passthrough=yes dst-address=${ip} comment="webui-lan-mark-dst-${ip}"}`,
      `:if ([:len [/ip/firewall/mangle/find where comment="webui-lan-ul-${ip}"]] = 0) do={/ip/firewall/mangle/add chain=forward action=accept passthrough=yes src-address=${ip} comment="webui-lan-ul-${ip}"}`,
      `:if ([:len [/ip/firewall/mangle/find where comment="webui-lan-dl-${ip}"]] = 0) do={/ip/firewall/mangle/add chain=forward action=accept passthrough=yes dst-address=${ip} comment="webui-lan-dl-${ip}"}`,
    ].join('\n');
    await ros(block);
    console.log(`  OK ${ip}`);
  }

  const mangle = await rest('GET', '/rest/ip/firewall/mangle');
  const n = (mangle || []).filter((r) => String(r.comment || '').includes('webui-lan')).length;
  console.log(`webui-lan rules: ${n}`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });