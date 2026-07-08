#!/bin/bash
# Verify dashboard realtime API after deploy
set -euo pipefail

BASE="${WEBUI_URL:-http://ntpcproxy.duckdns.org:8088}"
USER="${ADMIN_USER:-admin}"
PASS="${ADMIN_PASS:-admin123}"

echo "=== Login $BASE ==="
TOKEN=$(curl -sS -m 15 -X POST "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"$USER\",\"password\":\"$PASS\"}" \
  | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))")
if [ -z "$TOKEN" ]; then echo "FAIL: no token"; exit 1; fi
echo "OK token"

echo "=== Dashboard snapshot ==="
DASH_JSON=$(curl -sS -m 25 -H "Authorization: Bearer $TOKEN" "$BASE/api/dashboard")
python3 - <<'PY' "$DASH_JSON"
import sys, json
d = json.loads(sys.argv[1])
fail = []

def need(cond, msg):
    if not cond:
        fail.append(msg)

need(d.get('live') is True, 'live != true')
need(d.get('source') == 'mikrotik', 'source != mikrotik')
need('wanTraffic' in d and d['wanTraffic'], 'wanTraffic missing')
need('dhcpLeases' in d, 'dhcpLeases not embedded')
need(d.get('routerMonitor', {}).get('live') is True, 'routerMonitor.live missing')

wt = d.get('wanTraffic') or {}
need(wt.get('live') is True, 'wanTraffic.live false')

leases = d.get('dhcpLeases') or []
bound = [l for l in leases if l.get('status') == 'bound']
print(f"wanUp/totalWan: {d.get('wanUp')}/{d.get('totalWan')}")
print(f"proxy containers: {d.get('runningProxies')}/{d.get('totalProxies')}")
print(f"dhcp leases: {len(leases)} (bound {len(bound)})")
print(f"wanTraffic rxBps/txBps: {wt.get('rxBps')}/{wt.get('txBps')}")
if bound:
    l = bound[0]
    print(f"sample lease traffic: {l.get('hostName')} rxBps={l.get('rxBps')} txBps={l.get('txBps')} live={l.get('trafficLive')}")

if fail:
    print('FAIL:', '; '.join(fail))
    sys.exit(1)
print('PASS: dashboard realtime fields OK')
PY

echo "=== Poll freshness (2 samples) ==="
TS1=$(curl -sS -m 20 -H "Authorization: Bearer $TOKEN" "$BASE/api/dashboard" | python3 -c "import sys,json; print(json.load(sys.stdin).get('timestamp',0))")
sleep 3
TS2=$(curl -sS -m 20 -H "Authorization: Bearer $TOKEN" "$BASE/api/dashboard" | python3 -c "import sys,json; print(json.load(sys.stdin).get('timestamp',0))")
python3 - <<PY
ts1, ts2 = int("$TS1"), int("$TS2")
if ts2 <= ts1:
    print(f"FAIL: timestamp not advancing ({ts1} -> {ts2})")
    raise SystemExit(1)
print(f"PASS: timestamp advanced {ts1} -> {ts2}")
PY

echo "=== ALL CHECKS PASSED ==="