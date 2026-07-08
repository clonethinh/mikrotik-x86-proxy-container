# ============================================================
# webuiproxymikrotik: ensure-routing.rsc
# Usage: /import file=disk1/ensure-routing.rsc
# Idempotent: tạo routing table + mangle + src-nat per PPPoE
# IP scale: idx>255 → 172.(18+floor((idx-1)/255)).((idx-1)%255+1).2
# ============================================================

:local baseOct2 18

:foreach addr in=[/ip/address/find where interface~"pppoe-out" dynamic=yes] do={
    :local ifName [/ip/address/get $addr interface]
    :local ifNum [:pick $ifName 9 [:len $ifName]]
    :local slot ($ifNum - 1)
    :local oct2 ($baseOct2 + ($slot / 255))
    :local oct3 (($slot % 255) + 1)
    :local ctnIp ("172." . $oct2 . "." . $oct3 . ".2")
    :local rmark ("to_pppoe" . $ifNum)

    :if ([:len [/routing/table/find name=$rmark]] = 0) do={
        /routing/table/add name=$rmark fib
        :put ("webuiproxymikrotik: routing table " . $rmark . " created")
    }

    :if ([:len [/ip/route/find where dst-address=0.0.0.0/0 routing-table=$rmark gateway=$ifName]] = 0) do={
        /ip/route/add dst-address=0.0.0.0/0 gateway=$ifName routing-table=$rmark \
            comment=("multi-ip-" . $ifName)
        :put ("webuiproxymikrotik: default route in " . $rmark . " via " . $ifName)
    }

    :if ([:len [/ip/firewall/mangle/find where comment=("ctn-mangle-" . $ifName)]] = 0) do={
        /ip/firewall/mangle/add chain=prerouting src-address=$ctnIp \
            action=mark-routing new-routing-mark=$rmark passthrough=yes \
            comment=("ctn-mangle-" . $ifName)
        :put ("webuiproxymikrotik: mangle mark " . $ctnIp . " -> " . $rmark)
    }

    :local pppoeIp [/ip/address/get $addr address]
    :local pppoeIpOnly [:pick $pppoeIp 0 [:find $pppoeIp "/"]]
    :if ([:len [/ip/firewall/nat/find where comment=("ctn-" . $ifName)]] = 0) do={
        /ip/firewall/nat/add chain=srcnat src-address=($ctnIp . "/32") \
            out-interface=$ifName action=src-nat to-addresses=$pppoeIpOnly \
            comment=("ctn-" . $ifName)
        :put ("webuiproxymikrotik: srcnat for " . $ctnIp . " via " . $ifName . " -> " . $pppoeIpOnly)
    } else={
        :local natId [/ip/firewall/nat/find where comment=("ctn-" . $ifName)]
        :local currentIp [/ip/firewall/nat/get $natId to-addresses]
        :if ($currentIp != $pppoeIpOnly) do={
            /ip/firewall/nat/set $natId to-addresses=$pppoeIpOnly
            :put ("webuiproxymikrotik: srcnat updated " . $ifName . " -> " . $pppoeIpOnly)
        }
    }
}

:put "webuiproxymikrotik: ensure-routing DONE"