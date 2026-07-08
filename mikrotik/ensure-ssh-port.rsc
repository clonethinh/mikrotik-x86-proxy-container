# ============================================================
# ensure-ssh-port.rsc — SSH port 22222 (giảm bot scan port 22)
# Cập nhật: service, RAW mgmt, filter accept WAN
# ============================================================

:local sshPort 22222
:local oldComment "INPUT: Allow port 22 (SSH) from WAN"
:local newComment "INPUT: Allow port 22222 (SSH) from WAN"
:local mgmtPorts "8088,22222,80,443,8291"

/ip service set ssh disabled=no port=$sshPort

:local rawId [/ip/firewall/raw/find where comment="RAW: allow mgmt on pppoe-wan before bogon"]
:if ([:len $rawId] > 0) do={
    /ip/firewall/raw/set $rawId protocol=tcp dst-port=$mgmtPorts
}

:do {/ip/firewall/filter/remove [find comment=$oldComment]} on-error={}
:do {/ip/firewall/filter/remove [find comment=$newComment]} on-error={}

:local dropId [/ip/firewall/filter/find where comment="INPUT: Drop all other WAN -> router"]
:if ([:len $dropId] > 0) do={
    /ip/firewall/filter/add chain=input action=accept protocol=tcp in-interface=all-ppp \
        dst-port=$sshPort comment=$newComment place-before=$dropId
} else={
    /ip/firewall/filter/add chain=input action=accept protocol=tcp in-interface=all-ppp \
        dst-port=$sshPort comment=$newComment
}

:do {/ip/firewall/filter/move [find comment=hub-rate-limit-scan-drop] destination=[find comment=$newComment]} on-error={}

:put ("ensure-ssh-port: SSH port=" . $sshPort . " mgmt=" . $mgmtPorts)