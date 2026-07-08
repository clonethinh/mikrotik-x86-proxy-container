#!/bin/bash
# Upload webuiproxymikrotik scripts to Mikrotik /disk1/
# Usage: ./upload-to-mikrotik.sh
set -e

MIK_HOST="${MIK_HOST:-113.22.235.52}"
MIK_USER="${MIK_USER:-admin}"
MIK_PASS="${MIK_PASS:-toanthinh}"
SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)/mikrotik"

echo "=== Upload webuiproxymikrotik to $MIK_HOST ==="
sshpass -p "$MIK_PASS" ssh -o StrictHostKeyChecking=no \
  -o KexAlgorithms=+diffie-hellman-group1-sha1 \
  -o HostKeyAlgorithms=+ssh-rsa \
  -o PubkeyAcceptedKeyTypes=+ssh-rsa \
  "$MIK_USER@$MIK_HOST" "/disk1/" << 'EOF' 2>&1
:do {/file/remove [find name~"webuiproxymikrotik"]} on-error={}
EOF

sshpass -p "$MIK_PASS" scp -o StrictHostKeyChecking=no \
  -o KexAlgorithms=+diffie-hellman-group1-sha1 \
  -o HostKeyAlgorithms=+ssh-rsa \
  -o PubkeyAcceptedKeyTypes=+ssh-rsa \
  -r "$SRC_DIR" "$MIK_USER@$MIK_HOST:/disk1/webuiproxymikrotik"

echo "=== Done. Listing remote files ==="
sshpass -p "$MIK_PASS" ssh -o StrictHostKeyChecking=no \
  -o KexAlgorithms=+diffie-hellman-group1-sha1 \
  -o HostKeyAlgorithms=+ssh-rsa \
  -o PubkeyAcceptedKeyTypes=+ssh-rsa \
  "$MIK_USER@$MIK_HOST" "/file/print where name~\"webuiproxymikrotik\"" 2>&1 | head -20