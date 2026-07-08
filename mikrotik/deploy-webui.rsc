# ============================================================
# webuiproxymikrotik: deploy-webui.rsc
# Idempotent: tạo veth-webui + mount + container với inline env
# Usage: /import file=disk1/webuiproxymikrotik/deploy-webui.rsc
# ============================================================

:put "==========================================="
:put "webuiproxymikrotik: deploy-webui starting"
:put "==========================================="

# 1. Veth webui (172.17.0.3) + bridge port
:local vethName "veth-webui"
:local ctnIp "172.17.0.3"
:local gw "172.17.0.1"
:local bridgeName "containers-veth"

:if ([:len [/interface/veth/find name=$vethName]] = 0) do={
    /interface/veth/add name=$vethName address=($ctnIp . "/16") gateway=$gw
    :put "Created veth-webui"
} else={
    :put "veth-webui exists"
}
:if ([:len [/interface/bridge/port/find where bridge=$bridgeName interface=$vethName]] = 0) do={
    /interface/bridge/port/add bridge=$bridgeName interface=$vethName comment="bp-veth-webui"
    :put "Added veth-webui to bridge"
}

# 2. Mount list for /data (SQLite persistent)
:if ([:len [/container/mounts/find list=MOUNT_DATA]] = 0) do={
    /container/mounts/add list=MOUNT_DATA src=disk1/data dst=/data
    :put "Created mount MOUNT_DATA"
} else={
    :put "MOUNT_DATA exists"
}

# 3. Container add (idempotent by name check) - env inline via comma-separated
:local ctnName "webuiproxymikrotik"
:local rootDir "disk1/webuiproxymikrotik-root"

:if ([:len [/container/find name=$ctnName]] = 0) do={
    :put "Adding container $ctnName (extract ~30-60s)..."
    /container/add file=disk1/webuiproxymikrotik.tar \
        interface=$vethName \
        root-dir=$rootDir \
        name=$ctnName \
        mountlists=MOUNT_DATA \
        logging=yes \
        start-on-boot=yes \
        env="NODE_ENV=production,PORT=8088,MIKROTIK_HOST=127.0.0.1,MIKROTIK_API_USER=admin,MIKROTIK_API_PASS=toanthinh,MIKROTIK_REST_PORT=80,MIKROTIK_REST_SCHEME=http,MIKROTIK_SSH_PORT=22,MIKROTIK_SSH_USER=admin,MIKROTIK_SSH_PASS=toanthinh,MIKROTIK_WAN_IP=113.22.235.52,JWT_SECRET=webuiproxymikrotik-change-in-prod-32chars-x,ADMIN_USERNAME=admin,ADMIN_PASSWORD=admin123,DATABASE_URL=file:/data/proxy.db,THREEPROXY_IMAGE=ghcr.io/tarampampam/3proxy:2,THREEPROXY_TARBALL=disk1/3proxy.tar,HEALTH_CHECK_INTERVAL_MS=60000,HEALTH_CHECK_TIMEOUT_MS=10000,ENABLE_REALTIME=true,LOG_LEVEL=info"
    :put "Container added. Wait 30s for extract..."
    :delay 30s
} else={
    :put "Container $ctnName exists"
}

# 4. Start
:local ctnInfo [/container/print as-value where name=$ctnName]
:local ctnStatus ($ctnInfo->"status")
:put ("Current container status: " . $ctnStatus)
:if ($ctnStatus != "running") do={
    /container/start $ctnName
    :put "Started container $ctnName"
    :delay 5s
} else={
    :put "Container $ctnName already running"
}

# 5. Dst-nat: WAN port 8088 → container 172.17.0.3:8088
:if ([:len [/ip/firewall/nat/find where comment="webuiproxymikrotik-webui-dstnat"]] = 0) do={
    /ip/firewall/nat/add chain=dstnat dst-port=8088 protocol=tcp \
        action=dst-nat to-addresses=172.17.0.3 to-ports=8088 \
        comment="webuiproxymikrotik-webui-dstnat"
    :put "Added dst-nat 8088 → 172.17.0.3:8088"
}

# 6. Filter accept port 8088 (input + forward)
:if ([:len [/ip/firewall/filter/find where comment="webuiproxymikrotik-accept-webui"]] = 0) do={
    /ip/firewall/filter/add chain=input connection-state=new \
        dst-port=8088 protocol=tcp action=accept \
        comment="webuiproxymikrotik-accept-webui"
    /ip/firewall/filter/add chain=forward connection-state=new \
        dst-port=8088 protocol=tcp action=accept \
        comment="webuiproxymikrotik-accept-webui-forward"
    :put "Added filter accept port 8088"
}

:put ""
:put "==========================================="
:put "webuiproxymikrotik: deploy-webui DONE"
:put "WebUI accessible at: http://<mikrotik_wan_ip>:8088"
:put "Login: admin / admin123 (CHANGE THIS!)"
:put "==========================================="