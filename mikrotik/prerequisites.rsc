# ============================================================
# webuiproxymikrotik: prerequisites.rsc
# Router mới — chuẩn bị tối thiểu trước khi deploy WebUI + hub proxy
# Usage: /import file=disk1/webuiproxymikrotik/prerequisites.rsc
# ============================================================

:put "==========================================="
:put "webuiproxymikrotik: prerequisites"
:put "==========================================="

:do {/file/add name=disk1/data type=directory} on-error={}
:do {/file/add name=disk1/webuiproxymikrotik type=directory} on-error={}
:put "disk1/data + disk1/webuiproxymikrotik OK"

:if ([:len [/system/package/find where name=container]] > 0) do={
    :put "package container: OK"
} else={
    :put "WARN: package container CHUA CAI — System > Packages > container"
}

:if ([:len [/interface/pppoe-client/find name=pppoe-wan]] > 0) do={
    :put "pppoe-wan: OK"
} else={
    :put "WARN: chua co pppoe-wan — can WAN quan ly (Winbox/SSH) truoc khi dung WebUI"
}

:if ([:len [/interface/bridge/find name=containers-veth]] = 0) do={
    /import file=disk1/webuiproxymikrotik/ensure-bridge.rsc
} else={
    :put "bridge containers-veth: da co"
}

:do {/system/ntp/client/set enabled=yes servers=vn.pool.ntp.org,time.google.com,asia.pool.ntp.org} on-error={
    :put "WARN: khong set duoc NTP client"
}
:do {/system/clock/set time-zone-name=Asia/Ho_Chi_Minh} on-error={
    :put "WARN: khong set duoc timezone VN"
}

:put "==========================================="
:put "prerequisites DONE — tiep theo: chay setup 1-click tu PC"
:put "==========================================="