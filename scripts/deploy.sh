#!/bin/bash
# Deploy webuiproxymikrotik lên Mikrotik
# Usage:
#   MIK_PASS=toanthinh ./scripts/deploy.sh
# Hoặc edit 3 biến dưới nếu cần
set -e

# ============ CONFIG ============
MIK_HOST="${MIK_HOST:-ntpcproxy.duckdns.org}"
MIK_USER="${MIK_USER:-admin}"
MIK_PASS="${MIK_PASS:-toanthinh}"
WAN_IP="${WAN_IP:-42.119.198.233}"
SSH_PORT="${SSH_PORT:-22222}"
ADMIN_PASS="${ADMIN_PASS:-admin123}"
JWT_SECRET="${JWT_SECRET:-webuiproxymikrotik-change-in-prod-32chars-x}"

# Đường dẫn trên Mikrotik
REMOTE_DIR="/disk1/webuiproxymikrotik"
TAR_NAME="webuiproxymikrotik.tar"
CONTAINER_NAME="webuiproxymikrotik"

# Thư mục root
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

# SSH options (Mikrotik cũ dùng diffie-hellman-group1-sha1)
SSH_OPTS=(
  -p "$SSH_PORT"
  -o StrictHostKeyChecking=no
  -o KexAlgorithms=+diffie-hellman-group1-sha1
  -o HostKeyAlgorithms=+ssh-rsa
  -o PubkeyAcceptedKeyTypes=+ssh-rsa
  -o ConnectTimeout=15
)

echo "============================================================"
echo "  Deploy webuiproxymikrotik"
echo "  Target: $MIK_USER@$MIK_HOST"
echo "  WAN IP: $WAN_IP"
echo "============================================================"

# ============ STEP 1: Build Docker image (linux/amd64) ============
echo ""
if [[ "${SKIP_BUILD:-}" == "1" && -f "$TAR_NAME" ]]; then
  echo "=== STEP 1: SKIP_BUILD=1 — dùng $TAR_NAME có sẵn ($(du -h "$TAR_NAME" | cut -f1)) ==="
else
  echo "=== STEP 1: Build Docker image (linux/amd64) ==="
  docker buildx build --platform linux/amd64 -t webuiproxymikrotik:latest --load .
fi

# ============ STEP 2: Save to .tar ============
echo ""
if [[ "${SKIP_BUILD:-}" == "1" && -f "$TAR_NAME" ]]; then
  echo "=== STEP 2: SKIP_BUILD=1 — bỏ qua docker save ==="
else
  echo "=== STEP 2: Save image to .tar ==="
  rm -f "$TAR_NAME" 2>/dev/null || true
  docker save webuiproxymikrotik:latest > "$TAR_NAME"
fi
TAR_SIZE=$(du -h "$TAR_NAME" | cut -f1)
echo "  Built: $TAR_NAME ($TAR_SIZE)"

# ============ STEP 3: SCP .tar lên Mikrotik ============
echo ""
echo "=== STEP 3: Upload .tar to /disk1/ ==="
SCP_OPTS=(
  -P "$SSH_PORT"
  -o StrictHostKeyChecking=no
  -o KexAlgorithms=+diffie-hellman-group1-sha1
  -o HostKeyAlgorithms=+ssh-rsa
  -o PubkeyAcceptedKeyTypes=+ssh-rsa
  -o ConnectTimeout=15
)
sshpass -p "$MIK_PASS" scp "${SCP_OPTS[@]}" \
  "$TAR_NAME" "$MIK_USER@$MIK_HOST:/disk1/$TAR_NAME"

# ============ STEP 4: Stop + remove container cũ ============
echo ""
echo "=== STEP 4: Stop + remove old container ==="
sshpass -p "$MIK_PASS" ssh "${SSH_OPTS[@]}" "$MIK_USER@$MIK_HOST" \
  "/container/set [find name=$CONTAINER_NAME] start-on-boot=no" 2>/dev/null || true
for i in 1 2 3 4 5 6 8 10; do
  sshpass -p "$MIK_PASS" ssh "${SSH_OPTS[@]}" "$MIK_USER@$MIK_HOST" \
    "/container/stop [find name=$CONTAINER_NAME]" 2>/dev/null || true
  sleep "$i"
  STILL=$(sshpass -p "$MIK_PASS" ssh "${SSH_OPTS[@]}" "$MIK_USER@$MIK_HOST" \
    "/container/print where name=$CONTAINER_NAME" 2>/dev/null | grep -c ' R ' || true)
  echo "  stop attempt $i: running=$STILL"
  if [[ "$STILL" == "0" ]]; then break; fi
