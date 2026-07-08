# ============================================================
# cleanup-firewall-orphan.rsc
# Dọn rule firewall thừa/mồ côi — phù hợp IP động (PPPoE)
# Giữ: webui dstnat theo PORT, raw mgmt pppoe-wan, proxy ctn-* (nếu có)
# Usage: /import file=disk1/webuiproxymikrotik/cleanup-firewall-orphan.rsc
# ============================================================

:local removed 0

# NAT: rule gắn IP tĩnh → mồ côi khi PPPoE đổi IP
:foreach c in={"webui-dstnat-pppoe-wan-v2";"webui-dstnat-pppoe-out1";"snat-reply-pppoe-wan";"webui-dstnat-pppoe-wan"} do={
    :foreach id in=[/ip/firewall/nat/find where comment=$c] do={
        /ip/firewall/nat/remove $id
        :set removed ($removed + 1)
    }
}

# FILTER: rule webui/pppoe-wan trùng (dstnat forward đã xử lý)
:foreach c in={"WAN-pppoe-wan-allow-webui";"WAN-pppoe-wan-fwd-webui";"WAN-pppoe-wan-allow-proxy-http";"WAN-pppoe-wan-allow-proxy-socks";"WAN-pppoe-wan-fwd-proxy"} do={
    :foreach id in=[/ip/firewall/filter/find where comment=$c] do={
        /ip/firewall/filter/remove $id
        :set removed ($removed + 1)
    }
}
:foreach id in=[/ip/firewall/filter/find where chain=input in-interface=pppoe-wan protocol=tcp dst-port=8088 action=accept] do={
    /ip/firewall/filter/remove $id
    :set removed ($removed + 1)
}

# RAW/filter proxy gateway trên pppoe-wan (proxy chỉ pppoe-out1+)
:foreach id in=[/ip/firewall/raw/find where in-interface=pppoe-wan comment~"proxy gateway"] do={
    /ip/firewall/raw/remove $id
    :set removed ($removed + 1)
}
:foreach id in=[/ip/firewall/filter/find where comment~"proxy gateway"] do={
    /ip/firewall/filter/remove $id
    :set removed ($removed + 1)
}

# MANGLE: mark/reply routing thử nghiệm (không dùng)
:foreach id in=[/ip/firewall/mangle/find where comment~"mark-in-pppoe-wan|route-reply-pppoe-wan"] do={
    /ip/firewall/mangle/remove $id
    :set removed ($removed + 1)
}

# ROUTING: rule INACTIVE theo IP tĩnh
:foreach id in=[/routing/rule/find where comment~"reply-pppoe-wan|reply-fwmark-pppoe-wan"] do={
    /routing/rule/remove $id
    :set removed ($removed + 1)
}
:foreach id in=[/ip/route/find where routing-table=rt-pppoe-wan] do={
    /ip/route/remove $id
    :set removed ($removed + 1)
}
:foreach id in=[/routing/table/find where name=rt-pppoe-wan] do={
    /routing/table/remove $id
    :set removed ($removed + 1)
}

# FIX: LAN/WAN dùng all-ppp (IP động, 2+ PPPoE)
:foreach id in=[/ip/firewall/filter/find where comment="FORWARD: Allow LAN -> WAN"] do={
    /ip/firewall/filter/set $id out-interface=all-ppp
}
:foreach id in=[/ip/firewall/filter/find where comment="FORWARD: Block WAN -> LAN"] do={
    /ip/firewall/filter/set $id in-interface=all-ppp
}
:foreach c in={"Drop NetBIOS ra WAN";"Drop SMB ra WAN";"Drop mDNS/LLMNR/SSDP ra WAN"} do={
    :foreach id in=[/ip/firewall/filter/find where comment=$c] do={
        /ip/firewall/filter/set $id out-interface=all-ppp
    }
}

:put ("cleanup-firewall-orphan: removed " . $removed . " rules, fixed all-ppp forward")