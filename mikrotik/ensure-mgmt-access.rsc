# ============================================================
# ensure-mgmt-access.rsc
# Cho phép Winbox (8291) + SSH/WebFig từ WAN qua pppoe-wan
# Cần cả RAW (prerouting) lẫn filter (input) — RAW chặn trước bogon rules
# ============================================================

:local mgmtPorts "8088,22222,80,443,8291"
:local changes 0

:if ([:len [/ip/service/find name=winbox disabled=yes]] > 0) do={
    /ip/service/set winbox disabled=no port=8291
    :set changes ($changes + 1)
}

# RAW: bypass bogon/port-scan drops cho mgmt ports trên pppoe-wan
:local rawId [/ip/firewall/raw/find where comment="RAW: allow mgmt on pppoe-wan before bogon"]
:if ([:len $rawId] > 0) do={
    /ip/firewall/raw/set $rawId chain=prerouting action=accept in-interface=pppoe-wan \
        protocol=tcp dst-port=$mgmtPorts
    :set changes ($changes + 1)
    :put ("mgmt: updated RAW allow " . $mgmtPorts)
} else={
    /ip/firewall/raw/add chain=prerouting action=accept in-interface=pppoe-wan \
        protocol=tcp dst-port=$mgmtPorts comment="RAW: allow mgmt on pppoe-wan before bogon"
    :set changes ($changes + 1)
    :put ("mgmt: created RAW allow " . $mgmtPorts)
}

# FILTER input: Winbox trên all-ppp (trước rule drop WAN)
:if ([:len [/ip/firewall/filter/find where comment="INPUT: Allow port 8291 (Winbox) from WAN"]] = 0) do={
    :local dropId [/ip/firewall/filter/find where comment="INPUT: Drop all other WAN -> router"]
    :if ([:len $dropId] > 0) do={
        /ip/firewall/filter/add chain=input action=accept protocol=tcp in-interface=all-ppp \
            dst-port=8291 comment="INPUT: Allow port 8291 (Winbox) from WAN" place-before=$dropId
    } else={
        /ip/firewall/filter/add chain=input action=accept protocol=tcp in-interface=all-ppp \
            dst-port=8291 comment="INPUT: Allow port 8291 (Winbox) from WAN"
    }
    :set changes ($changes + 1)
    :put "mgmt: added filter accept winbox/8291"
}

:put ("mgmt-access: DONE (changes=" . $changes . ")")