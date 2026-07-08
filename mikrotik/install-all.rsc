# ============================================================
# webuiproxymikrotik: install-all.rsc
# One-shot install: chạy tất cả ensure-* scripts theo thứ tự
# Usage: /import file=disk1/install-all.rsc
# ============================================================

:put "==========================================="
:put "webuiproxymikrotik: install-all starting"
:put "==========================================="

:put ""
:put "[1/5] ensure-bridge"
/import file=disk1/webuiproxymikrotik/ensure-bridge.rsc

:put ""
:put "[2/5] ensure-veth-for-pppoe"
/import file=disk1/webuiproxymikrotik/ensure-veth-for-pppoe.rsc

:put ""
:put "[3/5] ensure-routing"
/import file=disk1/webuiproxymikrotik/ensure-routing.rsc

:put ""
:put "[4/5] ensure-dstnat"
/import file=disk1/webuiproxymikrotik/ensure-dstnat.rsc

:put ""
:put "[5/6] ensure-firewall"
/import file=disk1/webuiproxymikrotik/ensure-firewall.rsc

:put ""
:put "[6/7] ensure-mgmt-access"
/import file=disk1/webuiproxymikrotik/ensure-mgmt-access.rsc

:put ""
:put "[7/7] ensure-router-scripts (quayip + duckdns + protect)"
/import file=disk1/webuiproxymikrotik/ensure-router-scripts.rsc

:put ""
:put "==========================================="
:put "webuiproxymikrotik: install-all DONE"
:put "==========================================="
:put "Next: build & upload webuiproxymikrotik image, then /container add + start"