# webuiproxymikrotik

[![CI](https://github.com/clonethinh/mikrotik-x86-proxy-container/actions/workflows/ci.yml/badge.svg)](https://github.com/clonethinh/mikrotik-x86-proxy-container/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**WebUI toàn diện quản lý proxy multi-PPPoE trên MikroTik RouterOS v7 (Container) + 3proxy.**

Mỗi PPPoE WAN = 1 proxy riêng (HTTP + SOCKS5) với **IP public thật** của chính WAN đó.  
Toàn bộ stack (Backend + Frontend desktop + Frontend mobile + 3proxy hub) chạy **trực tiếp trên router x86_64** — không bắt buộc VPS.

📦 **GitHub:** https://github.com/clonethinh/mikrotik-x86-proxy-container

```bash
git clone https://github.com/clonethinh/mikrotik-x86-proxy-container.git
cd mikrotik-x86-proxy-container
```

---

## Mục lục

1. [Tính năng nổi bật](#tính-năng-nổi-bật)
2. [Kiến trúc tổng quan](#kiến-trúc-tổng-quan)
3. [Tech stack](#tech-stack)
4. [Cấu trúc dự án](#cấu-trúc-dự-án)
5. [Chi tiết codebase](#chi-tiết-codebase)
6. [Yêu cầu hệ thống](#yêu-cầu-hệ-thống)
7. [Cài đặt nhanh (Windows 1-click)](#cài-đặt-nhanh-windows-1-click)
8. [Cấu hình](#cấu-hình)
9. [WebUI — các trang](#webui--các-trang)
10. [API REST & WebSocket](#api-rest--websocket)
11. [Mô hình dữ liệu (Prisma)](#mô-hình-dữ-liệu-prisma)
12. [MikroTik scripts](#mikrotik-scripts-mikrotik)
13. [Scripts & automation](#scripts--automation)
14. [Chế độ deploy](#chế-độ-deploy)
15. [Phát triển local](#phát-triển-local)
16. [Troubleshooting](#troubleshooting)
17. [Tài liệu tham khảo](#tài-liệu-tham-khảo)
18. [License](#license)

---

## Tính năng nổi bật

| Nhóm | Chi tiết |
|------|----------|
| **Proxy per-PPPoE** | Tự tạo routing + NAT + dstnat + (hub/shard hoặc container riêng) cho từng `pppoe-outN` |
| **Hub mode scale** | Nhiều proxy trên 1–N container 3proxy hub (shard), hỗ trợ hàng chục–trăm PPPoE |
| **Dashboard realtime** | CPU / RAM / HDD router, WAN traffic, LAN device traffic, fleet overview |
| **LAN traffic** | Mangle + conn-mark idempotent — upload/download theo từng host LAN |
| **Rate limit & quota** | Tốc độ up/down, quota ngày/tuần/tháng, max connections, giờ hoạt động, hết hạn |
| **Device routing** | Gán thiết bị LAN (IP / MAC / DHCP hostname) ra đúng WAN |
| **Auto provision** | Phát hiện `pppoe-out` mới → countdown → tạo proxy tự động |
| **WAN queue** | Tạo/bật PPPoE tuần tự (create-next, enable + auto-proxy) |
| **Quality / egress tags** | Gắn nhãn chất lượng IP & egress PPPoE động (hub pool) |
| **SSH hardening** | Đổi port SSH (mặc định `22222`), blacklist tự động |
| **Redeploy thông minh** | Deploy / redeploy WebUI qua REST + HTTP bootstrap (ít phụ thuộc SSH) |
| **Dual UI** | Desktop (Ant Design) + Mobile (`/m/` — HeroUI + Tailwind) |
| **Realtime WS** | Push status, IP change, health, traffic, audit |
| **Export / Import** | Nhiều định dạng + template tự do; bulk credentials |
| **Audit đầy đủ** | Mọi thao tác create/update/delete/start/stop/reload/test/login… |
| **LOW_CPU_MODE** | Giảm poll metrics/logs khi router nhiều proxy |
| **Windows 1-click** | `setup.bat` — winget cài Node/Docker/Python, wizard, build, upload, import |

---

## Kiến trúc tổng quan

```
MikroTik RouterOS v7 (x86_64) + package container
│
├── bridge containers-veth
│   ├── veth-webui     → container webuiproxymikrotik  (Fastify + React + SQLite)
│   ├── veth-3p-hub-*  → container 3proxy-hub shard    (nhiều slot proxy / shard)
│   └── (legacy) veth-3p-N → proxy3p-N                 (1 container / 1 PPPoE)
│
├── pppoe-outN (WAN) ──► mangle mark-routing ──► route table to_pppoeN
│                    ──► srcnat → IP public thật của WAN
│
└── disk1/
    ├── data/proxy.db          (SQLite persistent)
    ├── 3proxy-hub.tar         (image hub)
    └── webuiproxymikrotik.tar (image WebUI)
```

### Luồng traffic 1 proxy

```
Client ──► WAN_IP:30055+N (HTTP) / 31055+N (SOCKS)
              │ dstnat → container 3proxy (internal 20000+N / 21000+N)
              │
Outbound ──► mangle src=veth-ip → routing-mark to_pppoeN
              │ default route via pppoe-outN
              │ srcnat → public IP của pppoe-outN
              ▼
           Internet (exit IP = IP public WAN đó)
```

### Port map (mặc định)

| Vai trò | Công thức | Ví dụ N=1 |
|---------|-----------|-----------|
| HTTP nội bộ | `20000 + N` | 20001 |
| SOCKS nội bộ | `21000 + N` | 21001 |
| HTTP external (WAN) | `30055 + N` | 30056 |
| SOCKS external (WAN) | `31055 + N` | 31056 |
| WebUI | `8088` | `http://<wan-ip>:8088` |
| WebUI mobile | `/m/` | `http://<wan-ip>:8088/m/` |
| SSH router | `22222` (khuyến nghị) | |

### Idempotency

Mọi rule RouterOS dùng **comment marker** (`ctn-pppoe-outN`, `ctn-mangle-…`, `gw-veth-…`…).  
`install-all.rsc` / ensure scripts chạy lại nhiều lần an toàn (find → skip nếu đã có).

---

## Tech stack

| Thành phần | Công nghệ |
|------------|-----------|
| **Frontend desktop** | React 18, TypeScript, Vite 6, Ant Design 6, @ant-design/plots, Zustand |
| **Frontend mobile** | React 19, TypeScript, Vite 6, HeroUI 3, Tailwind CSS 4, Motion, Zustand |
| **Backend** | Node.js 22, Fastify 5, TypeScript, Prisma 5, SQLite, Zod, argon2, ssh2 |
| **Realtime** | WebSocket (`@fastify/websocket` + custom event hub) |
| **Proxy engine** | 3proxy (hub image tùy chỉnh `webuiproxymikrotik/3proxy-hub:2`) |
| **RouterOS** | v7.4+ (Container, mangle, routing, firewall, REST API) |
| **Deploy** | Docker multi-stage, setup orchestrator (Windows), REST redeploy |
| **CI** | GitHub Actions — build backend + frontend |

---

## Cấu trúc dự án

```
webuiproxymikrotik/
├── backend/                 # Fastify API + services + Prisma
│   ├── src/
│   │   ├── server.ts
│   │   ├── routes/          # REST endpoints
│   │   ├── services/        # Business logic
│   │   ├── lib/             # Config, queue, utils
│   │   ├── middleware/      # JWT auth
│   │   ├── realtime/        # WS event hub
│   │   ├── ws/              # WebSocket handler
│   │   └── db/              # Prisma client
│   ├── prisma/schema.prisma
│   └── .env.example
│
├── frontend/                # Desktop SPA (Ant Design) → /
├── frontend-mobile/         # Mobile SPA (HeroUI) → /m/
│
├── docker/
│   └── 3proxy-hub/          # Dockerfile + entrypoint hub multi-slot
│
├── mikrotik/                # *.rsc idempotent (bridge, NAT, firewall, SSH…)
├── setup/                   # 1-click Windows orchestrator + steps
├── scripts/                 # Deploy, cleanup, diag, load-test
├── docs/                    # architecture, RouterOS commands, access notes
│
├── Dockerfile               # Multi-stage WebUI image (linux/amd64)
├── docker-compose.yml       # Chế độ external (chạy ngoài router)
├── setup.bat / setup.ps1    # Entry setup Windows
├── setup.config.example.json
├── package.json             # npm scripts gốc
└── README.md
```

---

## Chi tiết codebase

### Backend (`backend/src`)

**Entry — `server.ts`**
- Fastify + CORS, Helmet, JWT cookie, WebSocket
- Serve dual SPA: desktop `/` + mobile `/m/`
- Bootstrap nền: HealthMonitor, ProxyPing, metrics collectors, LAN/WAN traffic, log tailer, WAN watcher, firewall reconcile, clock sync
- Hub mode: ensure shards, veth, LAN access, request-log sync

**Routes**

| File | Endpoint chính |
|------|----------------|
| `auth.ts` | login, logout, me, change-password, refresh |
| `proxies.ts` | CRUD, start/stop/restart, reload-ip, test, reapply, bulk, export/import, credentials, IP/health history, logs |
| `proxyMetrics.ts` | live metrics, history, limits, uptime |
| `proxyLogs.ts` | request logs, domain stats, tail |
| `wan.ts` | create-queue, create-next, create, enable/disable PPPoE |
| `devices.ts` | device routing CRUD + apply, DHCP leases |
| `system.ts` | dashboard, router-monitor, mikrotik system, redeploy-webui, firewall reconcile, SSH blacklist, router scripts, clock, purge-fleet |
| `settings.ts` | auto-proxy settings, WAN discovery, provision now/cancel |
| `audit.ts` | audit log + action list |

**Services (logic chính)**

| Thư mục | Trách nhiệm |
|---------|-------------|
| `proxy/` | `ProxyService`, `HubProxyService`, `HubConfigService`, `HubRateLimitService`, `PoolAllocator` |
| `metrics/` | Router CPU/Mem/HDD, WAN/LAN traffic, proxy BPS, rollup, 3proxy admin client |
| `mikrotik/` | REST + SSH client, firewall reconcile, router scripts, SSH blacklist |
| `auto/` | Auto provision, WAN watcher, auto-proxy settings |
| `wan/` | Enable PPPoE + auto proxy, create queue, internet probe |
| `device/` | Device routing (IP/MAC/DHCP → WAN) |
| `system/` | Redeploy WebUI, clock sync |
| `logs/` | Log tailer, top-domain aggregator |
| `realtime/` | Health monitor, proxy ping |
| `export/` | Export proxy nhiều format |
| `auth/` | Admin login (argon2) |

**Lib**
- `config.ts` — env typed (hub shard, LOW_CPU_MODE, ports, auto-proxy…)
- `queue.ts` — serialize lệnh ghi router
- `networkUtils`, `pppoeUtils`, `proxyEgressUtils`, `ipQualityUtils`, `lanTrafficUtils`, `hubUtils`, `containerUtils`, `validation`, `logger`…

### Frontend desktop (`frontend/src`)

| Trang | Mô tả |
|-------|--------|
| `DashboardPage` | Router monitor, WAN traffic, LAN devices, fleet hero |
| `ProxiesPage` | Bảng proxy, bulk, detail, analytics, rate limit |
| `WanPage` | PPPoE list, enable/disable, create-next, queue |
| `DevicesPage` | Device routing |
| `FleetPage` | Tổng quan fleet |
| `AuditPage` | Lịch sử thao tác |
| `SettingsPage` | Auto-proxy, system |
| `LoginPage` | Đăng nhập |

Components: `dashboard/*`, `proxies/*`, `proxy/*`, `ui/*`, layout/sider.  
Hooks: `useProxiesPage`, `useWebSocket`, `usePollInterval`, `useSpeedUnit`, pagination/viewport.

### Frontend mobile (`frontend-mobile/src`)

- HeroUI + Tailwind v4, React 19, Motion
- Cùng bộ trang: Dashboard, Proxies, WAN, Devices, Fleet, Audit, Settings, More
- Serve tại **`/m/`** trong container production

### Setup orchestrator (`setup/`)

Pipeline Windows (cần Admin):

```
preflight → network-bootstrap → build → cleanup → upload
  → prerequisites → router → hub-prep → purge → fleet-bootstrap → verify
```

- `setup.config.json` (từ example) — router SSH, WAN/DuckDNS, hub shard, proxy mode
- Wizard CLI nếu chưa có config

### Docker 3proxy hub (`docker/3proxy-hub/`)

- Multi-slot: mount `3proxy.cfg` + `hub-slot-ips` từ RouterOS
- Entrypoint gán IP `/32` per slot trên interface hub
- Reload config không cần recreate container (khi mount/cfg cập nhật)

---

## Yêu cầu hệ thống

### Router

- MikroTik **x86_64**, RouterOS **7.4+**
- Package **container** đã cài
- Disk trống khuyến nghị **≥ 2 GB** (`disk1`)
- RAM: ~100 MB WebUI + ~10 MB/hub shard (hub mode tiết kiệm hơn per-container)

### Máy deploy (Windows)

- Windows 10/11, **Run as Administrator**
- Docker Desktop + Node.js 20+ (hoặc để `setup.bat` tự cài qua winget)
- Python 3 (upload/script phụ trợ)

### Tuỳ chọn external

- Host Linux/Windows có Docker, kết nối REST/SSH tới router  
  → `DEPLOY_TARGET=external` + `docker compose up -d`

---

## Cài đặt nhanh (Windows 1-click)

### 1. Clone

```bash
git clone https://github.com/clonethinh/mikrotik-x86-proxy-container.git
cd mikrotik-x86-proxy-container
```

### 2. Cấu hình (tuỳ chọn trước khi chạy)

```bash
copy setup.config.example.json setup.config.json
# Sửa: router.host, sshPass, wan, DuckDNS, adminPass, hub.shardCount...
```

Hoặc để trống — `setup.bat` mở wizard.

### 3. Chạy setup

```powershell
# Chuột phải → Run as administrator
.\setup.bat
```

Tương đương:

```bash
npm run setup
```

Flags hữu ích:

| Lệnh | Ý nghĩa |
|------|---------|
| `setup.bat --wizard-only` | Chỉ wizard config |
| `setup.bat --preflight-only` | Chỉ kiểm tra môi trường |
| `setup.bat --skip-build` | Bỏ build image (dùng tar sẵn) |
| `setup.bat --from upload` | Chạy từ step `upload` trở đi |

### 4. Trên router (sau upload)

```routeros
/import file=disk1/webuiproxymikrotik/install-all.rsc
```

### 5. Truy cập

- Desktop: `http://<wan-ip-hoặc-lan>:8088`
- Mobile: `http://<wan-ip-hoặc-lan>:8088/m/`
- Default admin: theo `setup.config.json` / env (`ADMIN_USERNAME` / `ADMIN_PASSWORD`)

---

## Cấu hình

### `setup.config.example.json` (deploy)

| Khối | Nội dung |
|------|----------|
| `router` | host, sshUser/Pass, sshPort (22222) |
| `wan` | host public / DuckDNS domain + token, management PPPoE |
| `webui` | admin user/pass, jwtSecret, port 8088 |
| `network` | WAN/LAN ports, bridge, DHCP, PPPoE creds, ext port base |
| `proxy.deployMode` | `"hub"` (khuyến nghị scale) |
| `hub` | `shardSize`, `shardCount`, `maxPppoeOut` |
| `threeProxy` | tarball paths + hub image name |
| `setup` | fullSystem, autoProvision, initialProxyCount… |

**Không commit** `setup.config.json`, `.env`, `router-access.json` (đã có trong `.gitignore`).

### Backend env (`backend/.env.example`)

Biến quan trọng:

```env
PORT=8088
DEPLOY_TARGET=router          # hoặc external
MIKROTIK_HOST=127.0.0.1
MIKROTIK_SSH_PORT=22222
MIKROTIK_API_PASS=...
MIKROTIK_SSH_PASS=...
JWT_SECRET=...                # ≥ 32 ký tự
ADMIN_USERNAME=admin
ADMIN_PASSWORD=...
DATABASE_URL=file:/data/proxy.db

# Scale / CPU
# LOW_CPU_MODE=true
# HUB_REQUEST_LOG=false
# METRICS_ENABLED=false

# Auto proxy pool
AUTO_PROXY_MODE=full
AUTO_PROXY_MAX_CONCURRENT=16

EXT_HTTP_PORT_BASE=30055
EXT_SOCKS_PORT_BASE=31055
```

Copy: `cp backend/.env.example backend/.env` khi dev local.

### Docker Compose (external)

```yaml
# docker-compose.yml — bind 8088, volume ./data, env MIKROTIK_* từ host
docker compose up -d --build
```

---

## WebUI — các trang

| Trang | Chức năng |
|-------|-----------|
| **Dashboard** | CPU/Mem/HDD, container count, WAN traffic, LAN top talkers, fleet summary |
| **Proxies** | CRUD, bulk start/stop/test/reload-ip, export, credentials, rate limit/quota, analytics, request logs |
| **WAN** | Trạng thái PPPoE, create-next, enable (auto proxy), disable, discovery queue |
| **Devices** | Routing thiết bị LAN → WAN (IP/MAC/DHCP) |
| **Fleet** | Tổng quan shard/container/proxy |
| **Audit** | Lịch sử thao tác + filter |
| **Settings** | Auto-proxy, system options |
| **Login** | JWT cookie session |

Mobile mirror đầy đủ luồng chính tại `/m/`.

---

## API REST & WebSocket

Base: `http://<host>:8088` — hầu hết endpoint cần JWT (`Authorization` hoặc cookie `token`).

### Auth

| Method | Path | Mô tả |
|--------|------|--------|
| POST | `/api/auth/login` | Đăng nhập |
| POST | `/api/auth/logout` | Đăng xuất |
| GET | `/api/auth/me` | User hiện tại |
| POST | `/api/auth/change-password` | Đổi mật khẩu |
| POST | `/api/auth/refresh` | Refresh token |

### Proxies

| Method | Path | Mô tả |
|--------|------|--------|
| GET | `/api/proxies` | Danh sách (+ filter) |
| POST | `/api/proxies` | Tạo |
| GET/PATCH/DELETE | `/api/proxies/:id` | Chi tiết / sửa / xoá |
| POST | `/api/proxies/:id/start\|stop\|restart` | Điều khiển |
| POST | `/api/proxies/:id/reload-ip` | Quay IP (reconnect PPPoE) |
| POST | `/api/proxies/:id/test` | Health / exit IP |
| POST | `/api/proxies/:id/reapply` | Re-apply router rules |
| POST | `/api/proxies/bulk` | Bulk actions |
| POST | `/api/proxies/export` | Export |
| POST | `/api/proxies/import` | Import |
| GET | `/api/proxies/:id/metrics/*` | Live / history |
| PATCH | `/api/proxies/:id/limits` | Rate limit & quota |
| GET | `/api/proxies/:id/logs/*` | Request / domains / tail |

### WAN / Devices / System

| Method | Path | Mô tả |
|--------|------|--------|
| GET | `/api/wan` | PPPoE status |
| GET | `/api/wan/create-queue` | Hàng đợi tạo WAN |
| POST | `/api/wan/create-next` | Tạo pppoe-out tiếp theo |
| POST | `/api/wan/:idx/enable\|disable` | Bật/tắt WAN |
| GET/POST | `/api/devices` | Device routing |
| GET | `/api/dashboard` | Dashboard aggregate |
| GET | `/api/dashboard/router-monitor` | CPU/Mem/HDD samples |
| POST | `/api/system/redeploy-webui` | Upload + redeploy image |
| GET/POST | `/api/system/firewall/reconcile` | Đồng bộ firewall |
| GET | `/api/health` | Public health (không auth) |
| GET | `/api/audit` | Audit log |

### WebSocket `WS /ws`

Sự kiện tiêu biểu (buffer replay ~100 events khi reconnect):

| Event | Ý nghĩa |
|-------|---------|
| `proxy.created` / `updated` / `deleted` | CRUD |
| `proxy.status` | start/stop |
| `proxy.reloading` / `proxy.ip-changed` | Quay IP |
| `proxy.health` / `proxy.error` | Health check |
| `proxy.applied` | Apply container/rules xong |
| `wan.sync` | Đồng bộ PPPoE |

---

## Mô hình dữ liệu (Prisma)

| Model | Vai trò |
|-------|---------|
| `ProxyUser` | Proxy slot: ports, creds, publicIp, egress, status, note |
| `ProxyLimit` | Quota / speed / max conn / allowed hours / expires |
| `ProxyTrafficSample` | Sample realtime rx/tx BPS |
| `ProxyTrafficRollup` | Rollup hour/day/week/month |
| `ProxyRequestLog` | Log request client → dest |
| `ProxyDomainStats` | Top domain theo ngày |
| `IpHistory` | Lịch sử đổi IP |
| `HealthCheck` | Kết quả test |
| `AuditLog` | Audit thao tác |
| `AdminUser` | Admin (argon2 hash) |
| `Setting` | Key-value settings |
| `WanStatus` | Snapshot PPPoE |
| `WanDiscovery` | Workflow auto-provision (discovered→active…) |
| `DeviceRoute` | Routing thiết bị LAN |
| `RouterResourceSample` | CPU/Mem/HDD samples |

DB file persistent: `/data/proxy.db` (mount `disk1/data` trên router).

---

## MikroTik scripts (`mikrotik/`)

Chạy gói qua `install-all.rsc` hoặc import từng file:

| Script | Chức năng |
|--------|-----------|
| `prerequisites.rsc` | Kiểm tra package/container/disk |
| `ensure-bridge.rsc` | Bridge `containers-veth` |
| `ensure-veth-for-pppoe.rsc` | Veth per PPPoE / hub |
| `ensure-routing.rsc` | Routing mark + tables |
| `ensure-dstnat.rsc` | Port publish HTTP/SOCKS |
| `ensure-firewall.rsc` | Accept proxy ranges |
| `ensure-proxy-gateway.rsc` | Gateway trên bridge |
| `ensure-device-routing.rsc` | Mangle device → WAN |
| `ensure-ssh-port.rsc` | SSH port (vd. 22222) |
| `ensure-ssh-blacklist.rsc` | Chống brute-force |
| `ensure-mgmt-access.rsc` | Management access |
| `ensure-pool-pppoe.rsc` | Pool PPPoE |
| `ensure-router-scripts.rsc` | Đăng ký script API |
| `protect-pppoe-wan.rsc` | Bảo vệ WAN management |
| `duckdns-pppoe-wan.rsc` | Cập nhật DuckDNS |
| `reload-ip-pppoe.rsc` | Reconnect PPPoE (quay IP) |
| `quayip.rsc` | Helper quay IP |
| `deploy-webui.rsc` | Deploy container WebUI |
| `setup-proxy3.rsc` | Setup 3proxy legacy |
| `cleanup-*.rsc` | Dọn orphan / proxy cũ |

**Lưu ý:** Không disable / cleanup `pppoe-out` dùng cho management WAN khi đang deploy từ xa.

---

## Scripts & automation

### npm (root)

```bash
npm run setup                 # setup.bat full
npm run setup:wizard          # chỉ wizard
npm run setup:preflight       # preflight
npm run setup:skip-build      # skip docker build
npm run build                 # build step (images)
npm run build:3proxy-hub      # build hub image
npm run deploy:wan            # deploy-via-rest.js
npm run deploy:auto           # deploy-auto.js
npm run deploy:bootstrap      # bootstrap redeploy REST
npm run cleanup:disk1
npm run cleanup:firewall
npm run restore:webui         # HTTP restore bootstrap
```

### Scripts vận hành (`scripts/`)

| Script | Mục đích |
|--------|----------|
| `deploy-via-rest.js` | Deploy/update qua REST |
| `bootstrap-redeploy-via-rest.js` | Redeploy WebUI bootstrap |
| `redeploy-webui-only.js` | Chỉ redeploy WebUI |
| `apply-lan-traffic-rules.js` | Áp mangle LAN traffic |
| `apply-proxy-rate-limit.js` | Rate limit proxy |
| `apply-ssh-blacklist.js` | SSH blacklist |
| `apply-low-cpu-env.js` | Bật LOW_CPU_MODE trên env |
| `apply-scale-300.js` | Scale cấu hình lớn |
| `cleanup-disk1.js` / `cleanup-firewall-redundant.js` | Dọn dẹp |
| `enable-proxy-metrics.js` | Bật thu thập metrics |
| `diag-cpu-deep*.js` / `load-test-cpu.js` | Chẩn đoán tải |
| `ensure-windows-prereqs.ps1` | Cài prereq Windows |
| `build-3proxy-hub.sh` | Build image hub |
| `verify-dashboard-live.sh` | Verify dashboard |

Backend cũng có `backend/scripts/*` (audit, cleanup fleet, reset admin password, sync containers…).

---

## Chế độ deploy

### 1) Trên router (mặc định)

```
DEPLOY_TARGET=router
MIKROTIK_HOST=127.0.0.1
```

WebUI chạy trong container MikroTik, nói chuyện REST/SSH localhost → RouterOS.

### 2) External (VPS / PC)

```
DEPLOY_TARGET=external
MIKROTIK_HOST=<ip-router>
docker compose up -d
```

API contract giữ nguyên 100%. Phù hợp khi router CPU/RAM hạn chế.

### 3) Hub vs per-container

| Mode | Mô tả | Khi dùng |
|------|--------|----------|
| **hub** (khuyến nghị) | Vài container shard, mỗi shard nhiều slot IP | Nhiều PPPoE (50–100+) |
| **legacy per-PPPoE** | 1 container 3proxy / 1 WAN | Fleet nhỏ, debug |

Cấu hình hub: `hub.shardCount`, `hub.shardSize`, `hub.maxPppoeOut` trong setup config / env.

---

## Phát triển local

```bash
# Backend
cd backend
cp .env.example .env          # chỉnh MIKROTIK_* nếu test thật
npm install
npx prisma generate
npm run dev                   # ts-node-dev :8088

# Frontend desktop
cd frontend
npm install
npm run dev                   # http://localhost:5173

# Frontend mobile
cd frontend-mobile
npm install
npm run dev

# Build production dist (desktop + mobile) trước Docker
cd frontend && npm run build
cd ../frontend-mobile && npm run build

# Docker image (linux/amd64 cho RouterOS x86)
docker buildx build --platform linux/amd64 -t webuiproxymikrotik:latest --load .
```

CI (GitHub Actions) build backend + frontend trên push/PR `main`.

---

## Troubleshooting

| Vấn đề | Hướng xử lý |
|--------|-------------|
| SSH timeout | Dùng port `22222`: `ssh -p 22222 admin@host`; kiểm tra `MIKROTIK_SSH_PORT` |
| Container không start | Kiểm tra image tar, mount `disk1/data`, bridge `containers-veth`, root-dir trống |
| Proxy không ra net / sai IP | Kiểm tra mangle routing-mark, route table `to_pppoeN`, srcnat, interface PPPoE running |
| WebUI 502 / không load | Container webui running? port 8088 dstnat/firewall? ` /container/print ` |
| CPU router cao | `LOW_CPU_MODE=true`, tắt metrics/log tail, giảm poll; dùng hub mode |
| Deploy mất kết nối | Không disable management WAN (`pppoe-wan` / out1 tuỳ config); deploy qua LAN hoặc REST |
| Setup Windows fail | Chạy Admin; Docker Desktop running; `setup.bat --preflight-only` |
| DB lock / schema | Volume `/data` writable; startup tự `prisma db push` |
| Mobile blank | Build `frontend-mobile` trước image; URL đúng `/m/` |

Xem thêm: [`docs/routeros-commands.md`](docs/routeros-commands.md), [`docs/architecture.md`](docs/architecture.md).

---

## Tài liệu tham khảo

| File | Nội dung |
|------|----------|
| [`docs/architecture.md`](docs/architecture.md) | Layout container, routing chain, trade-offs, resource budget, WS events |
| [`docs/routeros-commands.md`](docs/routeros-commands.md) | Lệnh RouterOS thường dùng |
| [`docs/router-access.md`](docs/router-access.md) | Ghi chú access (mẫu) |
| [`backend/.env.example`](backend/.env.example) | Toàn bộ biến môi trường backend |
| [`setup.config.example.json`](setup.config.example.json) | Config setup đầy đủ |
| [`setup.config.minimal.json`](setup.config.minimal.json) | Config tối thiểu |
| [`for-agents.md`](for-agents.md) | Ghi chú cho agent/dev |

---

## Bảo mật & file không commit

Đã ignore (không đẩy GitHub):

- `.env*`, `setup.config.json`, `setup-report.json`
- `router-access.json`, `user-ssh-mikrotik.txt`
- `data/`, `*.db`, `*.tar`, `terminals/`, `tmp/`, `node_modules/`

**Production checklist:** đổi `JWT_SECRET`, `ADMIN_PASSWORD`, mật khẩu MikroTik; bật SSH port lạ + blacklist; hạn chế expose 8088 nếu chỉ quản trị nội bộ.

---

## License

[MIT](LICENSE) © 2025 clonethinh
