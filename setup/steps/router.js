const { connect, exec, nextRootDir } = require('../lib/ssh');
const { buildContainerEnv } = require('../lib/env');
const { step } = require('../lib/logger');

const BRIDGE = 'containers-veth';
const VETH_WEBUI = 'veth-webui';
const CTN_IP = '172.17.0.3';
const GW = '172.17.0.1';

async function ensureBridge(conn) {
  step('40-router-base', 'ensure-bridge...');
  await exec(conn, `/import file=disk1/webuiproxymikrotik/ensure-bridge.rsc`).catch(async () => {
    await exec(conn, `:if ([:len [/interface/bridge/find name=${BRIDGE}]] = 0) do={
  /interface/bridge/add name=${BRIDGE} comment=webuiproxymikrotik-bridge
  /ip/address/add address=${GW}/16 interface=${BRIDGE} comment=webuiproxymikrotik-bridge-ip
}`);
  });
}

async function ensureVethWebui(conn) {
  step('40-router-base', 'ensure veth-webui...');
  await exec(conn, `:if ([:len [/interface/veth/find name=${VETH_WEBUI}]] = 0) do={
  /interface/veth/add name=${VETH_WEBUI} address=${CTN_IP}/16 gateway=${GW}
}`);
  await exec(conn, `:if ([:len [/interface/bridge/port/find where bridge=${BRIDGE} interface=${VETH_WEBUI}]] = 0) do={
  /interface/bridge/port/add bridge=${BRIDGE} interface=${VETH_WEBUI} comment=bp-veth-webui
}`);
}

async function ensureMount(conn) {
  step('40-router-base', 'ensure MOUNT_DATA...');
  await exec(conn, `:do {/container/mounts/remove [find list=MOUNT_DATA]} on-error={}
:do {/container/mounts/add list=MOUNT_DATA src=disk1/data dst=/data} on-error={
  /container/mounts/add list=MOUNT_DATA src=disk1/data dst=/data
}`);
}

async function ensureDstnatWebui(conn, port) {
  step('40-router-base', `ensure dst-nat :${port} → ${CTN_IP}...`);
  await exec(conn, `:if ([:len [/ip/firewall/nat/find where comment=webuiproxymikrotik-webui-dstnat]] = 0) do={
  /ip/firewall/nat/add chain=dstnat dst-port=${port} protocol=tcp action=dst-nat to-addresses=${CTN_IP} to-ports=${port} comment=webuiproxymikrotik-webui-dstnat
}`);
}

async function ensureFirewallWebui(conn, port) {
  step('40-router-base', `ensure firewall accept :${port}...`);
  await exec(conn, `:if ([:len [/ip/firewall/filter/find where comment=webuiproxymikrotik-accept-webui]] = 0) do={
  /ip/firewall/filter/add chain=input connection-state=new dst-port=${port} protocol=tcp action=accept comment=webuiproxymikrotik-accept-webui
  /ip/firewall/filter/add chain=forward connection-state=new dst-port=${port} protocol=tcp action=accept comment=webuiproxymikrotik-accept-webui-forward
}`);
}

async function ensureProxyGateway(conn) {
  step('40-router-base', 'ensure DuckDNS proxy gateway (port → egress IP)...');
  await exec(conn, '/import file=disk1/webuiproxymikrotik/ensure-proxy-gateway.rsc').catch(() => {});
}

async function ensureMgmtAccess(conn) {
  step('40-router-base', 'ensure Winbox/SSH mgmt access on pppoe-wan...');
  await exec(conn, '/import file=disk1/webuiproxymikrotik/ensure-mgmt-access.rsc').catch(async () => {
    await exec(conn, `:if ([:len [/ip/firewall/filter/find where comment="INPUT: Allow port 8291 (Winbox) from WAN"]] = 0) do={
  :local dropId [/ip/firewall/filter/find where comment="INPUT: Drop all other WAN -> router"]
  :if ([:len $dropId] > 0) do={
    /ip/firewall/filter/add chain=input action=accept protocol=tcp in-interface=all-ppp dst-port=8291 comment="INPUT: Allow port 8291 (Winbox) from WAN" place-before=$dropId
  } else={
    /ip/firewall/filter/add chain=input action=accept protocol=tcp in-interface=all-ppp dst-port=8291 comment="INPUT: Allow port 8291 (Winbox) from WAN"
  }
}`);
  });
  await exec(conn, '/import file=disk1/webuiproxymikrotik/ensure-router-scripts.rsc').catch(() => {});
}

async function deployContainer(conn, cfg) {
  const rootDir = await nextRootDir(conn);
  const env = buildContainerEnv(cfg);
  step('50-deploy-webui', `container add root-dir=${rootDir}...`);

  const addOut = await exec(conn, `/container/add file=disk1/webuiproxymikrotik.tar interface=${VETH_WEBUI} root-dir=${rootDir} name=webuiproxymikrotik mountlists=MOUNT_DATA logging=yes start-on-boot=yes env="${env}"`);
  if (addOut.includes('failure:')) throw new Error(`container add failed: ${addOut.trim()}`);

  step('50-deploy-webui', 'Waiting for image extract (up to 100s)...');
  for (let i = 0; i < 20; i++) {
    await sleep(5000);
    const st = await exec(conn, '/container/print where name=webuiproxymikrotik');
    const running = st.includes(' R ') || st.includes('RUNNING') || st.includes(' H ');
    step('50-deploy-webui', `t+${(i + 1) * 5}s: ${running ? 'RUNNING' : 'extracting...'}`);
    if (running) break;
    if (st.includes('FAILED')) throw new Error('Image extract FAILED');
  }

  await exec(conn, '/container/start [find name=webuiproxymikrotik]').catch(() => {});
  step('50-deploy-webui', 'Waiting 25s for backend boot...');
  await sleep(25000);

  const final = await exec(conn, '/container/print detail where name=webuiproxymikrotik');
  if (!final.includes('webuiproxymikrotik')) throw new Error('webuiproxymikrotik container missing after deploy');
  return { rootDir };
}

async function run(cfg) {
  const conn = await connect(cfg);
  try {
    await ensureBridge(conn);
    await ensureVethWebui(conn);
    await ensureMount(conn);
    await ensureDstnatWebui(conn, cfg.webui.port);
    await ensureFirewallWebui(conn, cfg.webui.port);
    await ensureMgmtAccess(conn);
    await ensureProxyGateway(conn);
    const deploy = await deployContainer(conn, cfg);
    return { ok: true, ...deploy };
  } finally {
    conn.end();
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

module.exports = { run };