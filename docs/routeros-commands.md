# RouterOS Commands Reference — webuiproxymikrotik

Tài liệu đầy đủ các lệnh RouterOS v7 dùng trong hệ thống, kèm giải thích và lý do.

## 1. Container feature (bắt buộc trước khi deploy)

| Lệnh | Giải thích | Lý do |
|------|------------|-------|
| `/system/device-mode/update container=yes` | Bật chế độ container trên thiết bị | RouterOS yêu cầu device-mode trước khi dùng `/container` |
| `/system/reboot` | Khởi động lại sau khi bật container mode | Container feature chỉ active sau reboot |
| `/container/config/set registry-url=https://ghcr.io tmpdir=disk1/pull` | Cấu hình registry + thư mục tạm | Image pull/extract cần disk lớn (`disk1`), không dùng RAM |
| `/container/config/set ram-high=512M ram-low=256M` | Giới hạn RAM cho container subsystem | Tránh OOM khi nhiều container chạy đồng thời |

## 2. Bridge & veth (kết nối container ↔ router)

| Lệnh | Giải thích | Lý do |
|------|------------|-------|
| `/interface/bridge/add name=containers-veth` | Tạo bridge cho tất cả veth | Một bridge trung tâm, mỗi proxy có subnet /30 riêng |
| `/ip/address/add address=172.17.0.1/16 interface=containers-veth` | IP quản lý trên bridge | Gateway cho webui container (`veth-webui`) |
| `/interface/veth/add name=veth-3p-N address=172.18.N.2/30 gateway=172.18.N.1` | Tạo veth cặp cho proxy N | Container nhận IP `.2`, router gateway `.1` |
| `/interface/bridge/port/add bridge=containers-veth interface=veth-3p-N` | Gắn veth vào bridge | Cho phép router route/NAT tới container |
| `/ip/address/add address=172.18.N.1/30 interface=containers-veth` | Gateway IP trên bridge | Router có thể reach container qua L3 |

**Idempotent:** Kiểm tra tồn tại bằng `name=` hoặc `comment=gw-veth-3p-N` trước khi add.

## 3. Policy-based routing (traffic container → đúng PPPoE)

| Lệnh | Giải thích | Lý do |
|------|------------|-------|
| `/routing/table/add name=to_pppoeN fib` | Routing table riêng cho WAN N | Mỗi PPPoE có bảng route độc lập |
| `/ip/route/add dst-address=0.0.0.0/0 gateway=pppoe-outN routing-table=to_pppoeN` | Default route trong table N | Traffic marked `to_pppoeN` đi ra `pppoe-outN` |
| `/ip/firewall/mangle/add chain=prerouting src-address=172.18.N.2 action=mark-routing new-routing-mark=to_pppoeN passthrough=yes comment=ctn-mangle-pppoe-outN` | Đánh dấu traffic từ container | Container IP → routing mark → đúng WAN |
| `/ip/firewall/nat/add chain=srcnat src-address=172.18.N.2/32 out-interface=pppoe-outN action=src-nat to-addresses=<IP_public> comment=ctn-pppoe-outN` | Rewrite source IP ra internet | Client thấy IP public của PPPoE tương ứng |

**Quan trọng:** Route bám **interface name** (`pppoe-outN`), không hard-code IP. Khi PPPoE reconnect đổi IP, chỉ cần update `to-addresses` trong srcnat.

## 4. dst-nat (client bên ngoài → container 3proxy)

| Lệnh | Giải thích | Lý do |
|------|------------|-------|
| `/ip/firewall/nat/add chain=dstnat dst-port=30055+N protocol=tcp action=dst-nat to-addresses=172.18.N.2 to-ports=20000+N comment=ctn-pppoe-outN-HTTP` | NAT HTTP proxy port | Client connect `WAN_IP:30055+N` → container port `20000+N` |
| `/ip/firewall/nat/add chain=dstnat dst-port=31055+N protocol=tcp action=dst-nat to-addresses=172.18.N.2 to-ports=21000+N comment=ctn-pppoe-outN-SOCKS` | NAT SOCKS5 port | Tương tự cho SOCKS |

