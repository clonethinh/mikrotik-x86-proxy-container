#!/bin/sh
set -e

detect_iface() {
  ip -4 addr show 2>/dev/null | awk '/inet / && $NF != "lo" {print $NF; exit}'
}

IFACE="${HUB_IFACE:-$(detect_iface)}"
IFACE="${IFACE:-eth0}"

normalize_ip() {
  echo "$1" | sed 's/\\n//g; s#/.*##'
}

add_ips() {
  for raw in "$@"; do
    ip="$(normalize_ip "$raw")"
    [ -z "$ip" ] && continue
    case "$ip" in
      172.*|10.*|192.168.*) ;;
      *) continue ;;
    esac
    if ip -4 addr show dev "$IFACE" 2>/dev/null | grep -q "inet ${ip}/"; then
      continue
    fi
    ip addr add "${ip}/32" dev "$IFACE" 2>/dev/null || true
  done
}

if [ -f /etc/3proxy/hub-slot-ips ]; then
  add_ips $(grep -v '^#' /etc/3proxy/hub-slot-ips | tr -d '\r' | tr '\n' ' ')
fi

if [ -n "${HUB_SLOT_IPS:-}" ]; then
  add_ips $(echo "$HUB_SLOT_IPS" | tr ',' ' ')
fi

# Hub mode: dùng cfg mount từ RouterOS (multi-slot). Lua entrypoint chỉ tạo single-port từ env.
mkdir -p /var/log/3proxy 2>/dev/null || true

if [ -f /etc/3proxy/3proxy.cfg ]; then
  exec /bin/3proxy /etc/3proxy/3proxy.cfg
fi

exec /bin/lua /entrypoint.lua