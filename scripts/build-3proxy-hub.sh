#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE="${THREEPROXY_HUB_IMAGE:-webuiproxymikrotik/3proxy-hub:2}"
OUT="${THREEPROXY_HUB_TAR:-$ROOT/3proxy-hub.tar}"

echo "Building $IMAGE ..."
docker build --platform linux/amd64 -t "$IMAGE" -f "$ROOT/docker/3proxy-hub/Dockerfile" "$ROOT/docker/3proxy-hub"

echo "Saving to $OUT ..."
docker save "$IMAGE" -o "$OUT"
ls -lh "$OUT"
echo "Done. Upload to router as disk1/3proxy-hub.tar"