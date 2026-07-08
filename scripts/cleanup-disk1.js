#!/usr/bin/env node
/**
 * Dọn disk1 — chỉ giữ hệ thống proxy hiện tại (hub + webui + data + scripts).
 * Usage: node scripts/cleanup-disk1.js
 *        DRY_RUN=1 node scripts/cleanup-disk1.js
 */
const { loadDeployConfig } = require('./lib/deploy-config');

const cfg = loadDeployConfig();
const DRY = process.env.DRY_RUN === '1';

function log(s, m) { console.log(`[${s}] ${m}`); }

async function rest(method, apiPath, body) {
  const res = await fetch(`${cfg.rest}${apiPath}`, {
    method,
    headers: { Authorization: `Basic ${cfg.auth}`, 'Content-Type': 'application/json' },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`REST ${apiPath} HTTP ${res.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

async function ros(script) {
  try {
    await rest('POST', '/rest/execute', { script });
  } catch (e) {
    if (!String(e.message).includes('Session closed')) throw e;
  }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/** File/dir bắt buộc cho hệ thống proxy hub hiện tại. */
function isEssential(name, ctx) {
  const n = String(name);
  if (!n.startsWith('disk1/')) return true;

  // WebUI image + root đang chạy
  if (n === 'disk1/webuiproxymikrotik.tar') return true;
  if (ctx.activeWebuiRoot && (n === ctx.activeWebuiRoot || n.startsWith(`${ctx.activeWebuiRoot}/`))) return true;

  // Router scripts (scheduler / firewall / proxy bootstrap)
  if (n === 'disk1/webuiproxymikrotik' || n.startsWith('disk1/webuiproxymikrotik/')) return true;

  // DB WebUI (proxy fleet state)
  if (n === 'disk1/data') return true;
  if (n.startsWith('disk1/data/')) {
    const base = n.split('/').pop() || '';
    return /^proxy\.db(-shm|-wal)?$/.test(base);
  }

  // Hub containers đang có trên router
  if (n === 'disk1/3proxy-hub.tar') return true;
  for (const root of ctx.activeHubRoots) {
    if (n === root || n.startsWith(`${root}/`)) return true;
  }

  // Hub config theo shard đang dùng
  for (const sid of ctx.activeShardIds) {
    const cfgFile = sid === 0 ? 'disk1/hub-3proxy.cfg' : `disk1/hub-3proxy-${sid + 1}.cfg`;
    const ipsFile = sid === 0 ? 'disk1/hub-slot-ips' : `disk1/hub-slot-ips-${sid + 1}`;
    if (n === cfgFile || n === ipsFile) return true;
  }

  return false;
}

async function getActiveHubShards() {
  const containers = await rest('GET', '/rest/container');
  const hubs = (containers || []).filter((c) => /^proxy3p-hub/.test(String(c.name || '')));
  const shardIds = [];
  const roots = [];
  for (const h of hubs) {
    const name = String(h.name || '');
    let sid = 0;
    const m = name.match(/^proxy3p-hub-(\d+)$/);
    if (m) sid = parseInt(m[1], 10) - 1;
    shardIds.push(sid);
    const root = String(h['root-dir'] || '').replace(/^\//, '');
    if (root) roots.push(root);
  }
  return { shardIds: [...new Set(shardIds)].sort(), roots, hubNames: hubs.map((h) => h.name) };
}

async function regenerateHubConfigs() {
  log('hub', 'Restart WebUI để sync lại hub-3proxy-*.cfg...');
  const webui = (await rest('GET', '/rest/container?name=webuiproxymikrotik'))?.[0];
  const id = webui?.['.id'];
  if (!id) return;
  await rest('POST', '/rest/container/stop', { '.id': id }).catch(() => {});
  await sleep(8000);
  await rest('POST', '/rest/container/start', { '.id': id }).catch(() => {});
  await sleep(25_000);
}

async function removeOrphanHubMounts(activeShardIds) {
  const mounts = await rest('GET', '/rest/container/mounts') || [];
  const keepLists = new Set(activeShardIds.map((sid) => (sid === 0 ? 'MOUNT_HUB_CFG' : `MOUNT_HUB_CFG_${sid + 1}`)));
  keepLists.add('MOUNT_DATA');

  for (const m of mounts) {
    const list = String(m.list || '');
    if (!list.startsWith('MOUNT_HUB_CFG')) continue;
    if (keepLists.has(list)) continue;
    log('mount', `Remove orphan ${list} (${m.src})`);
    if (!DRY && m['.id']) {
      await ros(`:do {/container/mounts/remove ${m['.id']}} on-error={}`);
    }
  }
}

async function main() {
  const webui = (await rest('GET', '/rest/container?name=webuiproxymikrotik'))?.[0];
  const activeWebuiRoot = String(webui?.['root-dir'] || '').replace(/^\//, '') || null;
  const hub = await getActiveHubShards();
  log('info', `WebUI root: ${activeWebuiRoot}`);
  log('info', `Hub shards: ${hub.shardIds.join(', ')} containers: ${hub.hubNames.join(', ')}`);

  if (!DRY) await regenerateHubConfigs();

  const ctx = { activeWebuiRoot, activeHubRoots: hub.roots, activeShardIds: hub.shardIds };
  const files = await rest('GET', '/rest/file');
  const toRemove = [];

  for (const f of files) {
    const name = String(f.name || '');
    if (!name.startsWith('disk1/')) continue;
    if (isEssential(name, ctx)) continue;
    toRemove.push(name);
  }

  toRemove.sort();
  log('plan', `Xóa ${toRemove.length} mục không thuộc hệ thống proxy hiện tại`);
  for (const n of toRemove) console.log(`  - ${n}`);

  if (DRY) {
    await removeOrphanHubMounts(hub.shardIds);
    log('dry-run', 'Không xóa file (DRY_RUN=1)');
    return;
  }

  for (const name of toRemove) {
    await ros(`:do {/file/remove [find name="${name}"]} on-error={}; :do {/disk/remove [find name="${name}"]} on-error={}`);
    log('removed', name);
  }

  await removeOrphanHubMounts(hub.shardIds);

  const after = await rest('GET', '/rest/file');
  const left = (after || []).filter((x) => String(x.name || '').startsWith('disk1/'));
  const free = (await rest('GET', '/rest/system/resource'))?.['free-hdd-space'];
  log('done', `Còn ${left.length} mục trên disk1 · free ${free ? (parseInt(free, 10) / 1024 ** 3).toFixed(2) + ' GiB' : '?'}`);

  const health = await fetch(`${cfg.webui}/api/health`).then((r) => r.json()).catch(() => null);
  log('verify', health?.ok ? `WebUI OK uptime=${Math.round(health.uptime)}s` : 'WebUI health check failed');
}

main().catch((e) => { console.error('CLEANUP FAILED:', e.message); process.exit(1); });