# webuiproxymikrotik

[![CI](https://github.com/clonethinh/mikrotik-x86-proxy-container/actions/workflows/ci.yml/badge.svg)](https://github.com/clonethinh/mikrotik-x86-proxy-container/actions/workflows/ci.yml)

**WebUI toàn diện quản lý proxy trên MikroTik RouterOS v7 (Container) + 3proxy.**

> Mỗi PPPoE WAN = 1 proxy riêng (HTTP + SOCKS5) với IP public thật của chính WAN đó.  
> Toàn bộ stack (Backend + Frontend + 3proxy) chạy **trực tiếp trên router** x86_64, không cần VPS.

📦 **GitHub:** https://github.com/clonethinh/mikrotik-x86-proxy-container

```bash
git clone https://github.com/clonethinh/mikrotik-x86-proxy-container.git
cd mikrotik-x86-proxy-container
```

---

## Tính năng nổi bật

- **Proxy per-PPPoE**: Tự động tạo container 3proxy + veth + routing + NAT + dstnat cho từng pppoe-outN
- **Dashboard mạnh**: Router CPU/Mem/HDD realtime, WAN traffic, LAN device traffic, proxy stats
- **LAN Traffic Monitoring**: Ghi nhận byte upload/download theo từng thiết bị LAN, rule mangle idempotent
- **Rate Limiting & Quota**: Giới hạn tốc độ, quota ngày/tuần/tháng, max connections, giờ hoạt động
- **SSH Hardening**: Đổi port SSH (mặc định 22222), SSH blacklist tự động
- **Redeploy & Bootstrap thông minh**: Deploy qua REST (không chỉ SSH), bootstrap network/fleet/duckdns
- **Device Routing**: Gán thiết bị LAN (theo IP/MAC/DHCP) ra WAN cụ thể
- **Auto Provision**: Tự phát hiện pppoe-out mới và tạo proxy
- **Realtime**: WebSocket push proxy status, IP change, health, traffic, audit
- **Export linh hoạt**: 6+ định dạng + template tự do
- **Audit đầy đủ**: Log mọi thao tác (tạo/sửa/xoá/start/stop/reload/test)
- **Windows-first Setup**: `setup.bat` 1-click (tự cài Node/Docker/Python qua winget)

## Kiến trúc tổng quan

```
MikroTik RouterOS (x86_64) + Container
├── bridge containers-veth
├── veth-3p-N  <->  proxy3p-N (3proxy container)
├── webui container (Fastify + React + SQLite)
└── pppoe-outN (WAN) → srcnat → public IP thật
```

Mỗi proxy:
- HTTP nội bộ: 20000 + N
- SOCKS nội bộ: 21000 + N
- External (WAN): 30055 + N (HTTP), 31055 + N (SOCKS)

## Tech Stack

| Thành phần     | Công nghệ |
|----------------|-----------|
| Frontend       | React 18 + TypeScript + Vite + Ant Design 6 + Zustand + @ant-design/plots |
| Backend        | Node.js 22 + Fastify + TypeScript + Prisma + SQLite |
| Realtime       | WebSocket (custom hub + broadcast) |
| Proxy          | ghcr.io/tarampampam/3proxy:2 |
| RouterOS       | v7.4+ (Container + mangle + routing + firewall) |
| Deploy         | Docker multi-stage + setup orchestrator (Windows) |

## Cấu trúc dự án (Tóm tắt)

Xem phần **Chi tiết Codebase** bên dưới để hiểu toàn bộ source code.

## Chi tiết Codebase (Toàn bộ Source Code)

### Backend (`backend/src`) — Fastify + TypeScript + Prisma + SQLite

**Entry Point**
- `server.ts`: Khởi tạo Fastify server, đăng ký plugins (cors, helmet, jwt, cookie, websocket), static serving frontend, bootstrap tất cả background services (HealthMonitor, metrics collectors, WAN watcher, clock sync, log tailer...).

**Routes** (`routes/`)
- `proxies.ts` — CRUD proxy, start/stop, reload-ip, test, bulk actions, export, regenerate credentials, reveal password (audit logged)
- `system.ts` — router resources, system info, redeploy endpoints
- `devices.ts` — device routing (gán thiết bị LAN ra WAN)
- `wan.ts`, `audit.ts`, `auth.ts`, `settings.ts`
- `proxyMetrics.ts`, `proxyLogs.ts`

**Services** (logic chính)

- **proxy/**
  - `ProxyService.ts`: CRUD + điều phối router operations (queue)
  - `HubProxyService.ts`, `HubConfigService.ts`
  - `HubRateLimitService.ts`: rate limit + quota
  - `PoolAllocator.ts`

- **metrics/**
  - `RouterMonitorService.ts` + `RouterResourceCollector.ts`: CPU, Memory, HDD router
  - `LanDeviceTrafficService.ts` + `RouterTrafficService.ts`: Traffic LAN + WAN
  - `DashboardRealtimeService.ts`
  - `ProxyMetricsCollector.ts`, `RollupAggregator.ts`, `LiveBpsTracker.ts`
  - `ThreeProxyAdminClient.ts`

- **mikrotik/**
  - `MikrotikService.ts`: REST API + SSH client chính
  - `RouterScriptService.ts`
  - `SshBlacklistService.ts`

- **auto/**
  - `AutoProvisionOrchestrator.ts`
  - `WanWatcherService.ts`
  - `AutoProxySettings.ts`

- **system/**
  - `RedeployWebuiService.ts`: redeploy qua REST/HTTP
  - `ClockSyncService.ts`

- Khác: `DeviceRoutingService.ts`, `ExportService.ts`, `HealthMonitor.ts`, `Audit`, logs services

**Lib & Shared** (`lib/`)
- `config.ts`: load env + typed config
- `queue.ts`: serialize các lệnh ghi lên router
- `lanTrafficUtils.ts`: hằng số + helper cho mangle LAN traffic
- `mikrotikResourceUtils.ts`
- `validation.ts`, `logger.ts`, `networkUtils.ts`, `proxyLogParser.ts`, `pppoeUtils.ts`, `quayipUtils.ts`, `hubUtils.ts`, `containerUtils.ts`

**Khác**
- `db/prisma.ts`
- `middleware/auth.ts`
- `realtime/hub.ts`
- `ws/handler.ts`
- `types/`

### Frontend (`frontend/src`) — React 18 + TypeScript + Vite + Ant Design

**Pages** (8 trang chính)
- `DashboardPage.tsx`, `ProxiesPage.tsx`, `FleetPage.tsx`
- `DevicesPage.tsx`, `WanPage.tsx`, `AuditPage.tsx`, `SettingsPage.tsx`
- `LoginPage.tsx`

**Components** (tổ chức rõ ràng)
- `dashboard/`: RouterMonitorPanel, DashboardWanTraffic, DashboardFleetHero, DashboardDhcpClients, DashboardConnectionCard...
- `proxies/`: ProxiesDataTable, ProxyDetailPanel, ProxyAnalyticsDrawer, ProxiesPageView...
- `proxy/`: ProxyPageShell, ProxyTrafficChart, ProxyInlineStats...
- `ui/`: MetricCard, AppDrawer, PageHeader, ProxyToolbar, SettingsSectionCard...
- `AppLayout.tsx`, `AppSider.tsx`, `ErrorBoundary.tsx`, `ContainerStatusTag.tsx`

**Hooks** (tách logic)
- `useProxiesPage.ts` — logic chính trang Proxies (rất lớn)
- `useWebSocket.ts` — realtime + auto reconnect
- `usePollInterval.ts`, `useSpeedUnit.ts`
- `useTablePagination.ts`, `useTableViewportHeight.ts`

**State & Communication**
- `services/api.ts`, `auth.ts`, `ws.ts`
- `contexts/PageHeaderActionsContext.tsx`
- Zustand (store đơn giản)

**Lib & Utils**
- `lib/proxiesFormat.ts`, `proxyUtils.ts`, `clipboard.ts`, `env.ts`

**Khác**
- `types/proxies.ts`
- `mocks/` (preview data)
- `styles/`, `theme/proxyTheme.ts`
- `vite.config.ts` + preview configs

### Setup & Deployment Code

- `setup/` — orchestrator + steps (preflight, network-bootstrap, fleet-bootstrap, upload, verify...)
- `scripts/` — nhiều script hỗ trợ (deploy-via-rest, apply-lan-traffic-rules, cleanup-*, bootstrap-redeploy, ensure-windows-prereqs.ps1...)
- `mikrotik/*.rsc` — toàn bộ script idempotent cho RouterOS

### Prisma Models (chính)

ProxyUser, ProxyLimit, ProxyTrafficSample, ProxyTrafficRollup, ProxyRequestLog, ProxyDomainStats, IpHistory, HealthCheck, AuditLog, AdminUser, Setting, WanStatus, DeviceRoute, RouterResourceSample...

---

## Yêu cầu

- **Router**: MikroTik x86_64, RouterOS 7.4+, package `container` đã cài, disk trống ≥ 2GB
- **PC deploy (Windows)**: Windows 10/11, quyền Administrator
- Docker Desktop + Node.js 20+ (setup.bat có thể tự cài qua winget)

## Cài đặt nhanh (Windows)

1. **Clone repo**

2. **Chạy setup (khuyến nghị)**

```powershell
# Chuột phải → Run as administrator
setup.bat
```

- Tự kiểm tra/cài Node, Docker, Python
- Chạy wizard cấu hình (hoặc dùng file `setup.config.json`)
- Build image + upload + chạy `install-all.rsc`

3. **Trên router (sau khi upload)**

```bash
# Import toàn bộ (idempotent)
/import file=disk1/webuiproxymikrotik/install-all.rsc
```

4. **Tạo container webui**

```bash
/container/envlist/add name=ENV_WEBUI key=MIKROTIK_HOST value="127.0.0.1"
/container/envlist/add name=ENV_WEBUI key=MIKROTIK_SSH_PORT value="22222"
/container/envlist/add name=ENV_WEBUI key=MIKROTIK_API_PASS value="yourpass"
/container/envlist/add name=ENV_WEBUI key=MIKROTIK_SSH_PASS value="yourpass"
# ... các key khác (JWT_SECRET, ADMIN_PASSWORD, WAN_IP...)

# Mount data + add container
/container/mounts/add ...
/container/add file=... name=webuiproxymikrotik envlist=ENV_WEBUI ...
/container/start webuiproxymikrotik
```

5. Truy cập: `http://<wan-ip>:8088`

## Cấu hình (backend/.env)

Xem file `backend/.env.example` đầy đủ.

Các biến quan trọng:

- `MIKROTIK_SSH_PORT=22222` (khuyến nghị)
- `DEPLOY_TARGET=router | external`
- `LOW_CPU_MODE=true` (router nhiều proxy)
- Rate limit, quota, auto-proxy settings...

## Các trang WebUI

- **Dashboard**: Router resources (CPU/Mem/HDD), WAN traffic, LAN device traffic, fleet overview
- **Proxies**: CRUD, bulk action, test, reload IP, export, rate limit/quota, traffic chart & analytics
- **WAN**: PPPoE status + IP sync
- **Devices**: Gán thiết bị LAN (IP/MAC/DHCP) ra WAN cụ thể (device routing)
- **Fleet**: Quản lý toàn bộ fleet proxy
- **Audit**: Lịch sử đầy đủ mọi thao tác
- **Settings**: Cấu hình hệ thống

## Tính năng nâng cao

- **Router Monitoring**: Theo dõi CPU, Memory, HDD, số container realtime
- **LAN Traffic**: Mangle + conn-mark để đo upload/download theo từng host LAN
- **Proxy Rate Limit**: Kết hợp limit tốc độ + quota + max conn + time-based
- **SSH Protection**: `ensure-ssh-port.rsc` + `ensure-ssh-blacklist.rsc`
- **Smart Redeploy**: REST API bootstrap + HTTP restore (ít phụ thuộc SSH)
- **Network & DuckDNS Bootstrap**: Tự cấu hình WAN + DuckDNS
- **Fleet Auto Bootstrap**: Tự tạo proxy cho các pppoe-out đang chạy

## Scripts & Automation

**npm scripts (root):**

```bash
npm run setup              # setup.bat
npm run deploy:wan         # deploy-via-rest.js
npm run deploy:auto
npm run deploy:bootstrap
npm run cleanup:disk1
npm run cleanup:firewall
npm run restore:webui
```

**Scripts hữu ích:**

- `scripts/apply-lan-traffic-rules.js`
- `scripts/apply-proxy-rate-limit.js`
- `scripts/apply-ssh-blacklist.js`
- `scripts/bootstrap-redeploy-via-rest.js`
- `scripts/cleanup-*.js`
- `scripts/ensure-windows-prereqs.ps1`

## Phát triển & Build

```bash
# Backend
cd backend
npm install
npm run build
npm run dev

# Frontend
cd frontend
npm install
npm run dev                 # http://localhost:5173
npm run build

# Full Docker (external mode)
docker compose up -d
```

## Tài liệu tham khảo

- `docs/architecture.md`
- `docs/routeros-commands.md`
- `docs/router-access.md` (ví dụ cấu hình thực tế)
- `backend/.env.example`
- `setup.config.example.json`

## Giấy phép

MIT

## MikroTik Scripts (mikrotik/)

Chạy qua `install-all.rsc` hoặc import riêng:

- `ensure-bridge`, `ensure-veth-for-pppoe`
- `ensure-routing`, `ensure-dstnat`, `ensure-firewall`
- `ensure-ssh-port`, `ensure-ssh-blacklist`
- `duckdns-pppoe-wan`
- `cleanup-*`, `reload-ip-pppoe`, v.v.

## Monitoring & Tính năng nâng cao

- **Router Monitor**: CPU, Memory, HDD, số container đang chạy
- **LAN Traffic**: Theo dõi byte + tốc độ theo thiết bị LAN (mangle + conn-mark)
- **Router Traffic**: Traffic tổng theo WAN
- **Proxy Rate Limit**: Tích hợp 3proxy + firewall rules
- **Health + IP History**: Tự động test, lưu lịch sử
- **Redeploy linh hoạt**: REST bootstrap, HTTP restore

## API chính (tóm tắt)

Xem chi tiết trong `backend/src/routes/`.

- `/api/proxies` + bulk + start/stop/reload-ip/test/export
- `/api/devices` (device routing)
- `/api/wan`, `/api/dashboard`, `/api/audit`
- `/api/mikrotik/system`
- WS `/ws` (auth bằng token)

## Troubleshooting

- **SSH port**: Dùng `-p 22222` hoặc cập nhật `MIKROTIK_SSH_PORT`
- **Container lỗi**: Kiểm tra mount `disk1/data`, image, veth bridge
- **pppoe-out1**: Không bao giờ disable/reload/cleanup
- **Setup Windows**: Chạy `setup.bat` với quyền Admin
- Xem thêm `docs/routeros-commands.md`, `docs/architecture.md`

## License

MIT
