# webuiproxymikrotik

[![CI](https://github.com/clonethinh/mikrotik-x86-proxy-container/actions/workflows/ci.yml/badge.svg)](https://github.com/clonethinh/mikrotik-x86-proxy-container/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**WebUI toàn diện quản lý proxy multi-PPPoE trên MikroTik RouterOS v7 (Container) + 3proxy hub.**

Mỗi PPPoE WAN = 1 proxy riêng (HTTP + SOCKS5) với **IP public thật** của chính WAN đó.  
Toàn bộ stack (Backend + Frontend desktop + Frontend mobile + 3proxy hub shards) chạy **trực tiếp trên router x86_64** — không bắt buộc VPS.

📦 **GitHub:** https://github.com/clonethinh/mikrotik-x86-proxy-container

```bash
git clone https://github.com/clonethinh/mikrotik-x86-proxy-container.git
cd mikrotik-x86-proxy-container
```

---

## Mục lục

1. [Tổng quan & tính năng](#tổng-quan--tính-năng)
2. [Kiến trúc hệ thống](#kiến-trúc-hệ-thống)
3. [Tech stack](#tech-stack)
4. [Cấu trúc thư mục](#cấu-trúc-thư-mục)
5. [Chi tiết codebase](#chi-tiết-codebase)
6. [Yêu cầu hệ thống](#yêu-cầu-hệ-thống)
7. [Cài đặt nhanh (Windows 1-click)](#cài-đặt-nhanh-windows-1-click)
8. [Cấu hình](#cấu-hình)
9. [WebUI](#webui)
10. [API REST & WebSocket](#api-rest--websocket)
11. [Mô hình dữ liệu (Prisma)](#mô-hình-dữ-liệu-prisma)
12. [MikroTik scripts](#mikrotik-scripts)
13. [Scripts & automation](#scripts--automation)
14. [Chế độ deploy & scale](#chế-độ-deploy--scale)
15. [Background services](#background-services)
16. [Phát triển local](#phát-triển-local)
17. [Troubleshooting](#troubleshooting)
18. [Bảo mật](#bảo-mật)
19. [Tài liệu tham khảo](#tài-liệu-tham-khảo)
20. [License](#license)

---

## Tổng quan & tính năng

| Nhóm | Chi tiết |
|------|----------|
| **Proxy per-PPPoE** | Routing + NAT + dstnat + hub slot cho từng `pppoe-outN` → exit IP = IP public WAN đó |
| **Hub mode scale** | 1–N container **3proxy-hub** (shard), mỗi shard nhiều slot; mặc định tới **300** PPPoE (`HUB_MAX_PPPOE_OUT`) |
| **IP quality** | Phân loại `public` / `cgnat` / `link_local` / `private` / `missing`; `isUsableWanIp` thống nhất watcher + peek IP + quayip |
| **Egress động (hub)** | Proxy có thể gắn `egressPppoeName` khác slot; pool reallocate khi WAN chết / IP xấu |
| **Auto provision** | WanWatcher: phát hiện WAN mới → countdown → tạo proxy; mode `off` / `semi` / `full` |
| **WAN queue** | Tạo/bật PPPoE tuần tự (`create-next`, enable + auto-proxy, bulk enable/disable) |
| **Quay IP (quayip)** | Script RouterOS + scheduler **5m**, max **16** lần quay/phiên; bỏ qua `pppoe-wan` |
| **Dashboard realtime** | CPU / RAM / HDD, WAN traffic, LAN device traffic, fleet overview |
| **LAN traffic** | Mangle + conn-mark idempotent — upload/download theo host LAN |
| **Rate limit & quota** | Speed up/down, quota ngày/tuần/tháng, max conn, giờ hoạt động, hết hạn (3proxy + firewall) |
| **Device routing** | Gán thiết bị LAN (IP / MAC / DHCP hostname) ra đúng WAN |
| **SSH hardening** | Port mặc định `22222`, blacklist brute-force tự động |
| **Router scripts UI** | Settings: ensure/run quayip, DuckDNS, protect-pppoe-wan, SSH blacklist — có **summary + IP changes** |
| **Redeploy thông minh** | REST redeploy, HTTP bootstrap restore, `post-deploy-bootstrap` sync `.rsc` + scripts |
| **Dual UI** | Desktop Ant Design `/` · Mobile HeroUI `/m/` |
| **Realtime WebSocket** | Status, IP change, health, traffic, audit (replay buffer) |
| **Export / Import** | Nhiều format + bulk credentials |
| **Audit** | Log mọi thao tác admin |
| **LOW_CPU_MODE** | Giảm poll metrics/logs/reconcile; tăng debounce rate-limit (15s) khi bật |
| **Windows 1-click** | `setup.bat` — winget, wizard, build, upload, import, fleet bootstrap |

---

## Kiến trúc hệ thống

```
MikroTik RouterOS v7 (x86_64) + package container
│
├── bridge containers-veth
│   ├── veth-webui        → webuiproxymikrotik     (Fastify + dual SPA + SQLite)
│   ├── veth-3p-hub-0..N  → 3proxy-hub shard       (nhiều slot / container)
│   └── (legacy) veth-3p-N → proxy3p-N             (1 container / 1 PPPoE)
│
├── pppoe-wan             → WAN quản trị (DuckDNS, WebUI, SSH) — được protect script bảo vệ
├── pppoe-out1..N         → pool proxy WAN
│       └── mangle mark-routing → route table to_pppoeN
│       └── srcnat → IP public thật của interface
│
└── disk1/
    ├── data/proxy.db              SQLite persistent
    ├── 3proxy-hub.tar             image hub
    ├── webuiproxymikrotik.tar     image WebUI
    └── webuiproxymikrotik/*.rsc   script RouterOS
```

### Luồng traffic 1 proxy

```
Client ──► <public-ip-hoặc-host>:30055+N (HTTP) / 31055+N (SOCKS)
              │ dstnat → 3proxy slot (internal 20000+N / 21000+N)
              │
Outbound ──► mangle src=slot-ip → routing-mark to_pppoeN (hoặc egress)
              │ default route via pppoe-outN
              │ srcnat → public IP của WAN egress
              ▼
           Internet (exit IP = IP public WAN)
```

### Port map (mặc định)

| Vai trò | Công thức / giá trị |
|---------|---------------------|
| HTTP nội bộ | `20000 + N` |
| SOCKS nội bộ | `21000 + N` |
| HTTP external | `30055 + N` |
| SOCKS external | `31055 + N` |
| WebUI desktop | `:8088/` |
| WebUI mobile | `:8088/m/` |
| SSH router | `22222` (khuyến nghị) |
| Management host | DuckDNS / `MIKROTIK_WAN_HOST` (không hardcode IP) |

### Idempotency

Mọi rule RouterOS dùng **comment marker** (`ctn-pppoe-outN`, `ctn-mangle-…`, `gw-veth-…`…).  
`install-all.rsc` / ensure scripts / firewall reconcile chạy lại an toàn.

### IP quality (đồng bộ quayip)

| Quality | Ví dụ | Usable? |
|---------|--------|---------|
| `public` | `42.x.x.x` | ✅ |
| `cgnat` | `100.64.0.0/10` | ❌ client ngoài không vào được |
| `link_local` | `169.254.x.x` | ❌ PPPoE lỗi |
| `private` | `10/8`, `192.168/16`… | ❌ (tuỳ rejectPrivate) |
| `missing` / `invalid` | — | ❌ |

WanWatcher + HealthMonitor + peek IP chỉ **finalize proxy** khi `isUsableWanIp`.  
IP xấu → đánh dấu pending + thử **đổi egress pool** (hub).

---

## Tech stack

| Thành phần | Công nghệ |
|------------|-----------|
| Frontend desktop | React 18, TypeScript, Vite 6, **Ant Design 6**, @ant-design/plots, Zustand |
| Frontend mobile | React 19, TypeScript, Vite 6, **HeroUI 3**, Tailwind CSS 4, Motion, Zustand |
| Backend | Node.js 22, **Fastify 5**, TypeScript, **Prisma 5**, SQLite, Zod, argon2, ssh2 |
| Realtime | `@fastify/websocket` + custom event hub (replay) |
| Proxy engine | **3proxy hub** (`webuiproxymikrotik/3proxy-hub:2`) — multi-slot cfg mount |
| RouterOS | v7.4+ (Container, mangle, routing, firewall, REST + SSH) |
| Deploy | Docker multi-stage (linux/amd64), setup orchestrator Windows, REST redeploy |
| CI | GitHub Actions — build backend + frontend on `main` |

---

## Cấu trúc thư mục

```
webuiproxymikrotik/
├── backend/                    # API + business logic
│   ├── src/
│   │   ├── server.ts           # Fastify entry, dual SPA, bootstrap services
│   │   ├── routes/             # auth, proxies, wan, devices, system, …
│   │   ├── services/           # proxy, mikrotik, metrics, auto, wan, …
│   │   ├── lib/                # config, queue, ipQuality, hub, network utils
│   │   ├── middleware/auth.ts
│   │   ├── realtime/hub.ts
│   │   ├── ws/handler.ts
│   │   └── db/prisma.ts
│   ├── prisma/schema.prisma
│   └── .env.example
│
├── frontend/                   # Desktop SPA → /
├── frontend-mobile/            # Mobile SPA → /m/
│
├── docker/3proxy-hub/          # Hub image: entrypoint multi-slot + reload
├── mikrotik/                   # *.rsc idempotent
├── setup/                      # 1-click Windows orchestrator + steps
├── scripts/                    # deploy, post-deploy, scale, cleanup, diag
├── docs/                       # architecture, RouterOS commands
│
├── Dockerfile                  # WebUI multi-stage (Node 22)
├── docker-compose.yml          # DEPLOY_TARGET=external
├── setup.bat / setup.ps1
├── setup.config.example.json
├── package.json
└── README.md
```

---

## Chi tiết codebase

### Backend — routes

| File | Endpoint chính |
|------|----------------|
| `auth.ts` | login, logout, me, change-password, refresh |
| `proxies.ts` | CRUD, start/stop/restart, reload-ip, test, reapply, bulk, export/import, credentials, history |
| `proxyMetrics.ts` | live metrics, history, limits, uptime |
| `proxyLogs.ts` | request logs, domain stats, tail |
| `wan.ts` | create-queue, create-next, create, enable/disable, bulk enable/disable |
| `devices.ts` | device routing CRUD + apply, DHCP leases |
| `system.ts` | dashboard, router-monitor, redeploy-webui, firewall reconcile, SSH blacklist, **router-scripts** (ensure/run + summary), clock, purge, logs/metrics ops |
| `settings.ts` | auto-proxy, WAN discovery, provision now/cancel |
| `audit.ts` | audit log |

Public: `GET /api/health`.

### Backend — services

| Thư mục / service | Trách nhiệm |
|-------------------|-------------|
| `proxy/ProxyService` | CRUD + điều phối apply |
| `proxy/HubProxyService` | Shard, veth hub, cfg multi-slot, reload SIGUSR1, LAN access |
| `proxy/HubConfigService` | Sinh `3proxy.cfg` + slot IPs |
| `proxy/HubRateLimitService` | Rate limit firewall/3proxy (debounce, LOW_CPU 15s) |
| `proxy/PoolAllocator` | Reallocate egress khi WAN down/IP xấu |
| `mikrotik/MikrotikService` | REST + SSH; **`containerShell`** an toàn (skip nếu container không running) |
| `mikrotik/RouterScriptService` | quayip, duckdns, protect, ssh-blacklist — install/run + **ipChanges/summary** |
| `mikrotik/FirewallReconcileService` | Audit/repair rule hub theo chu kỳ |
| `mikrotik/SshBlacklistService` | Blacklist SSH |
| `auto/WanWatcherService` | Sync PPPoE, IP quality, finalize/reallocate |
| `auto/AutoProvisionOrchestrator` | Workflow discovery → active |
| `wan/*` | Enable PPPoE + auto proxy, create queue, internet probe |
| `metrics/*` | Router resources, WAN/LAN traffic, proxy BPS, rollup, 3proxy admin |
| `realtime/HealthMonitor` | Health check định kỳ |
| `realtime/ProxyPingMonitor` | Ping batch round-robin qua PPPoE |
| `system/RedeployWebuiService` | Upload tar + recreate container |
| `system/ClockSyncService` | NTP / timezone VN |
| `logs/*` | Tail hub logs, top domains |
| `device/DeviceRoutingService` | LAN device → WAN |
| `export/ExportService` | Export proxy formats |
| `auth/AuthService` | Admin argon2 |

### Backend — lib quan trọng

- `config.ts` — toàn bộ env typed (hub, LOW_CPU, health, firewall, auto-proxy…)
- `ipQualityUtils.ts` — `classifyPublicIp`, `isBadWanIp`, `isUsableWanIp`
- `proxyEgressUtils.ts` — resolve egress name
- `queue.ts` — serialize lệnh ghi router
- `hubUtils`, `containerUtils`, `pppoeUtils`, `lanTrafficUtils`, `networkUtils`…

### Frontend desktop (`frontend/src`)

Pages: Dashboard · Proxies · WAN · Devices · Fleet · Audit · Settings · Login.  
Settings: quản lý **router scripts** (ensure all / run từng script, hiển thị summary & IP đổi).  
Stack: Ant Design 6, charts, Zustand, WebSocket hooks.

### Frontend mobile (`frontend-mobile/src`)

Cùng luồng trang + More; HeroUI + Tailwind; serve tại **`/m/`**.

### Setup orchestrator (`setup/`)

```
preflight → network-bootstrap → build → cleanup → upload
  → prerequisites → router → hub-prep → purge → fleet-bootstrap → verify
```

### Docker 3proxy hub

- Mount `3proxy.cfg` + `hub-slot-ips` từ RouterOS
- Entrypoint gán IP `/32` per slot
- Reload config không recreate container

---

## Yêu cầu hệ thống

### Router

- MikroTik **x86_64**, RouterOS **7.4+**
- Package **container**
- Disk trống khuyến nghị **≥ 2 GB** (`disk1`)
- RAM: ~100 MB WebUI + ~10–30 MB / hub shard

### PC deploy (Windows)

- Windows 10/11, **Administrator**
- Docker Desktop + Node.js 20+ (hoặc `setup.bat` tự cài qua winget)

### External (tuỳ chọn)

- Host có Docker + kết nối REST/SSH tới router  
  → `DEPLOY_TARGET=external` + `docker compose up -d`

---

## Cài đặt nhanh (Windows 1-click)

### 1. Clone

```bash
git clone https://github.com/clonethinh/mikrotik-x86-proxy-container.git
cd mikrotik-x86-proxy-container
```

### 2. Config (tuỳ chọn)

```bash
copy setup.config.example.json setup.config.json
# Sửa: router, sshPass, wan/DuckDNS, adminPass, hub.shardCount, maxPppoeOut…
```

### 3. Setup

```powershell
# Run as administrator
.\setup.bat
```

| Lệnh | Ý nghĩa |
|------|---------|
| `npm run setup` | Full setup |
| `setup.bat --wizard-only` | Chỉ wizard |
| `setup.bat --preflight-only` | Kiểm tra môi trường |
| `setup.bat --skip-build` | Bỏ build image |
| `setup.bat --from upload` | Từ step `upload` |

### 4. Trên router

```routeros
/import file=disk1/webuiproxymikrotik/install-all.rsc
```

### 5. Truy cập

- Desktop: `http://<wan-host-or-ip>:8088`
- Mobile: `http://<wan-host-or-ip>:8088/m/`

### Deploy lặp (đã có hệ thống)

```bash
npm run deploy:auto          # SSH hoặc WebUI API + verify + post-deploy bootstrap
# SKIP_POST_DEPLOY=1 để bỏ sync .rsc/scripts
```

`scripts/post-deploy-bootstrap.js`: upload `mikrotik/*.rsc` → `POST /api/system/router-scripts/ensure` → sync-time.

---

## Cấu hình

### `setup.config.example.json`

| Khối | Nội dung |
|------|----------|
| `router` | host, sshUser/Pass, sshPort `22222` |
| `wan` | host public, management PPPoE, DuckDNS |
| `webui` | admin, jwtSecret, port `8088` |
| `network` | WAN/LAN ports, DHCP, bridge, ext port base |
| `proxy.deployMode` | `"hub"` (khuyến nghị) |
| `hub` | `shardSize` (50), `shardCount`, `maxPppoeOut` |
| `threeProxy` | tarball + hub image |
| `setup` | fullSystem, autoProvision, initialProxyCount… |

**Không commit:** `setup.config.json`, `.env`, `router-access.json` (đã `.gitignore`).

### Backend env (rút gọn — xem `backend/.env.example`)

```env
PORT=8088
DEPLOY_TARGET=router                 # router | external
PROXY_DEPLOY_MODE=hub

MIKROTIK_HOST=127.0.0.1              # external: IP router
MIKROTIK_SSH_PORT=22222
MIKROTIK_API_PASS=...
MIKROTIK_SSH_PASS=...
MIKROTIK_WAN_HOST=your.duckdns.org   # URL quản trị

JWT_SECRET=...                       # ≥ 32 ký tự
ADMIN_USERNAME=admin
ADMIN_PASSWORD=...
DATABASE_URL=file:/data/proxy.db

# Scale hub
HUB_SHARD_SIZE=50
HUB_SHARD_COUNT=6
HUB_MAX_PPPOE_OUT=300

# CPU router
# LOW_CPU_MODE=true
# HUB_REQUEST_LOG=false
# METRICS_ENABLED=false
# LOGS_TAIL_ENABLED=false
# HUB_RATE_LIMIT_DEBOUNCE_MS=15000   # auto 15s khi LOW_CPU

# Health / ping
HEALTH_CHECK_INTERVAL_MS=120000
PROXY_PING_ENABLED=true
PROXY_PING_INTERVAL_MS=45000
HEALTH_PING_BATCH_SIZE=6

# Auto proxy
AUTO_PROXY_MODE=semi                 # off | semi | full
AUTO_PROXY_POLL_MS=20000             # LOW_CPU default 30000; deploy scale dùng 15000

# Firewall reconcile
# FIREWALL_RECONCILE_ENABLED=true
# FIREWALL_RECONCILE_INTERVAL_MS=1800000

EXT_HTTP_PORT_BASE=30055
EXT_SOCKS_PORT_BASE=31055
CLOCK_TIMEZONE=Asia/Ho_Chi_Minh
```

### Docker Compose (external)

```bash
docker compose up -d --build
# Port 8088, volume ./data, env MIKROTIK_* từ host
```

---

## WebUI

| Trang | Chức năng |
|-------|-----------|
| **Dashboard** | CPU/Mem/HDD, container count, WAN traffic, LAN talkers, fleet |
| **Proxies** | CRUD, bulk, test, reload-IP, export, rate limit, analytics, logs |
| **WAN** | PPPoE status, create-next, enable (auto proxy), disable, queue, bulk |
| **Devices** | Routing LAN → WAN (IP/MAC/DHCP) |
| **Fleet** | Tổng quan shard / container / proxy |
| **Audit** | Lịch sử thao tác |
| **Settings** | Auto-proxy · **Router scripts** (ensure/run + kết quả chi tiết) · system |
| **Login** | JWT cookie |

Mobile mirror tại `/m/`.

---

## API REST & WebSocket

Base: `http://<host>:8088` — JWT cookie `token` hoặc `Authorization: Bearer`.

### Auth

| Method | Path |
|--------|------|
| POST | `/api/auth/login` |
| POST | `/api/auth/logout` |
| GET | `/api/auth/me` |
| POST | `/api/auth/change-password` |
| POST | `/api/auth/refresh` |

### Proxies

| Method | Path | Mô tả |
|--------|------|--------|
| GET/POST | `/api/proxies` | List / tạo |
| GET/PATCH/DELETE | `/api/proxies/:id` | Chi tiết / sửa / xoá |
| POST | `/api/proxies/:id/start\|stop\|restart` | Điều khiển |
| POST | `/api/proxies/:id/reload-ip` | Quay IP |
| POST | `/api/proxies/:id/test` | Health / exit IP |
| POST | `/api/proxies/:id/reapply` | Re-apply rules |
| POST | `/api/proxies/bulk` | Bulk actions |
| POST | `/api/proxies/export` · `/import` | Xuất / nhập |
| GET | `/api/proxies/:id/metrics/*` | Live / history |
| PATCH | `/api/proxies/:id/limits` | Rate limit & quota |
| GET | `/api/proxies/:id/logs/*` | Requests / domains / tail |

### WAN · Devices · System

| Method | Path | Mô tả |
|--------|------|--------|
| GET | `/api/wan` | PPPoE status |
| GET | `/api/wan/create-queue` | Hàng đợi tạo WAN |
| POST | `/api/wan/create-next` · `/create` | Tạo PPPoE |
| POST | `/api/wan/:idx/enable\|disable` | Bật / tắt |
| POST | `/api/wan/bulk-enable` · `/bulk-disable` | Bulk |
| GET/POST | `/api/devices` | Device routing |
| GET | `/api/dashboard` · `/dashboard/router-monitor` | Dashboard |
| GET/POST | `/api/system/router-scripts` · `/ensure` · `/run/:name` | Scripts RouterOS |
| POST | `/api/system/redeploy-webui` | Redeploy image |
| GET/POST | `/api/system/firewall/reconcile` | Firewall |
| GET/POST | `/api/system/ssh-blacklist*` | SSH protect |
| POST | `/api/mikrotik/sync-time` | Đồng bộ giờ |
| GET | `/api/health` | Public health |

### WebSocket `WS /ws`

| Event | Ý nghĩa |
|-------|---------|
| `proxy.created` / `updated` / `deleted` | CRUD |
| `proxy.status` | start/stop |
| `proxy.reloading` / `proxy.ip-changed` | Quay IP |
| `proxy.health` / `proxy.error` / `proxy.applied` | Health / apply |
| `wan.sync` / `wan.ip-changed` | Đồng bộ PPPoE |

Buffer ~100 events replay khi reconnect.

---

## Mô hình dữ liệu (Prisma)

| Model | Vai trò |
|-------|---------|
| `ProxyUser` | Slot proxy: ports, creds, publicIp, **egressPppoeName**, status, note |
| `ProxyLimit` | Quota / speed / max conn / hours / expires |
| `ProxyTrafficSample` | Sample realtime rx/tx BPS |
| `ProxyTrafficRollup` | Rollup hour/day/week/month |
| `ProxyRequestLog` | Request client → dest |
| `ProxyDomainStats` | Top domain theo ngày |
| `IpHistory` | Lịch sử đổi IP |
| `HealthCheck` | Kết quả test |
| `AuditLog` | Audit thao tác |
| `AdminUser` | Admin (argon2) |
| `Setting` | Key-value |
| `WanStatus` | Snapshot PPPoE |
| `WanDiscovery` | Workflow auto-provision |
| `DeviceRoute` | Routing thiết bị LAN |
| `RouterResourceSample` | CPU/Mem/HDD samples |

DB: `/data/proxy.db` (mount `disk1/data`). Startup tự `prisma db push`.

---

## MikroTik scripts

Thư mục `mikrotik/` — import gói qua `install-all.rsc` hoặc post-deploy bootstrap.

| Script | Chức năng |
|--------|-----------|
| `prerequisites.rsc` | Kiểm tra package/container/disk |
| `ensure-bridge.rsc` | Bridge `containers-veth` |
| `ensure-veth-for-pppoe.rsc` | Veth per PPPoE / hub |
| `ensure-routing.rsc` | Routing mark + tables |
| `ensure-dstnat.rsc` | Publish HTTP/SOCKS |
| `ensure-firewall.rsc` | Accept proxy ranges |
| `ensure-proxy-gateway.rsc` | Gateway trên bridge |
| `ensure-device-routing.rsc` | Mangle device → WAN |
| `ensure-ssh-port.rsc` | SSH port (vd. 22222) |
| `ensure-ssh-blacklist.rsc` | Chống brute-force (+ scheduler) |
| `ensure-mgmt-access.rsc` | Management access |
| `ensure-pool-pppoe.rsc` | Pool PPPoE |
| `ensure-router-scripts.rsc` | Đăng ký script API |
| `protect-pppoe-wan.rsc` | Không disable/xóa WAN quản trị |
| `duckdns-pppoe-wan.rsc` | Cập nhật DuckDNS |
| **`quayip.rsc`** | Quay IP: scheduler **5m**, max **16** lần/phiên, CGNAT+169.254, bỏ qua pppoe-wan |
| `reload-ip-pppoe.rsc` | Reconnect PPPoE helper |
| `deploy-webui.rsc` | Deploy container WebUI |
| `setup-proxy3.rsc` | Setup 3proxy legacy |
| `cleanup-*.rsc` | Dọn orphan / proxy cũ |

**Managed từ WebUI Settings** (RouterScriptService):

1. `quayip` — 5m  
2. `duckdns-pppoe-wan` — 5m  
3. `protect-pppoe-wan` — 2m  
4. `hub-ssh-blacklist` — 1m  

---

## Scripts & automation

### npm (root)

```bash
npm run setup                 # setup.bat full
npm run setup:wizard
npm run setup:preflight
npm run setup:skip-build
npm run build                 # build images (setup step)
npm run build:3proxy-hub
npm run deploy:wan            # deploy-via-rest.js
npm run deploy:auto           # deploy-auto + verify + post-deploy
npm run deploy:bootstrap
npm run cleanup:disk1
npm run cleanup:firewall
npm run restore:webui
```

### Scripts vận hành (`scripts/`)

| Script | Mục đích |
|--------|----------|
| `deploy.sh` / `deploy-auto.js` | Deploy WebUI (SSH / API) |
| **`post-deploy-bootstrap.js`** | Sync `mikrotik/*.rsc` + ensure router-scripts + clock |
| `deploy-via-rest.js` | Deploy qua REST |
| `bootstrap-redeploy-via-rest.js` | Redeploy bootstrap |
| `redeploy-webui-only.js` | Chỉ redeploy WebUI |
| `apply-scale-300.js` | Env hub 6 shard × 50, max 300 PPPoE, LOW_CPU |
| `apply-lan-traffic-rules.js` | Mangle LAN traffic |
| `apply-proxy-rate-limit.js` | Rate limit |
| `apply-ssh-blacklist.js` | SSH blacklist |
| `apply-low-cpu-env.js` | Bật LOW_CPU_MODE |
| `cleanup-disk1.js` / `cleanup-firewall-redundant.js` | Dọn dẹp |
| `enable-proxy-metrics.js` | Bật metrics |
| `diag-cpu-deep*.js` / `load-test-cpu.js` | Chẩn đoán tải |
| `ensure-windows-prereqs.ps1` | Prereq Windows |
| `build-3proxy-hub.sh` | Build hub image |
| `verify-dashboard-live.sh` | Verify dashboard |
| `lib/deploy-config.js` | Config deploy chung (env container) |

Backend: `backend/scripts/*` (audit, cleanup fleet, reset admin password, sync containers…).

---

## Chế độ deploy & scale

### 1) Trên router (mặc định production)

```
DEPLOY_TARGET=router
MIKROTIK_HOST=127.0.0.1   # hoặc 172.17.0.1 từ container webui
PROXY_DEPLOY_MODE=hub
```

### 2) External (VPS / PC)

```
DEPLOY_TARGET=external
MIKROTIK_HOST=<ip-router>
docker compose up -d
```

API contract giữ nguyên 100%.

### 3) Hub vs legacy

| Mode | Mô tả | Khi dùng |
|------|--------|----------|
| **hub** (mặc định) | Vài shard, mỗi shard nhiều slot | 50–300+ PPPoE |
| **legacy** | 1 container 3proxy / 1 WAN | Fleet nhỏ / debug |

### Scale mẫu 300 WAN

```bash
node scripts/apply-scale-300.js
# HUB_SHARD_COUNT=6, HUB_SHARD_SIZE=50, HUB_MAX_PPPOE_OUT=300
# LOW_CPU_MODE=true, poll/cache tối ưu
```

---

## Background services

Chạy khi WebUI container start (`server.ts`):

| Service | Việc làm |
|---------|----------|
| WanWatcher | Poll PPPoE, IP quality, finalize/reallocate, WS events |
| HealthMonitor | Test proxy / exit IP định kỳ |
| ProxyPingMonitor | Ping batch qua interface PPPoE |
| ProxyMetricsCollector + Rollup | BPS + rollup (tắt bớt khi LOW_CPU) |
| RouterResourceCollector | CPU/Mem/HDD |
| RouterTraffic + LanDeviceTraffic | Traffic WAN / LAN |
| LogTailer + TopDomainAggregator | Request log hub (tuỳ env) |
| FirewallReconcile | Repair rule hub theo interval |
| ClockSync | NTP timezone VN |
| Hub bootstrap | Ensure shards, mounts, LAN access, request-log sync |

Router queue (`lib/queue.ts`) serialize lệnh ghi MikroTik — tránh race.

---

## Phát triển local

```bash
# Backend
cd backend && cp .env.example .env && npm install
npx prisma generate && npm run dev     # :8088

# Frontend desktop
cd frontend && npm install && npm run dev

# Frontend mobile
cd frontend-mobile && npm install && npm run dev

# Build dist trước Docker
cd frontend && npm run build
cd ../frontend-mobile && npm run build

# Image RouterOS x86
docker buildx build --platform linux/amd64 -t webuiproxymikrotik:latest --load .
```

CI: GitHub Actions build backend + frontend trên push/PR `main`.

---

## Troubleshooting

| Vấn đề | Hướng xử lý |
|--------|-------------|
| SSH timeout | `ssh -p 22222 admin@host`; kiểm tra `MIKROTIK_SSH_PORT` + blacklist |
| Container không start | Image tar, mount `disk1/data`, bridge, root-dir |
| Proxy sai IP / không ra net | Mangle routing-mark, route `to_pppoeN`, srcnat, PPPoE running |
| IP CGNAT / 169.254 | quayip tự quay; watcher không finalize; kiểm tra Settings → Run quayip |
| WebUI không load | Container running? dstnat/firewall 8088? |
| CPU router cao | `LOW_CPU_MODE=true`, tắt metrics/log, hub mode, giảm poll |
| Deploy mất kết nối | Không disable `pppoe-wan`; deploy qua LAN hoặc REST |
| Settings script lỗi | `post-deploy-bootstrap` / ensure scripts; `.rsc` trên `disk1/webuiproxymikrotik/` |
| Setup Windows fail | Admin + Docker running; `--preflight-only` |
| Mobile blank | Build `frontend-mobile` trước image; URL `/m/` |
| DB schema | Volume `/data` writable; startup `prisma db push` |

Chi tiết RouterOS: [`docs/routeros-commands.md`](docs/routeros-commands.md).

---

## Bảo mật

**Không đẩy GitHub** (`.gitignore`):

- `.env*`, `setup.config.json`, `setup-report.json`
- `router-access.json`, `user-ssh-mikrotik.txt`
- `data/`, `*.db`, `*.tar`, `terminals/`, `tmp/`, `node_modules/`

**Production checklist**

1. Đổi `JWT_SECRET`, `ADMIN_PASSWORD`, mật khẩu MikroTik  
2. SSH port lạ + blacklist bật  
3. Bảo vệ `pppoe-wan` (script protect)  
4. Hạn chế expose 8088 nếu chỉ quản trị nội bộ  
5. Không commit secrets / password fallback trong script deploy cá nhân  

---

## Tài liệu tham khảo

| File | Nội dung |
|------|----------|
| [`docs/architecture.md`](docs/architecture.md) | Layout container, routing chain, trade-offs, WS events |
| [`docs/routeros-commands.md`](docs/routeros-commands.md) | Lệnh RouterOS |
| [`docs/router-access.md`](docs/router-access.md) | Ghi chú access (mẫu) |
| [`backend/.env.example`](backend/.env.example) | Biến môi trường |
| [`setup.config.example.json`](setup.config.example.json) | Config setup đầy đủ |
| [`setup.config.minimal.json`](setup.config.minimal.json) | Config tối thiểu |
| [`for-agents.md`](for-agents.md) | Ghi chú cho agent/dev |
| [`LICENSE`](LICENSE) | MIT |

---

## License

[MIT](LICENSE) © 2025 clonethinh
