# ============================================================
# ensure-device-routing.rsc — skip lists + verify routing tables
# Device routes (dev-route-*) do NOT policy-route WebUI/LAN local
# ============================================================

:local skip "dev-route-skip"
:do {/ip/firewall/address-list/add list=$skip address=172.17.0.0/16 comment=dev-webui-bridge} on-error={}
:do {/ip/firewall/address-list/add list=$skip address=192.168.39.0/24 comment=dev-lan} on-error={}
:do {/ip/firewall/address-list/add list=$skip address=192.168.88.0/24 comment=dev-lan} on-error={}
:do {/ip/firewall/address-list/add list=$skip address=172.18.0.0/24 comment=dev-hub} on-error={}

:foreach addr in=[/ip/address/find where interface~"pppoe-out" dynamic=yes] do={
    :local ifName [/ip/address/get $addr interface]
    :local ifNum [:pick $ifName 9 [:len $ifName]]
    :local rmark ("to_pppoe" . $ifNum)
    :if ([:len [/routing/table/find name=$rmark]] = 0) do={
        :put ("WARNING: routing table " . $rmark . " missing")
    }
}

:local bypass "dev-mgmt-bypass"
/ip firewall mangle remove [find comment=$bypass]
/ip firewall mangle add chain=prerouting action=accept protocol=tcp \
    src-address-list=hub-lan dst-port=8088,22222,80,443,8291 comment=$bypass place-before=0

:put "ensure-device-routing: skip lists + mgmt bypass OK"