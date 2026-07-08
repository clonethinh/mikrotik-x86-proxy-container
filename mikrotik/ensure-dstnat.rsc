# ============================================================
# webuiproxymikrotik: ensure-dstnat.rsc
# Idempotent: tạo dst-nat HTTP + SOCKS cho MỖI pppoe-outX
# External port = 30055 + N (HTTP), 31055 + N (SOCKS)
# IP scale: idx>255 → 172.(18+floor((idx-1)/255)).((idx-1)%255+1).2
# ============================================================

:local extHttpBase 30055
:local extSocksBase 31055
:local baseOct2 18

:local doInterface do={
    :local ifName $ifName
    :local idx $idx
    :local slot ($idx - 1)
    :local oct2 ($baseOct2 + ($slot / 255))
    :local oct3 (($slot % 255) + 1)
    :local ctnIp ("172." . $oct2 . "." . $oct3 . ".2")
    :local httpExt ($extHttpBase + $idx)
    :local httpInt (20000 + $idx)
    :local socksExt ($extSocksBase + $idx)
    :local socksInt (21000 + $idx)

    :if ([:len [/ip/firewall/nat/find where comment=("ctn-" . $ifName . "-HTTP")]] = 0) do={
        /ip/firewall/nat/add chain=dstnat in-interface=$ifName dst-port=$httpExt protocol=tcp \
            action=dst-nat to-addresses=$ctnIp to-ports=$httpInt \
            comment=("ctn-" . $ifName . "-HTTP")
        :put ("webuiproxymikrotik: dstnat HTTP ext:" . $httpExt . " -> " . $ctnIp . ":" . $httpInt)
    } else={
        /ip/firewall/nat/set [find comment=("ctn-" . $ifName . "-HTTP")] in-interface=$ifName
    }

    :if ([:len [/ip/firewall/nat/find where comment=("ctn-" . $ifName . "-SOCKS")]] = 0) do={
        /ip/firewall/nat/add chain=dstnat in-interface=$ifName dst-port=$socksExt protocol=tcp \
            action=dst-nat to-addresses=$ctnIp to-ports=$socksInt \
            comment=("ctn-" . $ifName . "-SOCKS")
        :put ("webuiproxymikrotik: dstnat SOCKS ext:" . $socksExt . " -> " . $ctnIp . ":" . $socksInt)
    } else={
        /ip/firewall/nat/set [find comment=("ctn-" . $ifName . "-SOCKS")] in-interface=$ifName
    }
}

:foreach addr in=[/ip/address/find where interface~"pppoe-out" dynamic=yes] do={
    :local ifName [/ip/address/get $addr interface]
    :local ifNum [:pick $ifName 9 [:len $ifName]]
    :do doInterface ifName=$ifName idx=($ifNum + 0)
}

:put "webuiproxymikrotik: ensure-dstnat DONE"