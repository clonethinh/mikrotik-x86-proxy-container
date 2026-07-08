# ============================================================
# webuiproxymikrotik: ensure-veth-for-pppoe.rsc
# Usage: /import file=disk1/ensure-veth-for-pppoe.rsc
# Idempotent: chạy lại không nhân đôi veth
# IP scale: idx>255 → 172.(18+floor((idx-1)/255)).((idx-1)%255+1).2
# ============================================================

:local bridgeName "containers-veth"
:local baseOct2 18

:foreach addr in=[/ip/address/find where interface~"pppoe-out" dynamic=yes] do={
    :local ifName [/ip/address/get $addr interface]
    :local ifNum [:pick $ifName 9 [:len $ifName]]
    :local vethName ("veth-3p-" . $ifNum)
    :local slot ($ifNum - 1)
    :local oct2 ($baseOct2 + ($slot / 255))
    :local oct3 (($slot % 255) + 1)
    :local gw ("172." . $oct2 . "." . $oct3 . ".1")
    :local ctnIp ("172." . $oct2 . "." . $oct3 . ".2")
    :local cidr ($gw . "/30")

    :if ([:len [/interface/veth/find name=$vethName]] = 0) do={
        /interface/veth/add name=$vethName address=($ctnIp . "/30") gateway=$gw
        :log info "webuiproxymikrotik: created veth $vethName"
        :put ("webuiproxymikrotik: created veth " . $vethName)
    } else={
        :put ("webuiproxymikrotik: veth " . $vethName . " exists, skip")
    }

    :if ([:len [/interface/bridge/port/find where bridge=$bridgeName interface=$vethName]] = 0) do={
        /interface/bridge/port/add bridge=$bridgeName interface=$vethName comment=("bp-" . $vethName)
        :put ("webuiproxymikrotik: added " . $vethName . " to bridge")
    }

    :if ([:len [/ip/address/find where address=$cidr interface=$bridgeName]] = 0) do={
        /ip/address/add address=$cidr interface=$bridgeName comment=("gw-" . $vethName)
        :put ("webuiproxymikrotik: added gateway IP " . $cidr)
    }
}

:put "webuiproxymikrotik: ensure-veth-for-pppoe DONE"