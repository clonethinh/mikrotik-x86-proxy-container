# ============================================================
# DuckDNS: public IP tu pppoe-wan (luong chinh)
# pppoe-wan: protect, khong quayip, khong disable, khong xoa
# Proxy pool: chi pppoe-out1..X (pppoe-wan KHONG lam proxy)
# ============================================================

/system script remove [find name=duckdns-pppoe-wan]
/system script add dont-require-permissions=yes name=duckdns-pppoe-wan owner=admin policy=ftp,reboot,read,write,policy,test,password,sniff,sensitive,romon source={
# DuckDNS public IP - dung pppoe-wan (luong chinh)
# pppoe-wan: protect, khong quayip, khong disable
:local duckDomain "ntpcproxy"
:local duckToken "a3f4d923-2471-45d7-bd51-04f999d5ba88"
:local ddnsIf "pppoe-wan"
:local protectIf "pppoe-wan"

:global duckdnsLastIp
:if ([:typeof $duckdnsLastIp] = "nil") do={ :set duckdnsLastIp "" }

:local wanId [/interface pppoe-client find where name=$protectIf]
:if ([:len $wanId] > 0) do={
    :if ([/interface pppoe-client get $wanId disabled] = true) do={
        :log error "DuckDNS: pppoe-wan bi DISABLE - bat lai ngay!"
        /interface pppoe-client enable $wanId
    }
    :local cmt [/interface pppoe-client get $wanId comment]
    :if ($cmt != "WAN-DDNS-PROTECTED") do={
        /interface pppoe-client set $wanId comment="WAN-DDNS-PROTECTED"
    }
}

:local pcId [/interface pppoe-client find where name=$ddnsIf]
:if ([:len $pcId] = 0) do={
    :log error ("DuckDNS: khong tim thay " . $ddnsIf)
} else={
    :local addrId [/ip address find where interface=$ddnsIf]
    :if ([:len $addrId] = 0) do={
        :log warning ("DuckDNS: " . $ddnsIf . " chua co IP, bo qua")
    } else={
        :local addr [/ip address get [:pick $addrId 0] address]
        :local pubIp [:pick $addr 0 [:find $addr "/"]]
        :if ($pubIp = $duckdnsLastIp) do={
            :log info ("DuckDNS: IP khong doi (" . $pubIp . "), bo qua")
        } else={
            :local url ("https://www.duckdns.org/update?domains=" . $duckDomain . "&token=" . $duckToken . "&ip=" . $pubIp)
            :do {
                /tool fetch url=$url mode=https http-method=get keep-result=no
                :set duckdnsLastIp $pubIp
                :log info ("DuckDNS: cap nhat " . $duckDomain . ".duckdns.org -> " . $pubIp . " (tu " . $ddnsIf . ")")
            } on-error={
                :log error ("DuckDNS: loi cap nhat IP " . $pubIp)
            }
        }
    }
}
}

/system scheduler remove [find name=duckdns-pppoe-wan]
/system scheduler add name=duckdns-pppoe-wan start-time=startup interval=5m \
    on-event="/system script run duckdns-pppoe-wan"

/system script run duckdns-pppoe-wan
:put "duckdns: ddnsIf=pppoe-wan protect=pppoe-wan scheduler=5m"