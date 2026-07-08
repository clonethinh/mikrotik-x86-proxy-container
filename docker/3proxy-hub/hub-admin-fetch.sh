#!/bin/sh
# Fetch 3proxy admin XML from inside hub container (bind IP is not reachable from WebUI subnet).
PATH_URL="${1:-/S}"
PORT="${2:-31800}"
CFG=/etc/3proxy/3proxy.cfg
PASS=$(grep '^users ' "$CFG" 2>/dev/null | tr ' ' '\n' | grep '^_webui_mon:CL:' | head -1 | sed 's/_webui_mon:CL://')
HOST=$(grep '^admin ' "$CFG" 2>/dev/null | sed -n 's/.*-i\([^ ]*\).*/\1/p')
[ -z "$HOST" ] && HOST=127.0.0.1
[ -z "$PASS" ] && exit 1
AUTH=$(printf '%s' "_webui_mon:${PASS}" | base64 2>/dev/null | tr -d '\n')
wget -qO- --header "Authorization: Basic ${AUTH}" "http://${HOST}:${PORT}${PATH_URL}" 2>/dev/null