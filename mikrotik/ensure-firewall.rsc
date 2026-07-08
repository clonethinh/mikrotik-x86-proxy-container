# ============================================================
# webuiproxymikrotik: ensure-firewall.rsc
# DEPRECATED bulk range — per-proxy rules are created via REST API
# (webuiproxymikrotik-fwd-http-N / fwd-socks-N / in-http-N)
# This script only removes legacy static ranges if present.
# ============================================================

:local removed 0
:foreach rule in=[/ip/firewall/filter/find where comment="webuiproxymikrotik-accept-proxy-range"] do={
    /ip/firewall/filter/remove $rule
    :set removed ($removed + 1)
}
:foreach rule in=[/ip/firewall/filter/find where comment="webuiproxymikrotik-accept-proxy-range-socks"] do={
    /ip/firewall/filter/remove $rule
    :set removed ($removed + 1)
}
:foreach rule in=[/ip/firewall/filter/find where comment="webuiproxymikrotik-accept-input-proxy"] do={
    /ip/firewall/filter/remove $rule
    :set removed ($removed + 1)
}
:put ("webuiproxymikrotik: ensure-firewall DONE (removed legacy ranges: " . $removed . ")")