**Port convention:** External `30055+N` / `31055+N` (tránh vùng broken 30000–30054).

## 5. Firewall filter

| Lệnh | Giải thích | Lý do |
|------|------------|-------|
| `/ip/firewall/filter/add chain=forward dst-port=30055-30099 protocol=tcp action=accept comment=webuiproxymikrotik-accept-proxy-range` | Cho phép forward tới proxy HTTP | Tránh rule DROP chặn traffic WAN→container |
| `/ip/firewall/filter/add chain=forward dst-port=31055-31099 protocol=tcp action=accept` | Cho phép forward SOCKS | Tương tự |
| `/ip/firewall/filter/move <rule> 0` | Đưa accept rule lên đầu chain | Accept phải match trước DROP |

## 6. Container 3proxy (per proxy)

| Lệnh | Giải thích | Lý do |
|------|------------|-------|
| `/container/add remote-image=ghcr.io/tarampampam/3proxy:2 interface=veth-3p-N root-dir=disk1/3proxy-pN name=proxy3p-N` | Tạo container 3proxy | Mỗi proxy = 1 container riêng, bind `0.0.0.0` |
| `/container/envlist/add name=ENV_3PROXY_N key=PROXY_LOGIN value=<user>` | Credential HTTP | Image `tarampampam/3proxy:2` đọc env |
| `/container/envlist/add name=ENV_3PROXY_N key=PROXY_PASSWORD value=<pass>` | Password | Auth bắt buộc |
| `/container/envlist/add name=ENV_3PROXY_N key=PROXY_PORT value=20000+N` | Port HTTP nội bộ | Khớp dst-nat |
| `/container/envlist/add name=ENV_3PROXY_N key=SOCKS_PORT value=21000+N` | Port SOCKS | Khớp dst-nat |
| `/container/envlist/add name=ENV_3PROXY_N key=PRIMARY_RESOLVER value=1.1.1.1` | DNS resolver | Container resolve hostname |
| `/container/envlist/add name=ENV_3PROXY_N key=MAX_CONNECTIONS value=512` | Giới hạn kết nối | Bảo vệ tài nguyên router |
| `/container/mounts/add list=MOUNT_PROXY_N src=disk1/users-N.json dst=/etc/3proxy/users.json` | Mount custom config (optional) | Override env bằng `3proxy.cfg` |
| `/container/start proxy3p-N` | Khởi động container | Apply env + extract image (~30–60s) |
| `/container/stop proxy3p-N` | Dừng proxy | Tắt proxy không xóa config |
| `/container/remove proxy3p-N` | Xóa container | Cleanup khi delete proxy |

## 7. Container WebUI (backend + frontend)

| Lệnh | Giải thích | Lý do |
|------|------------|-------|
| `/interface/veth/add name=veth-webui address=172.17.0.3/16 gateway=172.17.0.1` | Veth cho WebUI | Tách biệt khỏi proxy veth |
| `/container/mounts/add list=MOUNT_DATA src=disk1/data dst=/data` | Persist SQLite DB | DB survive container restart |
| `/container/envlist/add name=ENV_WEBUI key=MIKROTIK_HOST value=127.0.0.1` | Backend gọi REST local | Chạy trên router → loopback |
| `/container/envlist/add name=ENV_WEBUI key=DEPLOY_TARGET value=router` | Deploy mode | Phân biệt router vs external |
| `/container/add file=disk1/webuiproxymikrotik.tar interface=veth-webui root-dir=disk1/webuiproxymikrotik-root name=webuiproxymikrotik envlist=ENV_WEBUI mountlists=MOUNT_DATA` | Deploy stack | Multi-arch image alpine |
| `/container/start webuiproxymikrotik` | Start WebUI | Listen port 8088 |

**Fallback external:** `DEPLOY_TARGET=external`, `MIKROTIK_HOST=<public_ip>` — API contract giữ nguyên.

## 8. PPPoE reload IP

