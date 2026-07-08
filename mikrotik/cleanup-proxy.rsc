# ============================================================
# webuiproxymikrotik: cleanup-proxy.rsc
# Usage: /import file=disk1/cleanup-proxy.rsc idx=3
# Cleanup toàn bộ resource của 1 proxy (veth, NAT, mangle, route, container, mount)
# Safety: KHÔNG xóa pppoe-wan (luồng chính)
# Idempotent: xóa cái gì không có -> skip
# ============================================================

:local idx $idx
:local ifName ("pppoe-out" . $idx)
:local vethName ("veth-3p-" . $idx)
:local ctnName ("proxy3p-" . $idx)
:local mountName ("MOUNT_PROXY_" . $idx)
:local rmark ("to_pppoe" . $idx)

# 1. Stop + remove container (retry 5 lần, dùng force-remove nếu stuck)
:put ("Cleaning up container " . $ctnName)
:local retry 0
:while ($retry < 5) do={
    :if ([:len [/container/find name=$ctnName]] = 0) do={
        :put ("Container " . $ctnName . " already gone")
        :set retry 99
    } else={
        # Stop (no-op nếu đã stopped)
        :do {/container/stop [find name=$ctnName]} on-error={}
        :delay 3s
        # Remove bình thường
        :do {
            /container/remove [find name=$ctnName]
            :put ("Container " . $ctnName . " removed (attempt " . ($retry + 1) . ")")
            :set retry 99
        } on-error={
            :put ("Container " . $ctnName . " remove failed, attempt " . ($retry + 1) . " — will retry")
            :delay 3s
        }
        :set retry ($retry + 1)
    }
}

# Nếu container vẫn còn sau 5 retry → kill bằng cách disable env vars + remove
:if ([:len [/container/find name=$ctnName]] > 0) do={
    :put ("Container " . $ctnName . " STUCK — trying force remove")
    # Unmount tất cả mount list
    :do {
        :foreach mId in=[/container/mounts/find] do={
            :local mList [/container/mounts/get $mId list]
            :if (($mList = $mountName) || ($mList = "MOUNT_DATA")) do={
                /container/mounts/remove $mId
            }
        }
    } on-error={}
    :delay 2s
    # Thử remove lần cuối
    :do {/container/remove [find name=$ctnName]} on-error={
        :put ("Container " . $ctnName . " FORCE REMOVE FAILED — cần reboot router hoặc check log")
    }
    :delay 2s
}

# 2. Remove NAT dst-nat + src-nat (ctn-pppoe-outX* và ctn-ifName)
:foreach natId in=[/ip/firewall/nat/find where comment~("ctn-pppoe-out" . $idx)] do={
    /ip/firewall/nat/remove $natId
}
:foreach natId in=[/ip/firewall/nat/find where comment=("ctn-" . $ifName)] do={
    /ip/firewall/nat/remove $natId
}

# 3. Remove mangle
:foreach mId in=[/ip/firewall/mangle/find where comment=("ctn-mangle-" . $ifName)] do={
    /ip/firewall/mangle/remove $mId
}

# 4. Remove filter accept (nếu riêng cho idx này)
:foreach fId in=[/ip/firewall/filter/find where comment~("accept-p" . $idx)] do={
    /ip/firewall/filter/remove $fId
}

# 5. Remove routes
:foreach rId in=[/ip/route/find where routing-table=$rmark] do={
    /ip/route/remove $rId
}

# 6. Remove routing table
:foreach tId in=[/routing/table/find name=$rmark] do={
    /routing/table/remove $tId
}

# 7. Remove IP gateway
:foreach ipId in=[/ip/address/find where comment=("gw-" . $vethName)] do={
    /ip/address/remove $ipId
}

# 8. Remove bridge port + veth
:foreach bpId in=[/interface/bridge/port/find where interface=$vethName] do={
    /interface/bridge/port/remove $bpId
}
:foreach vId in=[/interface/veth/find name=$vethName] do={
    /interface/veth/remove $vId
}

# 9. Remove mount
:foreach mId in=[/container/mounts/find list=$mountName] do={
    /container/mounts/remove $mId
}

# 10. Remove env list
:foreach eId in=[/container/envlist/find name=("ENV_3PROXY_" . $idx)] do={
    /container/envlist/remove $eId
}

# 11. Remove users-N.json file + root-dir
:do {/file/remove [find name=("disk1/users-" . $idx . ".json")]} on-error={}
:do {/disk/remove [find name=("disk1/3proxy-p" . $idx)]} on-error={}
:do {/disk/remove [find name=("disk1/3proxy-p" . $idx . "-b")]} on-error={}
:do {/disk/remove [find name=("disk1/3proxy-p" . $idx . "-c")]} on-error={}
:do {/disk/remove [find name=("disk1/3proxy-p" . $idx . "g")]} on-error={}

:put ("webuiproxymikrotik: cleanup " . $idx . " DONE")