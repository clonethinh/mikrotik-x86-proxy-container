# webuiproxymikrotik

[![CI](https://github.com/clonethinh/mikrotik-x86-proxy-container/actions/workflows/ci.yml/badge.svg)](https://github.com/clonethinh/mikrotik-x86-proxy-container/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![RouterOS](https://img.shields.io/badge/RouterOS-v7.4%2B%20x86__64-red)](https://mikrotik.com)
[![Node](https://img.shields.io/badge/Node.js-22-green)](https://nodejs.org)

**Hệ thống WebUI + API + 3proxy hub quản lý proxy multi-PPPoE trên MikroTik RouterOS v7 Container.**

Mỗi `pppoe-outN` = một proxy (HTTP + SOCKS5) với **IP public thật** của WAN đó.  
Stack chạy **trên router x86_64** (hoặc external VPS). Không bắt buộc máy chủ riêng.

| | |
|--|--|
| **Repo** | https://github.com/clonethinh/mikrotik-x86-proxy-container |
| **WebUI desktop** | `http://<host>:8088/` |
| **WebUI mobile** | `http://<host>:8088/m/` |
| **API health** | `GET /api/health` |
| **WebSocket** | `WS /ws` |
| **License** | MIT |

```bash
git clone https://github.com/clonethinh/mikrotik-x86-proxy-container.git
cd mikrotik-x86-proxy-container
```

---

## Mục lục

1. [Giới thiệu & mục tiêu](#1-giới-thiệu--mục-tiêu)
2. [Tính năng đầy đủ](#2-tính-năng-đầy-đủ)
3. [Kiến trúc hệ thống](#3-kiến-trúc-hệ-thống)
4. [Tech stack](#4-tech-stack)
5. [Cấu trúc thư mục (toàn bộ)](#5-cấu-trúc-thư-mục-toàn-bộ)
6. [Backend chi tiết](#6-backend-chi-tiết)
7. [Frontend desktop](#7-frontend-desktop)
8. [Frontend mobile](#8-frontend-mobile)
9. [3proxy hub](#9-3proxy-hub)
10. [MikroTik scripts](#10-mikrotik-scripts)
11. [Setup Windows 1-click](#11-setup-windows-1-click)
12. [Cấu hình & biến môi trường](#12-cấu-hình--biến-môi-trường)
13. [API REST đầy đủ](#13-api-rest-đầy-đủ)
14. [WebSocket events](#14-websocket-events)
15. [Mô hình dữ liệu Prisma](#15-mô-hình-dữ-liệu-prisma)
16. [Export / Import proxy](#16-export--import-proxy)
17. [Background services & boot sequence](#17-background-services--boot-sequence)
18. [Scripts vận hành](#18-scripts-vận-hành)
19. [Chế độ deploy & scale](#19-chế-độ-deploy--scale)
20. [Phát triển local](#20-phát-triển-local)
21. [Troubleshooting](#21-troubleshooting)
22. [Bảo mật & .gitignore](#22-bảo-mật--gitignore)
23. [Tài liệu & License](#23-tài-liệu--license)

---

## 1. Giới thiệu & mục tiêu

### Bài toán

Nhà mạng / lab có **nhiều đường PPPoE** trên một MikroTik x86. Cần:

- Mỗi đường = 1 proxy outbound với **đúng IP public** của đường đó  
- Quản lý tập trung (CRUD, quay IP, health, traffic, quota)  
- Scale hàng chục–trăm WAN mà không nổ số container  
- Dashboard realtime + mobile  
- Deploy 1-click từ Windows, redeploy code không mất data  

### Giải pháp

| Lớp | Thành phần |
|-----|------------|
| **Data plane** | 3proxy hub shards + RouterOS mangle/NAT/routing per slot |
| **Control plane** | Fastify backend (REST + WS) trong container `webuiproxymikrotik` |
| **UI** | React desktop (Ant Design) + React mobile (HeroUI) |
| **State** | SQLite (`/data/proxy.db`) mount persistent `disk1/data` |
| **Ops** | `setup.bat`, deploy-auto, post-deploy-bootstrap, quayip scheduler |

### Hai chế độ proxy

| Mode | `PROXY_DEPLOY_MODE` | Mô tả |
|------|---------------------|--------|
| **hub** (mặc định) | `hub` | Vài container 3proxy-hub; mỗi shard ~50 slot; scale tới 300 PPPoE |
| **legacy** | `legacy` | 1 container 3proxy / 1 PPPoE (debug / fleet nhỏ) |

---

## 2. Tính năng đầy đủ

### Proxy & networking

- [x] Proxy HTTP + SOCKS5 per PPPoE (ports nội bộ + external dstnat)
- [x] Hub multi-shard (`HUB_SHARD_COUNT` × `HUB_SHARD_SIZE`)
- [x] Egress động (`egressPppoeName`) — pool reallocate khi WAN chết/IP xấu
- [x] IP quality: `public` / `cgnat` / `link_local` / `private` / `missing` / `invalid`
- [x] Chỉ finalize proxy khi `isUsableWanIp` (đồng bộ tiêu chí quayip)
- [x] Hairpin LAN (`LAN_SUBNETS`) truy cập proxy từ mạng nội bộ
- [x] Device routing: IP / MAC / DHCP hostname → WAN cụ thể
- [x] Firewall reconcile định kỳ (audit/repair rule hub)
- [x] Rate limit firewall + 3proxy (debounce; LOW_CPU 15s)
- [x] Quota daily/weekly/monthly, max connections, allowed hours, expires

### WAN lifecycle

- [x] WanWatcher poll PPPoE, broadcast WS
- [x] Auto provision: `off` | `semi` | `full` (countdown → create proxy)
- [x] WanCreateQueue: create-next / create idx (tuần tự)
- [x] Enable WAN + auto apply proxy (background + WS progress)
- [x] Bulk enable / bulk disable
- [x] Internet probe (ping) trước finalize
- [x] quayip.rsc: scheduler 5m, max 16 lần quay/phiên, bỏ qua pppoe-wan

### Monitoring & realtime

- [x] Dashboard: CPU/Mem/HDD, containers, WAN traffic, LAN talkers, fleet hero
- [x] Proxy metrics live + history + rollup hour/day/week/month
- [x] BPS từ PPPoE interface counter (khớp Winbox) và/hoặc 3proxy admin
- [x] Health check + ProxyPing batch round-robin
- [x] Request logs / top domains / live tail (tuỳ env)
- [x] WebSocket push + replay buffer ~100 events

### Ops & security

- [x] Dual SPA desktop + mobile
- [x] JWT cookie auth (admin / viewer roles)
- [x] Audit log mọi thao tác
- [x] SSH port 22222 + blacklist brute-force
- [x] protect-pppoe-wan (không disable WAN quản trị)
- [x] DuckDNS update từ pppoe-wan
- [x] Clock sync NTP Asia/Ho_Chi_Minh
- [x] Redeploy WebUI qua REST (upload tar)
- [x] Self-watchdog: tự `/container/start` nếu webui stop
- [x] LOW_CPU_MODE giảm poll/log/metrics
- [x] Settings UI: ensure/run router scripts + summary + IP changes
- [x] post-deploy-bootstrap: sync `.rsc` + ensure scripts
- [x] Windows 1-click setup orchestrator

---

## 3. Kiến trúc hệ thống

### 3.1 Sơ đồ tổng thể

```
                         ┌─────────────────────────────────────┐
  Clients (Internet/LAN) │  :30055+N HTTP  ·  :31055+N SOCKS   │
                         └──────────────┬──────────────────────┘
                                        │ dstnat
┌───────────────────────────────────────▼───────────────────────────────────────┐
│  MikroTik RouterOS v7 x86_64                                                  │
│  bridge containers-veth                                                       │
│    ├── veth-webui ──► container webuiproxymikrotik                            │
│    │                    Fastify :8088 · React / · React /m/ · SQLite          │
│    │                    REST/SSH → RouterOS · WS clients                      │
│    └── veth-3p-hub-S ──► container 3proxy-hub-S  (S = 0..shardCount-1)      │
│                           multi-slot IPs /32 · 3proxy.cfg mount               │
│                                                                               │
│  pppoe-wan ─────────── WAN quản trị (DuckDNS, SSH, WebUI public)              │
│  pppoe-out1..N ─────── pool proxy WAN                                         │
│       mangle mark-routing → table to_pppoeN → srcnat public IP                │
│                                                                               │
│  disk1/data/proxy.db · disk1/*-hub.tar · disk1/webuiproxymikrotik/*.rsc       │
└───────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Luồng traffic 1 proxy slot N

```
IN:  Client → <public-ip>:30055+N
       dstnat → slot-ip:20000+N (HTTP) / 21000+N (SOCKS) trong hub

OUT: 3proxy request
       mangle prerouting src=slot-ip → routing-mark to_pppoeN (hoặc egress)
       route 0.0.0.0/0 via pppoe-outN
       srcnat to-addresses=<IP public pppoe-outN>
       → Internet với exit IP = WAN đó
```

### 3.3 Port map mặc định

| Vai trò | Công thức | Env |
|---------|-----------|-----|
| HTTP internal | `20000 + N` | `PROXY_HTTP_PORT_BASE` |
| SOCKS internal | `21000 + N` | `PROXY_SOCKS_PORT_BASE` |
| HTTP external | `30055 + N` | `EXT_HTTP_PORT_BASE` |
| SOCKS external | `31055 + N` | `EXT_SOCKS_PORT_BASE` |
| WebUI | `8088` | `PORT` |
| Mobile path | `/m/` | (static) |
| SSH | `22222` | `MIKROTIK_SSH_PORT` |

> Port external bắt đầu **30055** (tránh vùng 30000–30054 dễ lỗi trên một số setup).

### 3.4 Idempotency — comment markers RouterOS

| Comment | Rule |
|---------|------|
| `ctn-mangle-pppoe-outN` | mangle mark-routing |
| `ctn-pppoe-outN` | srcnat |
| `ctn-pppoe-outN-HTTP` / `-SOCKS` | dstnat |
| `gw-veth-3p-N` / hub gw | address trên bridge |
| `bp-veth-3p-N` | bridge port |
| `webuiproxymikrotik-accept-proxy-range` | filter accept |

`find` theo comment → đã có thì skip. Chạy lại `install-all.rsc` an toàn.

### 3.5 IP quality (đồng bộ quayip)

| Quality | Pattern | Usable proxy? |
|---------|---------|---------------|
| `public` | IP public thật | ✅ |
| `cgnat` | `100.64.0.0/10` | ❌ |
| `link_local` | `169.254.0.0/16` | ❌ |
| `private` | RFC1918 (tuỳ flag) | ❌ |
| `missing` / `invalid` | — | ❌ |

Code: `backend/src/lib/ipQualityUtils.ts` — `classifyPublicIp`, `isBadWanIp`, `isUsableWanIp`.  
UI: `IpQualityTag`, `EgressTag` (desktop + mobile).

### 3.6 Trade-offs RouterOS

| Đã chọn | Lý do |
|---------|--------|
| REST cho hầu hết ops | Ổn định container/veth/NAT/mangle |
| SSH cho file/mount/shell/import | REST không cover mount & `/container/shell` |
| Hub multi-slot thay vì 1 ctn/WAN | Disk/RAM/extract time; scale 300 |
| External ports 30055+ | Tránh range broken |
| `containerShell` skip nếu không running | Tránh spam ssh-cmd fail |
| Self-watchdog 60s | PPPoE flap làm container mất net |

### 3.7 Resource budget (tham chiếu)

| Component | RAM | Disk |
|-----------|-----|------|
| WebUI container | ~100 MB | ~50–80 MB image extract |
| 1 hub shard 3proxy | ~10–30 MB | ~100 MB extract |
| 6 shards + webui | ~200–300 MB | ~0.7–1 GB |
| SQLite + logs | tuỳ traffic | mount `disk1/data` |

Hub mode tiết kiệm hơn legacy (legacy: N × 100 MB extract).

---

## 4. Tech stack

| Lớp | Công nghệ |
|-----|-----------|
| Desktop UI | React 18, TS, Vite 6, **Ant Design 6**, @ant-design/plots, Zustand, react-router 7 |
| Mobile UI | React 19, TS, Vite 6, **HeroUI 3**, Tailwind CSS 4, Motion, Zustand |
| Backend | Node 22, **Fastify 5**, TS, Prisma 5, SQLite, Zod, argon2, ssh2, pino |
| Plugins Fastify | cors, helmet, jwt, cookie, websocket, static, rate-limit, multipart |
| Proxy | 3proxy hub image `webuiproxymikrotik/3proxy-hub:2` |
| Router | MikroTik RouterOS 7.4+ Container package |
| Deploy | Docker multi-stage linux/amd64, setup orchestrator, deploy-auto |
| CI | GitHub Actions: `npm ci` + build backend + frontend |

---

## 5. Cấu trúc thư mục (toàn bộ)

```
webuiproxymikrotik/
├── README.md
├── LICENSE
├── package.json                 # npm scripts gốc (setup/deploy)
├── Dockerfile                   # multi-stage WebUI (builder + runtime tini)
├── docker-compose.yml           # external mode
├── .dockerignore / .gitignore / .gitattributes
├── .github/workflows/ci.yml
│
├── backend/
│   ├── package.json
│   ├── tsconfig.json
│   ├── prisma/schema.prisma
│   ├── .env.example
│   ├── src/
│   │   ├── server.ts
│   │   ├── db/prisma.ts
│   │   ├── middleware/auth.ts
│   │   ├── realtime/hub.ts
│   │   ├── ws/handler.ts
│   │   ├── routes/              # 9 files API
│   │   ├── services/            # business logic (35+ files)
│   │   └── lib/                 # config, utils, tests
│   └── scripts/                 # ops một lần (cleanup, audit, reset-admin…)
│
├── frontend/                    # Desktop SPA → public/
│   └── src/{pages,components,hooks,services,lib,theme,types}
│
├── frontend-mobile/             # Mobile SPA → public/mobile/
│   └── src/{pages,components,hooks,services,lib}
│
├── docker/3proxy-hub/
│   ├── Dockerfile
│   ├── hub-entrypoint.sh
│   ├── hub-reload.sh
│   └── hub-admin-fetch.sh
│
├── mikrotik/                    # 22 *.rsc
├── setup/                       # Windows orchestrator
│   ├── orchestrator.js
│   ├── lib/                     # config, ssh, network, env, duckdns…
│   └── steps/                   # preflight → verify (11 steps)
│
├── scripts/                     # deploy, scale, diag, post-deploy
│   └── lib/deploy-config.js
│
├── docs/
│   ├── architecture.md
│   ├── routeros-commands.md
│   ├── router-access.md
│   └── ant-design-frontend-redesign.md
│
├── setup.bat / setup.ps1
├── setup.config.example.json
└── setup.config.minimal.json
```

**Không commit (gitignore):** `.env*`, `setup.config.json`, `router-access.json`, `data/`, `*.db`, `*.tar`, `node_modules/`, `terminals/`, `tmp/`, secrets…

---

## 6. Backend chi tiết

### 6.1 Entry `server.ts`

1. `prisma db push` (sync schema mỗi boot)  
2. `initDb` + seed admin từ env  
3. Fastify: CORS, Helmet, JWT cookie, WebSocket, dual static SPA  
4. Register routes + `/api/health`  
5. Start background services (xem §17)  
6. Hub bootstrap + firewall reconcile (nếu `DEPLOY_TARGET=router` + hub)  
7. Self-watchdog 60s  
8. Graceful shutdown stop monitors  

**Dual SPA:**

| Path | Root |
|------|------|
| `/` | `public/` (desktop dist) |
| `/m/` | `public/mobile/` (mobile dist) |
| fallback GET SPA | index.html tương ứng; `/api/*` → 404 JSON |

### 6.2 Routes (`backend/src/routes/`)

| File | Trách nhiệm |
|------|-------------|
| `auth.ts` | Login/logout/me/password/refresh |
| `proxies.ts` | CRUD + lifecycle + bulk + export/import |
| `proxyMetrics.ts` | Live/history metrics, limits, uptime |
| `proxyLogs.ts` | Requests, domains, tail |
| `wan.ts` | Create queue, enable/disable, bulk |
| `devices.ts` | Device routes + DHCP leases |
| `system.ts` | Dashboard, redeploy, scripts, purge, debug |
| `settings.ts` | Auto-proxy, discovery, provision |
| `audit.ts` | Audit log list + actions |

### 6.3 Services map

```
services/
├── auth/AuthService.ts              # argon2 admin users
├── audit.ts                         # write + WS audit.created
├── proxy/
│   ├── ProxyService.ts              # facade CRUD/apply (hub|legacy)
│   ├── HubProxyService.ts           # shards, apply slot, reload, LAN
│   ├── HubConfigService.ts          # 3proxy.cfg + mounts + slot IPs
│   ├── HubRateLimitService.ts       # speed/quota rules + debounce
│   └── PoolAllocator.ts             # reassign egress on WAN failure
├── mikrotik/
│   ├── MikrotikService.ts           # REST + SSH + containerShell + PPPoE
│   ├── RouterScriptService.ts       # quayip/duckdns/protect/blacklist
│   ├── FirewallReconcileService.ts  # periodic repair hub rules
│   └── SshBlacklistService.ts
├── auto/
│   ├── WanWatcherService.ts         # poll WAN, IP quality, finalize
│   ├── AutoProvisionOrchestrator.ts # discovery workflow states
│   └── AutoProxySettings.ts
├── wan/
│   ├── WanCreateQueue.ts            # sequential create PPPoE
│   ├── WanEnableService.ts          # enable + auto proxy
│   └── WanInternetProbe.ts          # ping before finalize
├── metrics/
│   ├── DashboardRealtimeService.ts
│   ├── RouterMonitorService.ts / RouterResourceCollector.ts
│   ├── RouterTrafficService.ts / LanDeviceTrafficService.ts
│   ├── ProxyMetricsCollector.ts / LiveBpsTracker.ts
│   ├── RollupAggregator.ts / LogMetricsDeriver.ts
│   └── ThreeProxyAdminClient.ts     # admin XML via hub shell
├── logs/LogTailer.ts · TopDomainAggregator.ts
├── realtime/HealthMonitor.ts · ProxyPingMonitor.ts
├── system/ClockSyncService.ts · RedeployWebuiService.ts
├── device/DeviceRoutingService.ts
└── export/ExportService.ts
```

### 6.4 Lib utilities

| File | Vai trò |
|------|---------|
| `config.ts` | Toàn bộ env typed |
| `queue.ts` | Serialize ghi router (`routerQueue`) |
| `ipQualityUtils.ts` | Phân loại IP WAN |
| `proxyEgressUtils.ts` | Resolve egress name |
| `hubUtils.ts` / `hubLimitUtils.ts` | Hub helpers, limits |
| `containerUtils.ts` | Tên container/shard |
| `pppoeUtils.ts` | Pool vs management PPPoE |
| `lanTrafficUtils.ts` | Comment/marker LAN mangle |
| `firewallCommentUtils.ts` | Comment markers firewall |
| `networkUtils.ts` | IP/CIDR helpers |
| `proxyLogParser.ts` | Parse 3proxy logs |
| `quayipUtils.ts` | Parse quayip output |
| `metricsBucketUtils.ts` | Buckets rollup |
| `mikrotikResourceUtils.ts` | Parse resource REST |
| `validation.ts` / `logger.ts` | Zod + pino |

Unit-style tests (chạy ts-node): `*.test.ts` trong lib.

### 6.5 Auth

- JWT trong cookie `token` + Bearer header  
- Roles: `admin` | `viewer`  
- Middleware `app.authenticate`  
- Một số system action: admin only (redeploy, ensure scripts, purge…)  

---

## 7. Frontend desktop

**Path production:** `/`  
**Stack:** React 18 + Ant Design 6 + plots + Zustand  

### Pages

| Page | File | Chức năng |
|------|------|-----------|
| Login | `LoginPage.tsx` | JWT login |
| Dashboard | `DashboardPage.tsx` | Router monitor, WAN traffic, DHCP, fleet, quick actions |
| Proxies | `ProxiesPage.tsx` | Table bulk, detail, analytics, limits, connection drawer |
| WAN | `WanPage.tsx` | PPPoE list, create-next, enable/disable, queue, bulk |
| Devices | `DevicesPage.tsx` | Device routing CRUD + apply |
| Fleet | `FleetPage.tsx` | Overview shards/containers |
| Audit | `AuditPage.tsx` | Lịch sử + filter |
| Settings | `SettingsPage.tsx` | Auto-proxy + **router scripts ensure/run** |

### Components (chính)

```
components/
├── AppLayout.tsx · AppSider.tsx · ErrorBoundary.tsx
├── IpQualityTag.tsx · EgressTag.tsx · ContainerStatusTag.tsx · ProxyEndpoint.tsx
├── dashboard/
│   RouterMonitorPanel · DashboardWanTraffic · DashboardFleetHero
│   DashboardDhcpClients · DashboardHealthCard · DashboardConnectionCard
│   DashboardQuickActions · DashboardHeaderToolbar
├── proxies/
│   ProxiesDataTable · ProxiesPageView · ProxyDetailPanel
│   ProxyAnalyticsDrawer · ProxyConnectionDrawer · ProxyModals
│   ProxyStatusBadge · ProxyAuthCell · ProxyWanCell · ProxyTrafficMini …
├── proxy/
│   ProxyPageShell · ProxyTrafficChart · ProxyInlineStats · ProxyStatsRow
└── ui/
    MetricCard · PageHeader · AppDrawer · ProxyToolbar · SettingsSectionCard …
```

### Hooks / services

- `useProxiesPage` — logic trang Proxies  
- `useWebSocket` — realtime + reconnect  
- `usePollInterval` · `useSpeedUnit` · table pagination/viewport  
- `services/api.ts` · `auth.ts` · `ws.ts`  
- `lib/ipQuality.ts` · `proxyUtils` · `liveMetricsMerge` · `clipboard`  

---

## 8. Frontend mobile

**Path production:** `/m/`  
**Stack:** React 19 + HeroUI 3 + Tailwind 4 + Motion  

### Pages

Dashboard · Proxies · WAN · Devices · Fleet · Audit · Settings · **More** · Login  

### Layout

- `MobileShell` + `BottomNav` + `MobileHeader`  
- `SideNav` / wide tables khi màn rộng (`useWideLayout`)  
- Charts: RingGauge, SparkArea, DualTraffic, HorizontalBar  
- UI kit: GlassCard, MetricTile, DataTable, FilterChip, ConfirmModal…  
- Wide tables: Proxies/Wan/Devices/Fleet/Audit DataTable  

Cùng API/WS backend; basename router `/m`.

---

## 9. 3proxy hub

**Image:** `webuiproxymikrotik/3proxy-hub:2`  
**Build:** `npm run build:3proxy-hub` → `scripts/build-3proxy-hub.sh`  
**Source:** `docker/3proxy-hub/`

| File | Vai trò |
|------|---------|
| `hub-entrypoint.sh` | Gán IP `/32` từ `hub-slot-ips` hoặc `HUB_SLOT_IPS`; exec 3proxy.cfg |
| `hub-reload.sh` | Reload config (SIGUSR1 pattern) |
| `hub-admin-fetch.sh` | Helper fetch admin stats |

Backend sinh:

- `3proxy.cfg` multi-slot (users, ports, maxconn, nscache)  
- Mount từ RouterOS vào container  
- Debounce reload khi apply hàng loạt (`HUB_RELOAD_DEBOUNCE_MS`)  

---

## 10. MikroTik scripts

Thư mục `mikrotik/` — upload `disk1/webuiproxymikrotik/`.

### `install-all.rsc` thứ tự

1. `ensure-bridge`  
2. `ensure-veth-for-pppoe`  
3. `ensure-routing`  
4. `ensure-dstnat`  
5. `ensure-firewall`  
6. `ensure-mgmt-access`  
7. `ensure-router-scripts` (quayip + duckdns + protect)  

### Toàn bộ script

| Script | Mô tả |
|--------|--------|
| `prerequisites.rsc` | Kiểm tra package/container/disk |
| `ensure-bridge.rsc` | Bridge `containers-veth` |
| `ensure-veth-for-pppoe.rsc` | Veth slots / hub |
| `ensure-routing.rsc` | Routing marks + tables |
| `ensure-dstnat.rsc` | Publish HTTP/SOCKS ports |
| `ensure-firewall.rsc` | Accept ranges |
| `ensure-proxy-gateway.rsc` | Gateway IPs trên bridge |
| `ensure-device-routing.rsc` | Mangle device → WAN |
| `ensure-ssh-port.rsc` | Đổi port SSH |
| `ensure-ssh-blacklist.rsc` | Blacklist + scheduler 1m |
| `ensure-mgmt-access.rsc` | Management access rules |
| `ensure-pool-pppoe.rsc` | Isolation pool proxy |
| `ensure-router-scripts.rsc` | Cài script managed |
| `protect-pppoe-wan.rsc` | Chống disable/xóa pppoe-wan · scheduler 2m |
| `duckdns-pppoe-wan.rsc` | Update DuckDNS · 5m |
| **`quayip.rsc`** | Quay IP: **5m**, maxFail **16**, maxPass 60, wait 8s, settle 5s; CGNAT+169.254; exclude pppoe-wan |
| `reload-ip-pppoe.rsc` | Helper reconnect |
| `deploy-webui.rsc` | Add/start container webui |
| `setup-proxy3.rsc` | Legacy per-container setup |
| `cleanup-proxy.rsc` / `cleanup-firewall-orphan.rsc` | Dọn dẹp |

### Managed từ WebUI (RouterScriptService)

| Name | Label | Interval mặc định |
|------|--------|-------------------|
| `quayip` | Quay IP PPPoE | 5m |
| `duckdns-pppoe-wan` | DuckDNS | 5m |
| `protect-pppoe-wan` | Bảo vệ pppoe-wan | 2m |
| `hub-ssh-blacklist` | SSH blacklist | 1m |

API: `GET/POST /api/system/router-scripts*`, `POST .../run/:name`  
Response: `summary`, `outputLines`, `logLines`, `installChanges`, `ipChanges`.

---

## 11. Setup Windows 1-click

### Yêu cầu

- Windows 10/11, **Run as Administrator**  
- Docker Desktop + Node 20+ (hoặc winget qua setup)  

### Pipeline `setup/orchestrator.js`

```
preflight → network-bootstrap → build → cleanup → upload
  → prerequisites → router → hub-prep → purge → fleet-bootstrap → verify
```

| Step | File | Việc |
|------|------|------|
| preflight | `steps/preflight.js` | Node/Docker/Python/SSH |
| network-bootstrap | `network-bootstrap.js` | WAN/LAN/DHCP/PPPoE nếu `network.configure` |
| build | `build.js` | Build frontend(s) + docker image tar |
| cleanup | `cleanup.js` | Dọn disk1 (tuỳ options) |
| upload | `upload.js` | SCP tar + rsc |
| prerequisites | `prerequisites.js` | Router ready |
| router | `router.js` | import install-all, env, container |
| hub-prep | `hub-prep.js` | Hub image/mounts |
| purge | `purge.js` | Purge DB nếu fresh |
| fleet-bootstrap | `fleet-bootstrap.js` | Auto provision proxies running WAN |
| verify | `verify.js` | Health/dashboard check |

### Lệnh

```powershell
.\setup.bat
.\setup.bat --wizard-only
.\setup.bat --preflight-only
.\setup.bat --skip-build
.\setup.bat --from upload
npm run setup
```

### Config

Copy `setup.config.example.json` → `setup.config.json` (không commit).

Các khối: `router`, `wan`, `webui`, `network`, `proxy`, `hub`, `threeProxy`, `mode`, `options`, `setup`.

---

## 12. Cấu hình & biến môi trường

### 12.1 `backend/.env.example` + `config.ts` (đầy đủ nhóm)

#### Server / auth / DB

| Biến | Mặc định | Ý nghĩa |
|------|----------|---------|
| `NODE_ENV` | production | |
| `PORT` | 8088 | |
| `HOST` | 0.0.0.0 | |
| `LOG_LEVEL` | info / warn nếu LOW_CPU | |
| `JWT_SECRET` | (required prod) | ≥ 32 chars |
| `ADMIN_USERNAME` | admin | |
| `ADMIN_PASSWORD` | changeme123 | |
| `DATABASE_URL` | file:/data/proxy.db | |
| `DATA_DIR` | /data | |
| `DISK1_DIR` | disk1 | |

#### Deploy / MikroTik

| Biến | Mặc định | Ý nghĩa |
|------|----------|---------|
| `DEPLOY_TARGET` | router | `router` \| `external` |
| `MIKROTIK_HOST` | 127.0.0.1 | |
| `MIKROTIK_API_USER/PASS` | admin / … | REST |
| `MIKROTIK_REST_PORT` | 80 | |
| `MIKROTIK_REST_SCHEME` | http | |
| `MIKROTIK_SSH_PORT` | 22222 | |
| `MIKROTIK_SSH_USER/PASS` | admin / … | |
| `MIKROTIK_WAN_IP` | — | deprecated IP tĩnh |
| `MIKROTIK_WAN_HOST` | — | host quản trị (DuckDNS) |
| `MIKROTIK_REST_CACHE_MS` | 0 / 8000 LOW_CPU | Cache REST |

#### 3proxy / network ports

| Biến | Mặc định |
|------|----------|
| `THREEPROXY_IMAGE` | ghcr.io/tarampampam/3proxy:2 |
| `THREEPROXY_TARBALL` | disk1/3proxy.tar |
| `THREEPROXY_HUB_IMAGE` | webuiproxymikrotik/3proxy-hub:2 |
| `THREEPROXY_HUB_TARBALL` | disk1/3proxy-hub.tar |
| `PROXY_HTTP_PORT_BASE` | 20000 |
| `PROXY_SOCKS_PORT_BASE` | 21000 |
| `EXT_HTTP_PORT_BASE` | 30055 |
| `EXT_SOCKS_PORT_BASE` | 31055 |
| `VETH_NETWORK_BASE` | 172.18 |
| `BRIDGE_NAME` | containers-veth |
| `LAN_SUBNETS` | 192.168.88.0/24,192.168.39.0/24 |
| `LAN_INTERFACES` | ether1,ether2 |
| `CONTAINER_CIDR` | 172.16.0.0/12 |

#### Hub scale

| Biến | Mặc định |
|------|----------|
| `PROXY_DEPLOY_MODE` | hub |
| `HUB_SHARD_SIZE` | 50 |
| `HUB_SHARD_COUNT` | 6 |
| `HUB_MAX_PPPOE_OUT` | 300 |
| `HUB_MAXCONN_MIN` | 512 |
| `HUB_MAXCONN_PER_SLOT` | 64 |
| `HUB_NSCACHE` | 65536 / 8192 LOW_CPU |
| `HUB_FAST_IP_PEEK_MS` | 0 |
| `HUB_RELOAD_DEBOUNCE_MS` | 2500 |
| `HUB_APPLY_FLUSH_MS` | 600 |
| `HUB_REPAIR_ALL_ON_APPLY` | false |
| `HUB_RATE_LIMIT_ON_APPLY` | true |
| `HUB_RATE_LIMIT_DEBOUNCE_MS` | 2500 / **15000** LOW_CPU |

#### LOW_CPU / logs / metrics

| Biến | Khi LOW_CPU |
|------|-------------|
| `LOW_CPU_MODE=true` | bật gói tối ưu |
| `HUB_REQUEST_LOG` | default off (bật = true) |
| `LOGS_TAIL_ENABLED` | default off |
| `METRICS_ENABLED` | default off |
| `CONTAINER_LOGGING` | false |
| `LOG_LEVEL` | warn |

#### Health / ping / WAN probe

| Biến | Mặc định |
|------|----------|
| `HEALTH_CHECK_INTERVAL_MS` | 90000 / 120000 LOW_CPU |
| `HEALTH_CHECK_TIMEOUT_MS` | 30000 |
| `HEALTH_SKIP_WAN_SYNC` | true (tránh double poll) |
| `PROXY_PING_ENABLED` | true |
| `PROXY_PING_INTERVAL_MS` | 30000 / 45000 LOW_CPU |
| `HEALTH_PING_BATCH_SIZE` | 6 |
| `WAN_PING_ON_IP` | true |
| `WAN_PING_TARGET` | 1.1.1.1 |

#### Auto proxy

| Biến | Mặc định |
|------|----------|
| `AUTO_PROXY_MODE` | semi (`off`\|`semi`\|`full`) |
| `AUTO_PROXY_POLL_MS` | 20000 / 30000 LOW_CPU (deploy scale: 15000) |
| `AUTO_PROXY_COUNTDOWN_MS` | 8000 |
| `AUTO_PROXY_MAX_CONCURRENT` | 16 |
| `AUTO_PROXY_STALE_TTL_MS` | 120000 |

#### Firewall reconcile / SSH blacklist / clock

| Biến | Ghi chú |
|------|---------|
| `FIREWALL_RECONCILE_ENABLED` | LOW_CPU: opt-in true |
| `FIREWALL_RECONCILE_INTERVAL_MS` | 900000 / 1800000 |
| `FIREWALL_RECONCILE_MAX_SLOTS` | 15 |
| `SSH_BLACKLIST_ENABLED` | true |
| `SSH_BLACKLIST_MAX_FAILURES` | 5 |
| `CLOCK_TIMEZONE` | Asia/Ho_Chi_Minh |
| `CLOCK_NTP_SERVERS` | vn.pool.ntp.org,… |
| `ENABLE_REALTIME` | true |
| `WS_PATH` | /ws |
| `TELEGRAM_BOT_TOKEN/CHAT_ID` | optional alert |

### 12.2 Docker Compose external

```yaml
# docker-compose.yml
# ports 8088, volume ./data, env MIKROTIK_* + JWT + ADMIN
docker compose up -d --build
```

---

## 13. API REST đầy đủ

Base: `http://<host>:8088`  
Auth: cookie `token` hoặc `Authorization: Bearer <jwt>` (trừ login + health).

### Auth

| Method | Path | Mô tả |
|--------|------|--------|
| POST | `/api/auth/login` | `{username,password}` → token |
| POST | `/api/auth/logout` | |
| GET | `/api/auth/me` | User hiện tại |
| POST | `/api/auth/change-password` | |
| POST | `/api/auth/refresh` | |

### Proxies

| Method | Path | Mô tả |
|--------|------|--------|
| GET | `/api/proxies` | List (+ query filter) |
| POST | `/api/proxies` | Tạo |
| GET | `/api/proxies/:id` | Chi tiết |
| PATCH | `/api/proxies/:id` | Cập nhật |
| DELETE | `/api/proxies/:id` | Xoá |
| GET | `/api/proxies/:id/password` | Reveal password (audit) |
| POST | `/api/proxies/:id/start` | |
| POST | `/api/proxies/:id/stop` | |
| POST | `/api/proxies/:id/restart` | |
| POST | `/api/proxies/:id/reload-ip` | Quay IP PPPoE |
| POST | `/api/proxies/:id/test` | Health / exit IP |
| POST | `/api/proxies/:id/reapply` | Re-apply router rules |
| GET | `/api/proxies/:id/ip-history` | |
| GET | `/api/proxies/:id/health-history` | |
| GET | `/api/proxies/:id/logs` | |
| POST | `/api/proxies/bulk` | Bulk actions |
| POST | `/api/proxies/bulk-update-credentials` | |
| POST | `/api/proxies/regenerate-credentials` | |
| POST | `/api/proxies/export` | Export formats |
| POST | `/api/proxies/import` | Import |

### Metrics & limits & logs

| Method | Path |
|--------|------|
| GET | `/api/proxies/metrics/live-all` |
| GET | `/api/proxies/:id/metrics/live` |
| GET | `/api/proxies/:id/metrics/history` |
| GET | `/api/proxies/:id/uptime` |
| GET/PATCH | `/api/proxies/:id/limits` |
| GET | `/api/proxies/:id/logs/requests` |
| GET | `/api/proxies/:id/logs/domains` |
| GET | `/api/proxies/:id/logs/tail` |

### WAN

| Method | Path | Mô tả |
|--------|------|--------|
| GET | `/api/wan` | PPPoE status (cũng có trong system) |
| GET | `/api/wan/create-queue` | Queue status |
| POST | `/api/wan/create-next` | Tạo out tiếp theo `{enable,createProxy}` |
| POST | `/api/wan/create` | Tạo idx chỉ định |
| POST | `/api/wan/:idx/enable` | Bật + auto proxy (async WS) |
| POST | `/api/wan/:idx/disable` | Tắt (không xoá proxy) |
| POST | `/api/wan/bulk-enable` | |
| POST | `/api/wan/bulk-disable` | |
| GET | `/api/wan/discovery` | Discovery states |
| POST | `/api/wan/:idx/provision/now` | |
| POST | `/api/wan/:idx/provision/cancel` | |

### Devices

| Method | Path |
|--------|------|
| GET | `/api/devices` |
| GET | `/api/devices/dhcp-leases` |
| GET/POST | `/api/devices` · `/:id` |
| PATCH/DELETE | `/api/devices/:id` |
| POST | `/api/devices/:id/apply` |

### System / dashboard / ops

| Method | Path | Mô tả |
|--------|------|--------|
| GET | `/api/health` | **Public** ok/uptime/clients |
| GET | `/api/dashboard` | Aggregate dashboard |
| GET | `/api/dashboard/router-monitor` | CPU/Mem samples |
| GET | `/api/mikrotik/system` | Router identity/resource |
| GET | `/api/deploy-info` | Deploy metadata |
| POST | `/api/mikrotik/test` | Test REST/SSH |
| GET | `/api/system/clock` | |
| POST | `/api/mikrotik/sync-time` | NTP sync |
| GET/POST | `/api/system/firewall/reconcile` | |
| GET/POST | `/api/system/ssh-blacklist` · `/ensure` | |
| GET | `/api/system/router-scripts` | Status list |
| POST | `/api/system/router-scripts/ensure` | Import/update all |
| POST | `/api/system/router-scripts/run/:name` | Run script |
| POST | `/api/system/redeploy-webui` | Body: image tar stream |
| POST | `/api/system/purge-fleet` | Xoá fleet proxies |
| POST | `/api/system/purge-wan-state` | Clear discovery/wan state |
| POST | `/api/system/logs/tail` · `/aggregate` | Manual trigger |
| POST | `/api/system/metrics/rollup` | |
| GET | `/api/debug/network` | Debug routes/IPs |

### Settings & audit

| Method | Path |
|--------|------|
| GET/PATCH | `/api/settings/auto-proxy` |
| GET | `/api/audit` |
| GET | `/api/audit/actions` |

---

## 14. WebSocket events

**Endpoint:** `WS /ws` (auth token query/header theo handler)  
**Replay:** ~100 events khi reconnect  
**Ping:** client `ping` → server `pong`

### Proxy

| Event | Khi nào |
|-------|---------|
| `proxy.created` / `updated` / `deleted` | CRUD |
| `proxy.status` | start/stop/pending |
| `proxy.reloading` / `proxy.ip-changed` | reload-ip |
| `proxy.health` / `proxy.error` / `proxy.applied` | health / apply |
| `proxy.metrics` | live BPS push |

### WAN / provision

| Event | Khi nào |
|-------|---------|
| `wan.sync` | Sync list PPPoE |
| `wan.poll` | Mỗi tick watcher |
| `wan.discovered` / `wan.gone` / `wan.stale` | Lifecycle |
| `wan.ip-changed` | IP interface đổi |
| `wan.internet-pending` / `wan.internet-up` | Probe |
| `wan.action` | enable/disable progress |
| `wan.bulk` | bulk enable/disable |
| `wan.create.queue` / `.queued` / `.processing` / `.done` / `.error` | Create queue |
| `wan.created` | PPPoE tạo xong |
| `wan.provision.*` | countdown/start/done/error/cancel/queued/warn |
| `wan.purged` | purge-wan-state |

### Device / fleet / audit

| Event | Khi nào |
|-------|---------|
| `device.created` / `updated` / `deleted` / `applied` / `error` | Device routing |
| `fleet.purged` | purge-fleet |
| `audit.created` | Mọi audit write |

---

## 15. Mô hình dữ liệu Prisma

File: `backend/prisma/schema.prisma` · DB SQLite.

| Model | Fields chính | Quan hệ |
|-------|--------------|---------|
| **ProxyUser** | pppoeIdx, pppoeName, **egressPppoeName**, veth*, ports, containerName, username/password, publicIp, note, enabled, status, statusMessage, lastCheck* | 1-n history/health/traffic/logs; 1-1 limit |
| **ProxyLimit** | quota*Mb, speed*Kbps, maxConnections, allowedHours JSON, expiresAt | → ProxyUser |
| **ProxyTrafficSample** | ts, rx/tx Bytes+Bps, clients | |
| **ProxyTrafficRollup** | period hour\|day\|week\|month, bucket, bytes, requests, errors | unique(proxy,period,bucket) |
| **ProxyRequestLog** | clientIp, destHost/Port, bytes, errorCode, duration | |
| **ProxyDomainStats** | daily bucket, domain, hits, bytes | |
| **IpHistory** | old/new IP, source | |
| **HealthCheck** | ok, latencyMs, exitIp, error | |
| **AuditLog** | username, action, resource, details JSON, ip | |
| **AdminUser** | username, passwordHash, role admin\|viewer | |
| **Setting** | key-value | |
| **WanStatus** | pppoeName, isUp, publicIp, uptime, rx/tx | |
| **WanDiscovery** | workflowState: discovered→countdown→provisioning→active\|queued\|stale\|gone\|error\|skipped | |
| **DeviceRoute** | matchType ip\|mac\|dhcp, pppoe*, applied | |
| **RouterResourceSample** | cpu, mem, hdd, uptime, container counts | |

Startup: `prisma db push --accept-data-loss` (idempotent schema sync).

---

## 16. Export / Import proxy

### Formats (`ExportService`)

| Format | Ví dụ dòng |
|--------|------------|
| `ipportuserpass` | `1.2.3.4:30056:user:pass` |
| `userpassipport` | `user:pass@1.2.3.4:30056` |
| `httpurl` | `http://user:pass@1.2.3.4:30056` |
| `socks5url` | `socks5://user:pass@1.2.3.4:31056` |
| `ipport` | `1.2.3.4:30056` |
| `template` | Custom `{scheme}://{user}:{pass}@{ip}:{port}` |

File download: `txt` | `csv` | `json`  
Option `includeSocks` để xuất thêm dòng SOCKS.

---

## 17. Background services & boot sequence

Chỉ khi process start (và `DEPLOY_TARGET=router` cho nhóm router-specific):

```
listen :8088
  ├─ startHealthMonitor
  ├─ startProxyPingMonitor
  ├─ startProxyMetricsCollector
  ├─ startRouterResourceCollector
  ├─ startRouterTrafficCollector
  ├─ startLanDeviceTrafficCollector
  ├─ startRollupAggregator
  ├─ startLogTailer
  ├─ startTopDomainAggregator
  ├─ startClockSyncOnBoot
  └─ [router]
       ├─ startWanWatcher
       ├─ router-scripts ensureInstalled
       ├─ sshBlacklist ensure
       ├─ ensurePoolPppoeIsolation
       ├─ deviceRouting repairAll
       ├─ [hub] ensure mounts × shardCount
       ├─ [hub] ensureAllHubShards + warm cache + LAN access
       ├─ [hub] sync request-log cfg + reload shards
       ├─ [hub] startFirewallReconcile
       └─ self-watchdog interval 60s
```

**Self-watchdog:** nếu container `webuiproxymikrotik` stopped/failed và `routerQueue` rỗng → SSH `/container/start`.  
Tránh restart khi đang apply proxy (queue > 0).

**Router queue:** mọi thao tác ghi MikroTik đi qua `routerQueue` — serial, giảm race/CPU spike.

---

## 18. Scripts vận hành

### npm root

| Script | Lệnh |
|--------|------|
| `npm run setup` | setup.bat full |
| `npm run setup:wizard` | wizard only |
| `npm run setup:preflight` | preflight |
| `npm run setup:skip-build` | skip docker build |
| `npm run build` | setup/steps/build.js |
| `npm run build:3proxy-hub` | build hub image |
| `npm run deploy:wan` | deploy-via-rest |
| `npm run deploy:auto` | deploy-auto + verify + **post-deploy** |
| `npm run deploy:bootstrap` | bootstrap redeploy REST |
| `npm run cleanup:disk1` | |
| `npm run cleanup:firewall` | |
| `npm run restore:webui` | HTTP restore bootstrap |

### `scripts/` quan trọng

| Script | Mục đích |
|--------|----------|
| `deploy.sh` | SSH pipeline recreate container + env scale |
| `deploy-auto.js` | Auto: SSH hoặc WebUI API hoặc REST tunnel |
| **`post-deploy-bootstrap.js`** | Upload all `mikrotik/*.rsc` + ensure scripts + sync-time (`SKIP_POST_DEPLOY=1` để bỏ) |
| `deploy-via-rest.js` | REST-only deploy |
| `redeploy-webui-only.js` | Chỉ WebUI |
| `bootstrap-redeploy-via-rest.js` | Bootstrap path |
| `restore-webui-bootstrap-http.js` | Restore HTTP |
| `apply-scale-300.js` | 6×50 hub, max 300, LOW_CPU env |
| `apply-low-cpu-env.js` | Bật LOW_CPU trên container |
| `apply-lan-traffic-rules.js` | Mangle LAN |
| `apply-proxy-rate-limit.js` | Rate limits |
| `apply-ssh-blacklist.js` | SSH BL |
| `cleanup-disk1.js` · `cleanup-firewall-redundant.js` · `cleanup-rate-limit-filters.js` | Cleanup |
| `enable-proxy-metrics.js` | Bật metrics |
| `diag-cpu-deep*.js` · `load-test-cpu.js` · `probe-*.js` | Diagnose |
| `build-3proxy-hub.sh` | Build hub |
| `verify-dashboard-live.sh` | Smoke dashboard |
| `ensure-windows-prereqs.ps1` | Winget deps |
| `lib/deploy-config.js` | Shared host/pass/env builder |

### `backend/scripts/` (một lần / repair)

audit-firewall, cleanup-fleet/orphans/nat, deploy-full, fix-db-*, purge-*, reset-admin-password, repair-*, sync-containers, test-all-proxies, upload-db, v.v.

---

## 19. Chế độ deploy & scale

### A. Production trên router

```
DEPLOY_TARGET=router
MIKROTIK_HOST=172.17.0.1   # từ webui container → bridge
PROXY_DEPLOY_MODE=hub
```

### B. External VPS/PC

```
DEPLOY_TARGET=external
MIKROTIK_HOST=<router-ip>
docker compose up -d
```

API/UI contract **giống 100%**.

### C. Scale 300 WAN

```bash
node scripts/apply-scale-300.js
# HUB_SHARD_COUNT=6 HUB_SHARD_SIZE=50 HUB_MAX_PPPOE_OUT=300
# LOW_CPU_MODE=true, AUTO_PROXY_POLL_MS=15000, REST_CACHE=10000, rate-limit debounce 15s
```

### D. Redeploy code (giữ DB)

```bash
npm run deploy:auto
# 1) build/upload tar (hoặc dùng tar sẵn)
# 2) recreate container, mount /data giữ proxy.db
# 3) verify dashboard
# 4) post-deploy-bootstrap (rsc + scripts)
```

### E. Fresh setup router mới

```powershell
.\setup.bat   # fullSystem + fleet bootstrap
```

---

## 20. Phát triển local

```bash
# Backend
cd backend
cp .env.example .env   # chỉnh MIKROTIK_* nếu test router thật
npm install
npx prisma generate
npm run dev            # ts-node-dev :8088

# Desktop
cd frontend && npm install && npm run dev

# Mobile
cd frontend-mobile && npm install && npm run dev

# Unit-ish lib tests
cd backend && npx ts-node src/lib/ipQualityUtils.test.ts
npx ts-node src/lib/networkUtils.test.ts
# ... metricsBucket, proxyEgress, proxyLogParser

# Production dists (bắt buộc trước docker build)
cd frontend && npm run build
cd ../frontend-mobile && npm run build

# Image amd64 cho RouterOS
docker buildx build --platform linux/amd64 -t webuiproxymikrotik:latest --load .
```

**Dockerfile highlights:**

- Stage builder: npm ci, prisma generate, tsc, prune, copy frontend dist + mobile dist  
- Runtime: tini, entrypoint thêm route `172.16.0.0/12` via bridge để webui reach hub subnets  
- USER root entrypoint → drop to node cho app  
- VOLUME `/data`, EXPOSE 8088  

**CI:** `.github/workflows/ci.yml` — Node 20, build backend + frontend on push/PR `main`.

---

## 21. Troubleshooting

| Triệu chứng | Nguyên nhân / xử lý |
|-------------|---------------------|
| SSH timeout | Port 22222? Blacklist? `MIKROTIK_SSH_PORT` |
| Container không start | tar image, root-dir, mount data, bridge |
| Proxy không ra net | mangle mark, route table, srcnat, PPPoE running |
| Exit IP sai / CGNAT | quayip Settings → Run; watcher không finalize IP xấu |
| 169.254 trên WAN | quayip maxFail 16; kiểm tra line PPPoE |
| WebUI 502 / blank | container status; dstnat 8088; self-watchdog log |
| Mobile blank | chưa build mobile vào image; URL phải `/m/` |
| CPU cao | `LOW_CPU_MODE=true`; tắt metrics/logs; tăng poll; hub |
| Deploy mất remote | không disable pppoe-wan; protect script; deploy LAN |
| Script ensure fail | post-deploy-bootstrap; file trên disk1/webuiproxymikrotik/ |
| DB lỗi schema | `/data` writable; xem log prisma db push |
| containerShell empty | hub không running — skip an toàn |
| Rate limit chậm apply | debounce 15s LOW_CPU — đợi hoặc tắt LOW_CPU |
| Setup Windows fail | Admin + Docker running + preflight |

RouterOS cheat sheet: [`docs/routeros-commands.md`](docs/routeros-commands.md).

---

## 22. Bảo mật & .gitignore

### Không bao giờ commit

```
.env*  setup.config.json  setup-report.json
router-access.json  user-ssh-mikrotik.txt
data/  *.db  *.tar  node_modules/  terminals/  tmp/
backend/public/  (build artifact)
```

### Checklist production

1. Đổi `JWT_SECRET`, `ADMIN_PASSWORD`, mật khẩu MikroTik  
2. SSH non-default + blacklist  
3. Giữ `protect-pppoe-wan`  
4. Hạn chế expose 8088 (firewall / chỉ VPN-LAN)  
5. Không hardcode password trong script deploy public  
6. Review audit log định kỳ  

---

## 23. Tài liệu & License

| File | Nội dung |
|------|----------|
| [`docs/architecture.md`](docs/architecture.md) | Layout, routing chain, trade-offs, resource, WS (legacy notes) |
| [`docs/routeros-commands.md`](docs/routeros-commands.md) | Lệnh RouterOS |
| [`docs/router-access.md`](docs/router-access.md) | Ghi chú access mẫu |
| [`docs/ant-design-frontend-redesign.md`](docs/ant-design-frontend-redesign.md) | UI redesign notes |
| [`backend/.env.example`](backend/.env.example) | Env mẫu |
| [`setup.config.example.json`](setup.config.example.json) | Setup đầy đủ |
| [`setup.config.minimal.json`](setup.config.minimal.json) | Setup tối thiểu |
| [`LICENSE`](LICENSE) | MIT |

---

## Tóm tắt một dòng

> **webuiproxymikrotik** = WebUI dual (desktop+mobile) + Fastify API + SQLite + 3proxy hub shards + MikroTik RouterOS automation, biến mỗi PPPoE thành proxy HTTP/SOCKS có IP public riêng, scale tới hàng trăm WAN, deploy 1-click Windows, giám sát realtime, quay IP & harden SSH trên chính router x86.

---

## License

[MIT](LICENSE) © 2025 [clonethinh](https://github.com/clonethinh)
