# ============================================================
# webuiproxymikrotik: ensure-bridge.rsc
# Idempotent: tạo bridge containers-veth nếu chưa có
# Chạy 1 lần trước khi tạo veth/container
# ============================================================

:local bridgeName "containers-veth"

:if ([:len [/interface/bridge/find name=$bridgeName]] = 0) do={
    /interface/bridge/add name=$bridgeName comment="webuiproxymikrotik-bridge"
    /ip/address/add address=172.17.0.1/16 interface=$bridgeName comment="webuiproxymikrotik-bridge-ip"
    :put "webuiproxymikrotik: bridge created"
} else={
    :put "webuiproxymikrotik: bridge already exists"
}

# DNS cho container (để container resolve được internet)
:if ([:len [/ip/dns/static/find name=webuiproxymikrotik-dns]] = 0) do={
    /ip/dns/static/add name=webuiproxymikrotik-dns type=A address=1.1.1.1
}

:put "webuiproxymikrotik: ensure-bridge DONE"