# ============================================================
# ensure-router-scripts.rsc — WebUI managed system scripts
# quayip + duckdns + protect + proxy-gateway
# ============================================================

:put "[router-scripts] quayip..."
/import file=disk1/webuiproxymikrotik/quayip.rsc

:put "[router-scripts] duckdns..."
/import file=disk1/webuiproxymikrotik/duckdns-pppoe-wan.rsc

:put "[router-scripts] protect pppoe-wan..."
/import file=disk1/webuiproxymikrotik/protect-pppoe-wan.rsc

:put "[router-scripts] proxy gateway..."
/import file=disk1/webuiproxymikrotik/ensure-proxy-gateway.rsc

:put "[router-scripts] pool pppoe isolation..."
/import file=disk1/webuiproxymikrotik/ensure-pool-pppoe.rsc

:put "[router-scripts] device routing skip lists..."
/import file=disk1/webuiproxymikrotik/ensure-device-routing.rsc

:put "[router-scripts] ssh blacklist..."
/import file=disk1/webuiproxymikrotik/ensure-ssh-blacklist.rsc

:put "[router-scripts] ssh port 22222..."
/import file=disk1/webuiproxymikrotik/ensure-ssh-port.rsc

:put "ensure-router-scripts: DONE"