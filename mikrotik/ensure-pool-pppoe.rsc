# ============================================================
# ensure-pool-pppoe.rsc
# pppoe-out1..N: chỉ egress proxy — KHÔNG thêm default route/DNS vào main
# (tránh LAN mất mạng khi 1 phiên pool dính IP xấu/CGNAT)
# pppoe-wan: giữ nguyên add-default-route=yes
# ============================================================

:local n 0
:foreach pc in=[/interface pppoe-client find where name~"^pppoe-out"] do={
    /interface pppoe-client set $pc add-default-route=no use-peer-dns=no
    :set n ($n + 1)
}
:put ("ensure-pool-pppoe: $n pool client(s) isolated from main default route")