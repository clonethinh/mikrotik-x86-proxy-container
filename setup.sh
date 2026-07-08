#!/usr/bin/env bash
# 1-click setup — MikroTik mới (WSL / Linux / macOS)
set -euo pipefail
cd "$(dirname "$0")"

echo "============================================================"
echo "  webuiproxymikrotik — 1-click setup"
echo "============================================================"

if ! command -v node >/dev/null 2>&1; then
  echo "Cần cài Node.js 20+ (https://nodejs.org)"
  exit 1
fi
if ! command -v docker >/dev/null 2>&1; then
  echo "Cần Docker Desktop / docker CLI"
  exit 1
fi

if [[ ! -f setup.config.json ]]; then
  echo ""
  echo "Chưa có setup.config.json — chạy wizard..."
  node scripts/setup-wizard.js
fi

node setup/orchestrator.js "$@"