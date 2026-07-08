# Router access — lưu cho session sau

> **Cập nhật lần cuối:** 2026-07-08  
> **Lý do đổi SSH:** giảm bot scan cổng 22 mặc định

## Kết nối SSH (quản trị router)

| Mục | Giá trị |
|---|---|
| Host | `ntpcproxy.duckdns.org` |
| **SSH port** | **`22222`** |
| User | `admin` |
| Pass | (xem `.env` / `setup.config.json` — không ghi plain text ở đây) |

```bash
ssh -p 22222 admin@ntpcproxy.duckdns.org
```

## WebUI backend

| Mục | Giá trị |
|---|---|
| URL | http://ntpcproxy.duckdns.org:8088 |
| REST API (trong container) | `172.17.0.1:80` |
| SSH từ container → router | `127.0.0.1:22222` |

## Env backend (container WebUI)

```env
MIKROTIK_HOST=127.0.0.1
MIKROTIK_SSH_PORT=22222
MIKROTIK_WAN_HOST=ntpcproxy.duckdns.org
```

## Cổng quản trị mở trên WAN (`pppoe-wan`)

`8088` WebUI · `22222` SSH · `80` WebFig · `443` HTTPS · `8291` Winbox

## Lịch sử port SSH

| Ngày | Port | Ghi chú |
|---|---|---|
| trước 2026-07-08 | 22 | mặc định — nhiều bot scan |
| 2026-07-08 | **22222** | `mikrotik/ensure-ssh-port.rsc` |

## Khôi phục / re-apply

```bash
# Từ PC (cần file .rsc trên router)
ssh -p 22222 admin@ntpcproxy.duckdns.org
/import file=disk1/webuiproxymikrotik/ensure-ssh-port.rsc
```

Machine-readable: [`router-access.json`](../router-access.json)