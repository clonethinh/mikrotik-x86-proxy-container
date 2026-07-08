# Architecture Notes

## Container layout trên Mikrotik

```
Mikrotik 7.23.1 (x86_64, 7.4GB RAM)
├── bridge containers-veth (172.17.0.1/16 + per-veth /30)
│   ├── veth-webui (172.17.0.3) → container webuiproxymikrotik
│   ├── veth-3p-1 (172.18.1.1 ↔ 172.18.1.2) → proxy3p-1
│   ├── veth-3p-2 (172.18.2.1 ↔ 172.18.2.2) → proxy3p-2
│   ├── ... lên đến veth-3p-30
├── Mount /disk1/users-N.json → /etc/3proxy/users.json (mỗi container)
├── Mount /disk1/data → /data (cho webui SQLite)
└── Disk persistence: /disk1 (Mikrotik filesystem)
```

## Per-proxy routing chain

```
Inbound (client connect tới WAN_IP:30055+N):
  dstnat: chain=dstnat dst-port=30055+N action=dst-nat
          to-addresses=172.18.N.2 to-ports=2000N
  → packet tới container 3proxy

Outbound (3proxy gửi request ra internet):
  mangle prerouting: src-address=172.18.N.2
                     action=mark-routing new-routing-mark=to_pppoeN
  → route table to_pppoeN:
       0.0.0.0/0 via pppoe-outN
  → traffic đi ra pppoe-outN

  srcnat: chain=srcnat src-address=172.18.N.2 out-interface=pppoe-outN
          action=src-nat to-addresses=<IP public của pppoe-outN>
  → Mikrotik rewrite source IP thành IP public của PPPoE
  → packet ra internet với IP public pppoe-outN
```

## Idempotency strategy

Tất cả rule tạo qua REST API / `.rsc` đều có **comment marker** để detect tồn tại:
- `ctn-mangle-pppoe-outN` — mangle rule
- `ctn-pppoe-outN` — srcnat rule
- `ctn-pppoe-outN-HTTP` — dstnat HTTP rule
- `ctn-pppoe-outN-SOCKS` — dstnat SOCKS rule
- `gw-veth-3p-N` — gateway IP trên bridge
- `bp-veth-3p-N` — bridge port
- `webuiproxymikrotik-accept-proxy-range` — firewall accept

Trước khi add rule mới, `find` theo comment. Nếu tồn tại → skip. Chạy `install-all.rsc` nhiều lần OK.

## Trade-offs & ràng buộc RouterOS

### Đã chọn
1. **REST API cho mọi thứ** (không dùng node-routeros binary protocol): REST works cho container/veth/NAT/mangle/route — verified
2. **SSH chỉ cho file ops** (mount list, /file/add): REST fails cho mount, /container/mounts/* phải dùng CLI
3. **Per-PPPoE veth thay vì single shared**: bind 0.0.0.0 + Mikrotik NAT rewrite IP (IP_FREEBIND không hoạt động trong namespace)
4. **Port range 30055+N** thay vì 30000+N: tránh vùng broken 30000-30054
5. **External port = Mikrotik WAN IP + per-PPPoE port**: client biết IP nào để kết nối (vì mỗi PPPoE có IP public riêng)

### Hạn chế đã chấp nhận
- **Tối đa ~16 containers** trên Mikrotik → hiện tại có 30 PPPoE, chỉ tạo proxy cho 16 (giới hạn bởi /30 veth)
- **Container image extract ~30-60s/container**: chậm khi bulk create nhiều cái
- **Mikrotik Container không share extracted layers**: mỗi container cần unique root-dir → 16 root-dir × 100MB = 1.6GB disk
- **Background monitor 60s**: không realtime 100%, nhưng reload-ip qua WS push event ngay

### Fallback / nếu router quá tải
Set `DEPLOY_TARGET=external` → backend chạy trên VPS/host ngoài, API contract giữ nguyên 100%. Chỉ thay đổi:
- Backend bind IP khác (0.0.0.0:8088 trên host)
- `MIKROTIK_HOST=<public_ip>` thay vì 127.0.0.1
- Docker compose chạy thay vì container trên router

## Container resource budget

| Component | RAM | Disk | Notes |
|-----------|-----|------|-------|
| webui (Fastify + React) | ~100 MB | 50 MB | Node 22 alpine, sqlite |
| 3proxy per container | ~10 MB | 100 MB (extracted) | Tiny static binary |
| 16 × 3proxy + webui | ~260 MB | 1.6 GB | All in one Mikrotik |
| /disk1 (58 GB total) | — | 1.6 GB used | 56 GB free ✓ |

Mikrotik 7.4 GB RAM thoải mái. 58 GB disk đủ cho 16 containers + headroom.

## Realtime event taxonomy

| Event | Payload | Source |
|-------|---------|--------|
| `proxy.created` | `{id, pppoeIdx}` | POST /api/proxies |
| `proxy.updated` | `{id}` | PATCH /api/proxies/:id |
| `proxy.deleted` | `{id, pppoeIdx}` | DELETE |
| `proxy.status` | `{id, status}` | start/stop/restart |
| `proxy.reloading` | `{id, pppoeIdx}` | reload-ip trigger |
| `proxy.ip-changed` | `{id, pppoeIdx, newIp, oldIp}` | reload-ip success OR WAN sync detect change |
| `proxy.health` | `{id, ok, latencyMs, exitIp, error}` | health check (manual or auto 60s) |
| `proxy.applied` | `{id}` | container created + started |
| `proxy.error` | `{id, error}` | apply failed |
| `wan.sync` | `[PppoeInterface]` | periodic sync (60s) |

Buffer: 100 events replay on reconnect.