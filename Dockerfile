# Multi-stage Dockerfile for webuiproxymikrotik
# Build: docker buildx build --platform linux/amd64 -t webuiproxymikrotik:latest --load .
# For RouterOS x86_64 container
#
# IMPORTANT FOR SPEED:
# - Always use .dockerignore (we added one)
# - For dev: use `npm run setup -- --skip-build` to avoid rebuild
# - Prefer REST deploy scripts for code changes instead of full rebuild

# ============ Stage 1: builder (debian, native prisma binary) ============
FROM node:22-bookworm-slim AS builder

# Use BuildKit cache mount for npm (much faster on repeated builds)
RUN --mount=type=cache,target=/root/.npm \
    apt-get update -y && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Copy only package files first → best cache layer
COPY backend/package.json backend/package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund || npm install --no-audit --no-fund

# Prisma (rarely changes)
COPY backend/prisma ./prisma
RUN npx prisma generate

# Backend source (changes often)
COPY backend/tsconfig.json ./
COPY backend/src ./src
RUN npx tsc

# Prune + pre-create DB
RUN npm prune --omit=dev
RUN DATABASE_URL=file:/build/proxy.db npx prisma db push --skip-generate --accept-data-loss

# Frontend dists are pre-built on host (see setup/steps/build.js)
# Only copy the small dist folders (not the full source)
COPY frontend/dist ./public
COPY frontend-mobile/dist ./public/mobile

# ============ Stage 2: runtime (debian-slim) ============
FROM node:22-bookworm-slim AS runtime
RUN apt-get update -y && apt-get install -y openssl ca-certificates tini iproute2 && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Copy only what is needed from builder
COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/dist ./dist
COPY --from=builder /build/prisma ./prisma
COPY --from=builder /build/package.json ./package.json
COPY --from=builder /build/public ./public

ENV NODE_ENV=production
ENV PORT=8088

# Pre-create empty DB at /data/proxy.db (volume mount will override this)
RUN mkdir -p /data && echo "" > /data/proxy.db && (addgroup -g 1000 node 2>/dev/null || true) && (adduser -S node -G node 2>/dev/null || true) && chown -R node:node /data /app 2>/dev/null || true
# Add route tới 172.16.0.0/12 (toàn bộ proxy container subnets) qua bridge gateway 172.17.0.1
# Webui container chỉ tự động có route tới 172.17.0.0/16 (own subnet), cần thêm route thủ công
# để connect tới proxy containers ở 172.18–172.31.x.x trong cùng bridge containers-veth
# Giữ tini để có proper signal handling (graceful shutdown, zombie reaping)
# Auto-detect interface name + log kết quả
RUN { \
  echo '#!/bin/sh'; \
  echo '# Auto-detect: tìm interface có IP 172.17.0.x'; \
  echo '# Wait for network ready (sometimes not ready immediately on Mikrotik Container)'; \
  echo 'for i in 1 2 3 4 5 6 7 8 9 10; do'; \
  echo '  IFACE=$(ip -4 addr show 2>/dev/null | awk "/inet 172\\.17\\./ {print \$NF; exit}")'; \
  echo '  if [ -n "$IFACE" ]; then break; fi'; \
  echo '  sleep 1'; \
  echo 'done'; \
  echo 'if [ -n "$IFACE" ]; then'; \
  echo '  echo "[entrypoint] adding route 172.16.0.0/12 via 172.17.0.1 dev $IFACE"'; \
  echo '  ip route add 172.16.0.0/12 via 172.17.0.1 dev "$IFACE" 2>&1'; \
  echo '  ip route show | grep 172.1 || echo "[entrypoint] route NOT in table"'; \
  echo 'else'; \
  echo '  echo "[entrypoint] WARN: cannot find 172.17.x interface after 10s"'; \
  echo '  ip -4 addr show'; \
  echo 'fi'; \
  echo 'exec /usr/bin/tini -- runuser -u node -- "$@"'; \
} > /usr/local/bin/container-entrypoint.sh && chmod +x /usr/local/bin/container-entrypoint.sh
VOLUME ["/data"]
EXPOSE 8088
USER root
ENTRYPOINT ["/usr/local/bin/container-entrypoint.sh"]
CMD ["node", "dist/server.js"]