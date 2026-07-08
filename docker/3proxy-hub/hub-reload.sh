#!/bin/sh
# Rolling reload — re-apply slot IP aliases + SIGUSR1 config reload (no connection drop)
set -e

detect_iface() {
  ip -4 addr show 2>/dev/null | awk '/inet / && $NF != "lo" {print $NF; exit}'
}

IFACE="${HUB_IFACE:-$(detect_iface)}"
IFACE="${IFACE:-eth0}"

normalize_ip() {
  echo "$1" | sed 's/\\n//g; s#/.*##; s/\r//'
}

if [ -f /etc/3proxy/hub-slot-ips ]; then
  while IFS= read -r raw || [ -n "$raw" ]; do
    ip="$(normalize_ip "$raw")"
    [ -z "$ip" ] && continue
    case "$ip" in
      172.*|10.*|192.168.*) ;;
      *) continue ;;
    esac
    if ! ip -4 addr show dev "$IFACE" 2>/dev/null | grep -q "inet ${ip}/"; then
      ip addr add "${ip}/32" dev "$IFACE" 2>/dev/null || true
    fi
  done < /etc/3proxy/hub-slot-ips
fi

mkdir -p /var/log/3proxy 2>/dev/null || true

PID="$(pidof 3proxy 2>/dev/null | awk '{print $1}')"
if [ -n "$PID" ]; then
  kill -USR1 "$PID" 2>/dev/null && exit 0
fi

# Fallback: cold start if 3proxy not running
if [ -f /etc/3proxy/3proxy.cfg ]; then
  exec /bin/3proxy /etc/3proxy/3proxy.cfg
fi

exec /bin/lua /entrypoint.lua