# ============================================================
# protect-pppoe-wan.rsc
# pppoe-wan: luồng chính — KHÔNG disable, KHÔNG xóa
# DuckDNS + WebUI management. Proxy pool bắt đầu từ pppoe-out1.
# ============================================================

/system script remove [find name=protect-pppoe-wan]
/system script add dont-require-permissions=yes name=protect-pppoe-wan owner=admin \
    policy=ftp,reboot,read,write,policy,test,password,sniff,sensitive,romon source={
:local protectIf "pppoe-wan"
:local wanId [/interface pppoe-client find where name=$protectIf]

:if ([:len $wanId] = 0) do={
    :log error "PROTECT: pppoe-wan BI XOA — tao lai ngay!"
    /interface pppoe-client add name=pppoe-wan interface=macvlan-wan \
        user="Dnfdl-260628-7098" profile=default add-default-route=yes \
        default-route-distance=1 disabled=no comment="WAN-DDNS-PROTECTED"
} else={
    :if ([/interface pppoe-client get $wanId disabled] = true) do={
        :log error "PROTECT: pppoe-wan bi DISABLE — bat lai ngay!"
        /interface pppoe-client enable $wanId
    }
    :local cmt [/interface pppoe-client get $wanId comment]
    :if ($cmt != "WAN-DDNS-PROTECTED") do={
        /interface pppoe-client set $wanId comment="WAN-DDNS-PROTECTED"
    }
}
}

/system scheduler remove [find name=protect-pppoe-wan]
/system scheduler add name=protect-pppoe-wan start-time=startup interval=2m \
    on-event="/system script run protect-pppoe-wan"

/system script run protect-pppoe-wan
:put "protect-pppoe-wan: scheduler 2m, auto-enable + recreate if missing"