done
sshpass -p "$MIK_PASS" ssh "${SSH_OPTS[@]}" "$MIK_USER@$MIK_HOST" \
  ":do {/container/remove [find name=$CONTAINER_NAME]} on-error={}; \
   :delay 5s; \
   :do {/disk/remove [find name=webuiproxymikrotik-root]} on-error={}; \
   :do {/file/remove [find name=webuiproxymikrotik-root]} on-error={}"
REMAIN=$(sshpass -p "$MIK_PASS" ssh "${SSH_OPTS[@]}" "$MIK_USER@$MIK_HOST" \
  "/container/print where name=$CONTAINER_NAME" 2>/dev/null | grep -c "$CONTAINER_NAME" || true)
if [[ "$REMAIN" != "0" ]]; then
  echo "  WARN: container still exists — retry remove after REST stop"
  CID=$(curl -s -u "$MIK_USER:$MIK_PASS" "http://$MIK_HOST/rest/container?name=$CONTAINER_NAME" \
    | python3 -c "import sys,json; r=json.load(sys.stdin); print(r[0]['.id'] if r else '')" 2>/dev/null || true)
  if [[ -n "$CID" ]]; then
    curl -s -X POST -u "$MIK_USER:$MIK_PASS" -H 'Content-Type: application/json' \
      -d "{\".id\":\"$CID\"}" "http://$MIK_HOST/rest/container/stop" >/dev/null || true
    sleep 15
    curl -s -X POST -u "$MIK_USER:$MIK_PASS" -H 'Content-Type: application/json' \
      -d "{\".id\":\"$CID\"}" "http://$MIK_HOST/rest/container/remove" >/dev/null || true
    sleep 5
  fi
fi

# ============ STEP 5: Ensure mount list ============
echo ""
echo "=== STEP 5: Setup mount list ==="
sshpass -p "$MIK_PASS" ssh "${SSH_OPTS[@]}" "$MIK_USER@$MIK_HOST" \
  ":do {/container/mounts/remove [find list=MOUNT_DATA]} on-error={}; \
   /container/mounts/add list=MOUNT_DATA src=disk1/data dst=/data"

# ============ STEP 6: Create container với env mới ============
echo ""
echo "=== STEP 6: Create container ==="
ENV_STR="NODE_ENV=production,PORT=8088,DEPLOY_TARGET=router,MIKROTIK_HOST=172.17.0.1,MIKROTIK_API_USER=$MIK_USER,MIKROTIK_API_PASS=$MIK_PASS,MIKROTIK_REST_PORT=80,MIKROTIK_REST_SCHEME=http,MIKROTIK_SSH_PORT=$SSH_PORT,MIKROTIK_SSH_USER=$MIK_USER,MIKROTIK_SSH_PASS=$MIK_PASS,MIKROTIK_WAN_IP=$WAN_IP,MIKROTIK_WAN_HOST=ntpcproxy.duckdns.org,JWT_SECRET=$JWT_SECRET,ADMIN_USERNAME=admin,ADMIN_PASSWORD=$ADMIN_PASS,DATABASE_URL=file:/data/proxy.db,THREEPROXY_IMAGE=ghcr.io/tarampampam/3proxy:2,THREEPROXY_TARBALL=disk1/3proxy.tar,THREEPROXY_HUB_IMAGE=webuiproxymikrotik/3proxy-hub:2,THREEPROXY_HUB_TARBALL=disk1/3proxy-hub.tar,PROXY_DEPLOY_MODE=hub,HUB_SHARD_SIZE=50,HUB_SHARD_COUNT=6,HUB_MAX_PPPOE_OUT=300,LOW_CPU_MODE=true,HUB_REQUEST_LOG=true,LOGS_TAIL_ENABLED=true,METRICS_ENABLED=true,LOGS_TAIL_MS=10000,METRICS_POLL_MS=10000,CONTAINER_LOGGING=false,LOG_LEVEL=warn,HUB_FAST_IP_PEEK_MS=0,HUB_APPLY_FLUSH_MS=600,HUB_RELOAD_DEBOUNCE_MS=2500,FIREWALL_RECONCILE_ENABLED=true,FIREWALL_RECONCILE_INTERVAL_MS=1800000,FIREWALL_RECONCILE_MAX_SLOTS=15,HUB_NSCACHE=8192,HEALTH_CHECK_INTERVAL_MS=120000,HEALTH_CHECK_TIMEOUT_MS=10000,AUTO_PROXY_POLL_MS=15000,MIKROTIK_REST_CACHE_MS=10000,HUB_RATE_LIMIT_DEBOUNCE_MS=15000,PROXY_PING_ENABLED=true,PROXY_PING_INTERVAL_MS=45000,HEALTH_PING_BATCH_SIZE=6,ENABLE_REALTIME=true"

