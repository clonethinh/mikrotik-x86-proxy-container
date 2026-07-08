# ============================================================
# webuiproxymikrotik: reload-ip-pppoe.rsc
# Usage: /import file=disk1/reload-ip-pppoe.rsc pppoe_out=pppoe-out3
# Reload IP cho 1 PPPoE cụ thể (KHÔNG dùng cho pppoe-wan - luồng chính)
# Returns: PPPoE IP mới hoặc "TIMEOUT"
# ============================================================

:local ifName $pppoe_out

# Safety: KHÔNG reload pppoe-wan
:if ($ifName = "pppoe-wan") do={
    :put "ERROR: pppoe-wan is main WAN, refused"
    :error "pppoe-wan is main WAN"
}

:put ("Reloading " . $ifName . "...")
/interface/pppoe-client/disable $ifName
:delay 3s
/interface/pppoe-client/enable $ifName

# Poll IP với timeout 30s
:local maxWait 30
:local waited 0
:local newIp ""

:while ($waited < $maxWait) do={
    :delay 2s
    :set waited ($waited + 2)
    :local found [/ip/address/find where interface=$ifName dynamic=yes]
    :if ([:len $found] > 0) do={
        :set newIp [/ip/address/get $found address]
        :local slashPos [:find $newIp "/"]
        :set newIp [:pick $newIp 0 $slashPos]
        :put ("New IP: " . $newIp)
        :put ("RESULT:" . $newIp)
        :return $newIp
    }
}

:put "TIMEOUT after 30s"
:put "RESULT:TIMEOUT"
:return "TIMEOUT"