| Lệnh | Giải thích | Lý do |
|------|------------|-------|
| `/interface/pppoe-client/disable pppoe-outN` | Ngắt kết nối PPPoE | Trigger ISP cấp IP mới |
| `:delay 3s` | Chờ disconnect hoàn tất | Tránh race condition |
| `/interface/pppoe-client/enable pppoe-outN` | Dial lại | Lấy IP public mới |
| `/ip/firewall/nat/set [find comment=ctn-pppoe-outN] to-addresses=<new_ip>` | Update srcnat | Traffic ra đúng IP mới |

**Hard guard:** `pppoe-out1` KHÔNG BAO GIỜ disable (management path SSH/API).

## 9. Định tuyến thiết bị LAN (device routing)

| Lệnh | Giải thích | Lý do |
|------|------------|-------|
| `/ip/firewall/mangle/add chain=prerouting src-address=192.168.1.100 action=mark-routing new-routing-mark=to_pppoeN passthrough=yes comment=dev-route-<id>` | Route theo IP LAN | Thiết bị đi ra WAN N |
| `/ip/firewall/mangle/add chain=prerouting src-mac-address=AA:BB:CC:DD:EE:FF action=mark-routing new-routing-mark=to_pppoeN passthrough=yes comment=dev-route-<id>` | Route theo MAC | DHCP đổi IP vẫn đúng |
| `/ip/dhcp-server/lease/print` | Liệt kê lease | WebUI chọn thiết bị từ DHCP |
| `/ip/firewall/mangle/remove [find comment=dev-route-<id>]` | Xóa rule | Cleanup khi delete mapping |

**Trade-off:** Device routing chỉ đánh dấu **egress traffic** của thiết bị LAN, không ép traffic qua HTTP proxy. Để dùng proxy HTTP/SOCKS, client phải cấu hình proxy settings thủ công.

## 10. Health check / test proxy

| Lệnh | Giải thích | Lý do |
|------|------------|-------|
| `/tool fetch url="https://api.ipify.org" http-proxy=172.18.N.2:20000+N http-proxy-user=<user> http-proxy-password=<pass>` | Test HTTP proxy | Đo IP thoát + latency |
| Backend curl (external deploy) | Test từ host | Khi `DEPLOY_TARGET=external` |

## 11. Cleanup (idempotent reverse)

| Lệnh | Giải thích | Lý do |
|------|------------|-------|
| `/container/stop proxy3p-N` | Dừng trước khi xóa | Tránh lock root-dir |
| `/container/remove proxy3p-N` | Xóa container | Giải phóng disk |
| `/ip/firewall/nat/remove [find comment~"ctn-pppoe-outN"]` | Xóa NAT rules | HTTP + SOCKS + srcnat |
| `/ip/firewall/mangle/remove [find comment=ctn-mangle-pppoe-outN]` | Xóa mangle | Bỏ routing mark |
| `/interface/veth/remove veth-3p-N` | Xóa veth | Cleanup interface |

## 12. Scripts .rsc (chạy theo thứ tự)

```routeros
/import file=disk1/webuiproxymikrotik/install-all.rsc
```

Thứ tự nội bộ:
1. `ensure-bridge.rsc` — bridge + DNS
2. `ensure-veth-for-pppoe.rsc` — veth per PPPoE
3. `ensure-routing.rsc` — routing table + mangle + srcnat
4. `ensure-dstnat.rsc` — dst-nat HTTP/SOCKS
5. `ensure-firewall.rsc` — filter accept

Tất cả scripts **idempotent** — chạy lại không nhân đôi rule (detect bằng `comment`).

## 13. Comment markers (tra cứu nhanh)

| Comment | Mục đích |
|---------|----------|
| `ctn-mangle-pppoe-outN` | Mangle mark container → WAN |
| `ctn-pppoe-outN` | srcnat container IP |
| `ctn-pppoe-outN-HTTP` | dst-nat HTTP |
| `ctn-pppoe-outN-SOCKS` | dst-nat SOCKS |
| `gw-veth-3p-N` | Gateway IP trên bridge |
| `bp-veth-3p-N` | Bridge port |
| `dev-route-<id>` | Device LAN routing |
| `webuiproxymikrotik-accept-proxy-range` | Firewall accept |