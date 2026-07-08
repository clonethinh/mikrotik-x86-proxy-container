#!/usr/bin/env node
/**
 * Dọn firewall thừa: WebUI duplicate, rule test, hub-wan IP cũ.
 * Chạy qua MikroTik REST :80 — không cần SSH WAN.
 */
const { loadDeployConfig } = require('./lib/deploy-config');

const cfg = loadDeployConfig();
const WEBUI = cfg.webui;

async function rest(method, path, body) {
  const res = await fetch(`${cfg.rest}${path}`, {
    method,
    headers: {
      Authorization: `Basic ${cfg.auth}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok && res.status !== 404) {
    throw new Error(`REST ${method} ${path} HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

async function restDelete(path) {
  return rest('DELETE', path);
}

async function loginWebui() {
  const res = await fetch(`${WEBUI}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: cfg.adminPass }),
  });
  const j = await res.json();
  if (!j.token) throw new Error('WebUI login failed');
  return j.token;
}

async function getCurrentWanIps() {
  const token = await loginWebui();
  const wan = await fetch(`${WEBUI}/api/wan`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then(r => r.json());
  const map = new Map();
  for (const w of wan) {
    if (w.name && w.publicIp) map.set(w.name, w.publicIp);
  }
  return map;
}

function keepFirstDeleteRest(rules, commentExact) {
  const matched = rules.filter(r => (r.comment || '') === commentExact);
  if (matched.length <= 1) return { keep: matched[0]?.['.id'], remove: [] };
  const [keep, ...rest] = matched;
  return { keep: keep['.id'], remove: rest.map(r => r['.id']) };
}

async function main() {
  const [filter, nat, mangle, addrList, currentWan] = await Promise.all([
    rest('GET', '/rest/ip/firewall/filter'),
    rest('GET', '/rest/ip/firewall/nat'),
    rest('GET', '/rest/ip/firewall/mangle'),
    rest('GET', '/rest/ip/firewall/address-list'),
    getCurrentWanIps(),
  ]);

  const removed = { nat: 0, filter: 0, mangle: 0, addressList: 0 };
  const errors = [];

  // 1) WebUI duplicates
  for (const comment of [
    'webuiproxymikrotik-webui-dstnat',
    'webuiproxymikrotik-accept-webui',
    'webuiproxymikrotik-accept-webui-forward',
  ]) {
    const rules = comment.includes('dstnat') ? nat : filter;
    const { keep, remove } = keepFirstDeleteRest(rules, comment);
    console.log(`[webui] ${comment}: keep ${keep}, remove ${remove.length}`);
    for (const id of remove) {
      try {
        await restDelete(`/rest/ip/firewall/${comment.includes('dstnat') ? 'nat' : 'filter'}/${encodeURIComponent(id)}`);
        removed[comment.includes('dstnat') ? 'nat' : 'filter']++;
      } catch (e) {
        errors.push(`${comment} ${id}: ${e.message}`);
      }
    }
  }

  // 2) Disabled test NAT
  for (const r of nat) {
    if (r.disabled === 'true' || (r.comment || '') === 'hub-netmap-s1-http-test') {
      console.log(`[test] remove disabled NAT ${r['.id']} ${r.comment}`);
      try {
        await restDelete(`/rest/ip/firewall/nat/${encodeURIComponent(r['.id'])}`);
        removed.nat++;
      } catch (e) { errors.push(`nat ${r['.id']}: ${e.message}`); }
    }
  }

  // 3) Test mangle
  const ftDummy = mangle.filter(r => (r.comment || '').includes('special dummy rule to show fasttrack'));
  if (ftDummy.length > 1) {
    const [, ...extra] = ftDummy;
    console.log(`[fasttrack] keep ${ftDummy[0]['.id']}, try remove ${extra.length} dummy mangle`);
    for (const r of extra) {
      try {
        await restDelete(`/rest/ip/firewall/mangle/${encodeURIComponent(r['.id'])}`);
        removed.mangle++;
      } catch (e) {
        if (!String(e.message).includes('builtin')) errors.push(`mangle ft ${r['.id']}: ${e.message}`);
        else console.log(`  skip builtin ${r['.id']}`);
      }
    }
  }

  for (const r of mangle) {
    if ((r.comment || '') === 'hub-mangle-lan-e2-test') {
      console.log(`[test] remove mangle ${r['.id']} ${r.comment}`);
      try {
        await restDelete(`/rest/ip/firewall/mangle/${encodeURIComponent(r['.id'])}`);
        removed.mangle++;
      } catch (e) { errors.push(`mangle test ${r['.id']}: ${e.message}`); }
    }
  }

  // 4) Stale hub-wan IPs
  const hubWan = addrList.filter(a => a.list === 'hub-wan');
  const byPppoe = new Map();
  for (const a of hubWan) {
    const name = a.comment || '';
    if (!byPppoe.has(name)) byPppoe.set(name, []);
    byPppoe.get(name).push(a);
  }

  const needWanAdd = [];
  for (const [pppoe, entries] of byPppoe) {
    const currentIp = currentWan.get(pppoe);
    if (!currentIp) continue;
    const hasCurrent = entries.some(e => e.address === currentIp);
    for (const e of entries) {
      if (e.address === currentIp) continue;
      console.log(`[hub-wan] remove stale ${pppoe} ${e.address} (current ${currentIp})`);
      try {
        await restDelete(`/rest/ip/firewall/address-list/${encodeURIComponent(e['.id'])}`);
        removed.addressList++;
      } catch (err) { errors.push(`hub-wan ${e['.id']}: ${err.message}`); }
    }
    if (!hasCurrent) needWanAdd.push({ pppoe, currentIp });
  }

  for (const [pppoe, currentIp] of currentWan) {
    if (!byPppoe.has(pppoe)) needWanAdd.push({ pppoe, currentIp });
  }

  for (const { pppoe, currentIp } of needWanAdd) {
    console.log(`[hub-wan] add current ${pppoe} ${currentIp}`);
    try {
      await rest('POST', '/rest/ip/firewall/address-list/add', {
        list: 'hub-wan', address: currentIp, comment: pppoe,
      });
    } catch (err) { errors.push(`hub-wan add ${pppoe}: ${err.message}`); }
  }

  // Verify
  const [nat2, filter2, mangle2, addr2] = await Promise.all([
    rest('GET', '/rest/ip/firewall/nat'),
    rest('GET', '/rest/ip/firewall/filter'),
    rest('GET', '/rest/ip/firewall/mangle'),
    rest('GET', '/rest/ip/firewall/address-list?list=hub-wan'),
  ]);

  const webuiNat = nat2.filter(r => r.comment === 'webuiproxymikrotik-webui-dstnat').length;
  const webuiIn = filter2.filter(r => r.comment === 'webuiproxymikrotik-accept-webui').length;
  const hubWanCount = Array.isArray(addr2) ? addr2.length : 0;

  console.log('\n=== CLEANUP DONE ===');
  console.log('Removed:', removed);
  console.log('After: webui NAT', webuiNat, 'webui input filter', webuiIn, 'hub-wan entries', hubWanCount);
  if (errors.length) {
    console.log('Errors:', errors.length);
    errors.forEach(e => console.log(' ', e));
    process.exit(1);
  }
}

main().catch(e => { console.error('FAIL:', e.message); process.exit(1); });