# ============================================================
# ensure-proxy-gateway.rsc
# pppoe-wan: CHỈ quản trị (WebUI/SSH/Winbox) — KHÔNG proxy
# Proxy inbound: chỉ pppoe-out1..X (per-proxy rules từ WebUI)
# ============================================================

:local mgmtIf "pppoe-wan"
:local mgmtPorts "8088,22222,80,443,8291"
:local changes 0

# Xóa rule cũ mở proxy trên pppoe-wan
:foreach id in=[/ip/firewall/raw/find where in-interface=$mgmtIf comment~"proxy gateway"] do={
    /ip/firewall/raw/remove $id
    :set changes ($changes + 1)
}
:foreach id in=[/ip/firewall/filter/find where comment~"proxy gateway"] do={
    /ip/firewall/filter/remove $id
    :set changes ($changes + 1)
}

# RAW mgmt — không gồm cổng proxy (30056+, 31056+)
:local rawId [/ip/firewall/raw/find where comment="RAW: allow mgmt on pppoe-wan before bogon"]
:if ([:len $rawId] > 0) do={
    /ip/firewall/raw/set $rawId chain=prerouting action=accept in-interface=$mgmtIf \
        protocol=tcp dst-port=$mgmtPorts
    :set changes ($changes + 1)
} else={
    /ip/firewall/raw/add chain=prerouting action=accept in-interface=$mgmtIf \
        protocol=tcp dst-port=$mgmtPorts comment="RAW: allow mgmt on pppoe-wan before bogon"
    :set changes ($changes + 1)
}

:put ("proxy-gateway: DONE mgmt-only on pppoe-wan (changes=" . $changes . ")")