# Escape ký tự đặc biệt cho RouterOS CLI
ENV_ESC=$(echo "$ENV_STR" | sed 's/"/\\"/g')

WEBUI_ROOT="disk1/webuiproxymikrotik-root"
ADD_OUT=$(sshpass -p "$MIK_PASS" ssh "${SSH_OPTS[@]}" "$MIK_USER@$MIK_HOST" \
  "/container/add file=disk1/$TAR_NAME interface=veth-webui root-dir=$WEBUI_ROOT name=$CONTAINER_NAME mountlists=MOUNT_DATA logging=no start-on-boot=yes env=\"$ENV_ESC\"" 2>&1) || true
echo "  add: $ADD_OUT"
if echo "$ADD_OUT" | grep -q "root-dir overlap"; then
  echo "  root-dir overlap — retry with fresh root dir..."
  WEBUI_ROOT="disk1/webuiproxymikrotik-r$(date +%s)"
  sshpass -p "$MIK_PASS" ssh "${SSH_OPTS[@]}" "$MIK_USER@$MIK_HOST" \
    ":do {/container/stop [find name=$CONTAINER_NAME]} on-error={}; :delay 5s; \
     :do {/container/remove [find name=$CONTAINER_NAME]} on-error={}; :delay 5s"
  ADD_OUT2=$(sshpass -p "$MIK_PASS" ssh "${SSH_OPTS[@]}" "$MIK_USER@$MIK_HOST" \
    "/container/add file=disk1/$TAR_NAME interface=veth-webui root-dir=$WEBUI_ROOT name=$CONTAINER_NAME mountlists=MOUNT_DATA logging=no start-on-boot=yes env=\"$ENV_ESC\"" 2>&1) || true
  echo "  add retry: $ADD_OUT2"
  if echo "$ADD_OUT2" | grep -q "failure:"; then
    echo "  FATAL: container add failed"
    exit 1
  fi
elif echo "$ADD_OUT" | grep -q "failure:"; then
  echo "  FATAL: container add failed"
  exit 1
fi

# ============ STEP 7: Wait for image extract ============
echo ""
echo "=== STEP 7: Wait for image extract (45s) ==="
for i in 1 2 3 4 5 6 7 8 9; do
  sleep 5
  STATUS=$(sshpass -p "$MIK_PASS" ssh "${SSH_OPTS[@]}" "$MIK_USER@$MIK_HOST" \
    "/container/print where name=$CONTAINER_NAME" 2>/dev/null | grep -oE "(EXTRACTING|RUNNING|FAILED|STOPPED|HEALTHY)" | head -1)
  echo "  t+$((i*5))s: $STATUS"
  if [[ "$STATUS" == "RUNNING" || "$STATUS" == "HEALTHY" ]]; then
    break
  fi
  if [[ "$STATUS" == "FAILED" ]]; then
    echo "  EXTRACT FAILED — check /log print"
    break
  fi
done

# ============ STEP 8: Start container (nếu chưa running) ============
echo ""
echo "=== STEP 8: Start container ==="
sshpass -p "$MIK_PASS" ssh "${SSH_OPTS[@]}" "$MIK_USER@$MIK_HOST" \
  ":do {/container/start [find name=$CONTAINER_NAME]} on-error={}"

# ============ STEP 9: Wait backend boot ============
echo ""
echo "=== STEP 9: Wait for backend boot (25s) ==="
sleep 25
sshpass -p "$MIK_PASS" ssh "${SSH_OPTS[@]}" "$MIK_USER@$MIK_HOST" \
  "/container/print where name=$CONTAINER_NAME"

echo ""
echo "============================================================"
echo "  DONE!"
echo "  WebUI: http://$WAN_IP:8088"
echo "  Login: admin / $ADMIN_PASS"
echo "============================================================"