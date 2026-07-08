# Ant Design v6 — Tổng hợp thiết kế & AI tooling

> Tài liệu chuẩn bị **thiết kế lại frontend toàn diện** cho `webuiproxymikrotik`.
> Tổng hợp từ tài liệu chính thức Ant Design (tháng 7/2026), đã đối chiếu trực tiếp với
> `design.md` gốc và docs CLI/MCP để đảm bảo không có thông tin bịa.
>
> **Nguồn gốc:**
> - [design.md](https://ant.design/design.md)
> - [For Agents](https://ant.design/docs/react/for-agents)
> - [LLMs.txt](https://ant.design/docs/react/llms)
> - [MCP Server](https://ant.design/docs/react/mcp)
> - [CLI](https://ant.design/docs/react/cli)
> - [Migration v5 → v6](https://ant.design/docs/react/migration-v6)

---

## 0. Prerequisite — kiểm tra trước khi động tay

Đây là điều kiện bắt buộc của antd v6, không có trong bản trước — **check trước Phase 0**:

| Yêu cầu | Chi tiết |
|---|---|
| **React ≥ 18** | v6 không còn hỗ trợ React 17 trở xuống |
| **Không hỗ trợ IE** | v6 dùng CSS variables mặc định, StyleProvider cho IE đã bị gỡ |
| **Node ≥ 20.0.0** | Bắt buộc để chạy `@ant-design/cli` (CLI, MCP server) |
| **`@ant-design/icons` phải cùng major với `antd`** | antd@6 **không tương thích** với `@ant-design/icons@5`. Nếu build lỗi icon hoặc render sai, kiểm tra ngay chỗ này trước |

```powershell
# check nhanh version hiện tại trong repo
node -v
npm ls antd @ant-design/icons --depth=0
```

⚠️ **Cảnh báo phát hiện khi review bản trước:** `package.json` project ghi
`antd ^6.5.0` nhưng `@ant-design/icons ^5.6.1` — đây là **mismatch thật**, cần
upgrade `@ant-design/icons` lên `^6.x` trước khi làm bất cứ gì khác ở Phase 0,
nếu không sẽ dính lỗi build âm thầm hoặc icon không render đúng.

---

## 1. Trạng thái project hiện tại

| Hạng mục | Giá trị | Ghi chú |
|---|---|---|
| UI library | `antd ^6.5.0` | — |
| Icons | ~~`@ant-design/icons ^5.6.1`~~ → **cần nâng lên `^6.x`** | xem §0 |
| Charts | `@ant-design/plots ^2.6.8` | verify lại version khi upgrade |
| Theme file | `frontend/src/theme/proxyTheme.ts` | — |
| Custom CSS | `frontend/src/styles/proxy.css` | có hard-code hex, cần migrate |
| Locale | `vi_VN` (`main.tsx`) | — |
| Layout | Dark sider `#001529` + light content | review giữ hay đổi ở Phase 2 |

### Pages (8)

| Route | File | Mục đích |
|---|---|---|
| `/dashboard` | `DashboardPage.tsx` | Tổng quan fleet |
| `/fleet` | `FleetPage.tsx` | Danh sách proxy fleet |
| `/proxies` | `ProxiesPage.tsx` | Quản lý proxy chi tiết (table nặng) |
| `/wan` | `WanPage.tsx` | WAN / PPPoE control |
| `/devices` | `DevicesPage.tsx` | Định tuyến thiết bị LAN |
| `/audit` | `AuditPage.tsx` | Audit log |
| `/settings` | `SettingsPage.tsx` | Cấu hình hệ thống |
| `/login` | `LoginPage.tsx` | Đăng nhập |

### Theme đã có (`proxyTheme.ts`)

Đã align với design.md mặc định v6: primary `#1677FF`, font 14px, radius 6px, layout `#F5F5F5`.
Override riêng: dark sidebar enterprise, table hover `#E6F4FF`, card padding 20px.

### Custom ngoài token (cần review khi redesign)

`proxy.css` có hard-code màu cho endpoint chip, stat card, logs terminal — nên migrate dần sang token/semantic.

---

## 2. Triết lý thiết kế (design.md)

### 2.1 Bốn giá trị

| Giá trị | Ý nghĩa thực hành |
|---|---|
| **Natural** | UI quen thuộc enterprise, không phá convention |
| **Certain** | State rõ: hover / focus / loading / error / disabled |
| **Meaningful** | Nhấn CTA, bỏ decoration thừa |
| **Growing** | Scale từ form → dense table → multi-tenant console |

**Định vị:** Back-office / NOC / proxy ops — **không** landing marketing.

### 2.2 Màu sắc (default light v6)

#### Functional seeds

```
colorPrimary   #1677FF   (hover #4096FF, active #0958D9)
colorSuccess   #52C41A
colorWarning   #FAAD14
colorError     #FF4D4F
colorInfo      #1677FF
```

#### Surface (3 lớp — bắt buộc đọc token, không hard-code hex)

```
colorBgLayout      #F5F5F5   — nền trang
colorBgContainer   #FFFFFF   — card, table, form
colorBgElevated    #FFFFFF   — modal, dropdown (phân biệt bằng shadow)
```

#### Text (equivalent trên nền trắng)

```
Primary      #1F1F1F   (rgba 0.88)
Secondary    #595959   (0.65)
Tertiary     —         (0.45)
Disabled     #BFBFBF   (0.25)
Border       #D9D9D9
Border light #F0F0F0
```

#### Preset palette (tags, charts ONLY)

`blue · purple · cyan · green · magenta · red · orange · yellow · volcano · geekblue · gold · lime`

**Không** dùng preset làm button primary / navigation accent tùy ý.

#### Semantic surfaces

```
Menu selected    bg #E6F4FF + text primary
Alert success    bg #F6FFED
Alert warning    bg #FFFBE6
Alert error      bg #FFF2F0
Alert info       bg #E6F4FF
Tag blue         bg #E6F4FF, text #0958D9
```

### 2.3 Typography

| Rule | Value |
|---|---|
| Base font size | **14px** (dense enterprise) |
| Weights | **400** body, **600** title/heading only |
| Tránh | thin, 700+, italic trong chrome |
| Stack | `-apple-system`, `Segoe UI`, `Roboto`, `Helvetica Neue`, `Arial`, `Noto Sans` |
| Code | `SFMono-Regular`, `Consolas`, `Menlo`, `Courier` |

#### Type scale

```
display-lg    38/46  600
headline-lg   30/38  600
headline-md   24/32  600
headline-sm   20/28  600
title-lg      16/24  600
title-md      14/22  600
body-lg       16/24  400
body-md       14/22  400
body-sm       12/20  400
code          13/20  400
```

### 2.4 Layout & spacing

- Grid **4px** — scale: `4 · 8 · 16 · 24 · 32px`
- `controlHeight`: **32px**
- Không magic number trong code mới (`11px`, `13px`…)

### 2.5 Shape (border-radius)

| Loại | Radius |
|---|---|
| Button, Input, Select, Segmented | **6px** |
| Card, Modal, Drawer, Notification | **8px** |
| Tag, Tooltip, Popover | **4px** |
| Table inner | **0px** |
| Avatar, badge dot | **full** |

### 2.6 Elevation & motion

**Flat-first** — border + tonal contrast là chính.

| Shadow tier | Dùng cho |
|---|---|
| `boxShadowTertiary` | Card nhẹ, stat tile |
| `boxShadow` / Secondary | Modal, dropdown |
| `boxShadowCard` | Card tách container |

| Duration | Dùng cho |
|---|---|
| Fast 0.1s | hover, focus, press |
| **Mid 0.2s** | mặc định transition |
| Slow 0.3s | modal enter, drawer |

Dùng easing có sẵn (`motionEaseInOut`…), không tự chế `cubic-bezier`.

### 2.7 Component archetypes

| Component | Quy tắc |
|---|---|
| Button primary | **1** dominant CTA / vùng quyết định |
| Button default | Action phụ, hover đổi text primary |
| Input / Select | 32px, focus border primary + glow |
| Card | White, radius 8, padding 24 (project: 20) |
| Modal | Card + mask `rgba(0,0,0,0.45)` + popup shadow |
| Menu selected | `#E6F4FF` + primary text (light menu) |
| Tabs active | Primary text + underline 2px, **không** nền |
| Table header | `#FAFAFA`, 14/600; hover row only |
| Tag | Phân loại; không thay Alert |
| Tooltip | `rgba(0,0,0,0.85)` + white text |

### 2.8 Do / Don't

**Do**
- `theme.useToken()` / `ConfigProvider` cho màu & spacing
- 1 primary button per decision surface
- Preset colors cho tag/chart/status chip
- Snap 4px grid

**Don't**
- Hard-code `#FFF`, `#FAFAFA`, `#1677FF` rải rác
- 2 primary buttons cạnh nhau
- Custom accent / shadow / easing một lần
- Tag cho critical state (dùng Alert/Badge + text)

### 2.9 Customization API

```tsx
import { ConfigProvider, theme } from 'antd';

<ConfigProvider
  theme={{
    algorithm: theme.defaultAlgorithm, // | darkAlgorithm | compactAlgorithm | [both]
    token: { colorPrimary: '#1677FF', borderRadius: 6, fontSize: 14 },
    components: {
      Table: { headerBg: '#FAFAFA', rowHoverBg: '#E6F4FF' },
    },
    cssVar: true,       // optional: CSS variables
    zeroRuntime: false, // true nếu dùng extracted CSS (@ant-design/static-style-extract)
  }}
>
```

| API | Mục đích |
|---|---|
| `theme.token` | Seed override → derive palette |
| `theme.algorithm` | Light / dark / compact |
| `theme.components.*` | Per-component token |
| `theme.useToken()` | Trong React component |
| `theme.getDesignToken()` | Ngoài React |
| Nested `ConfigProvider` | Theme local theo section |

**Lưu ý:** `message.xxx`, `Modal.xxx` static API không tự nhận theme — dùng `App` + hook API.

---

## 3. Prompt chuẩn cho AI agent (For Agents)

Copy vào session / `.cursor/rules` / `AGENTS.md` khi redesign:

```text
Project dùng Ant Design v6.5+. API v6 có breaking changes so với training data.
Yêu cầu môi trường: React >= 18, Node >= 20 (cho CLI/MCP), @ant-design/icons phải
cùng major version với antd (v6).

Trước khi viết UI:
1. Đọc docs/ant-design-frontend-redesign.md trong repo
2. Đọc https://ant.design/design.md
3. Đọc https://raw.githubusercontent.com/ant-design/ant-design-cli/main/skills/antd/SKILL.md

Quy tắc:
- Enterprise back-office: dense tables, rõ state, 1 primary CTA/vùng
- Token-first: ConfigProvider + theme.useToken(), không hard-code hex
- Font 14px, control 32px, radius 6/8px
- Static feedback qua <App> không dùng message static

Sau khi sửa frontend/src, chạy (nếu có CLI):
  antd lint ./frontend/src
  antd usage ./frontend/src
```

Cài skill (optional):

```bash
npx skills add ant-design/ant-design-cli
npm install -g @ant-design/cli   # Node >= 20 bắt buộc
```

---

## 4. CLI `@ant-design/cli` (offline)

Metadata local cho antd v3/v4/v5/v6. **Không cần network.**

### Cài đặt

```bash
npm install -g @ant-design/cli
# hoặc: npx -y @ant-design/cli <command>
```

### Lệnh hay dùng khi redesign

```bash
# Tra cứu
antd list
antd info Table --format json
antd doc Form
antd demo Table basic
antd token Table
antd design.md
antd semantic Table

# Phân tích project
antd usage ./frontend/src
antd lint ./frontend/src
antd doctor
antd env ./frontend

# Migration / version
antd changelog 5.0.0 6.0.0 Table
antd migrate 5 6                       # đọc guide
antd migrate 5 6 --apply ./frontend/src  # sinh prompt migration agent-ready

# Agent setup
antd mcp
antd setup --client cursor --mode both
antd upgrade                            # tự nâng cấp CLI (npm/yarn/pnpm/bun/cnpm/utoo)
```

### Global flags

| Flag | Mô tả |
|---|---|
| `--format json\|text\|markdown` | Output format |
| `--version 6.5.0` | Pin antd version |
| `--lang en\|zh` | Ngôn ngữ |
| `--detail` | Thông tin mở rộng |

---

## 5. MCP Server (IDE integration)

8 tools + 2 prompts. Yêu cầu Node ≥ 20. Cấu hình Cursor (`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "antd": {
      "command": "npx",
      "args": ["-y", "@ant-design/cli", "mcp"]
    }
  }
}
```

Hoặc Grok (`~/.grok/config.toml`):

```toml
[mcp_servers.antd]
command = "npx"
args = ["-y", "@ant-design/cli", "mcp"]
startup_timeout_sec = 60
```

### Tools

| Tool | Mô tả |
|---|---|
| `antd_list` | Liệt kê components |
| `antd_info` | Props, types, defaults |
| `antd_doc` | Full markdown doc |
| `antd_demo` | Demo code TSX |
| `antd_token` | Design tokens |
| `antd_design_md` | design.md content |
| `antd_semantic` | classNames / styles DOM |
| `antd_changelog` | API diff theo version |

### Prompts

| Prompt | Mô tả |
|---|---|
| `antd-expert` | Agent chuyên Ant Design |
| `antd-page-generator` | Tạo page theo component |

Community alternative: `@jzone-mcp/antd-components-mcp`

---

## 6. LLMs.txt (không cần MCP)

| URL | Mô tả |
|---|---|
| https://ant.design/llms.txt | Mục lục toàn bộ docs |
| https://ant.design/design.md | Design language (file này §2) |
| https://ant.design/llms-full.txt | Full docs EN (~lớn) |
| https://ant.design/llms-full-cn.txt | Full docs CN |
| https://ant.design/llms-semantic.md | Semantic DOM EN |
| https://ant.design/components/{name}.md | Doc từng component |
| https://ant.design/components/{name}/semantic.md | Semantic từng component |

**Cursor rule gợi ý:**

```text
Khi code Ant Design trong frontend/, tham chiếu docs/ant-design-frontend-redesign.md
và https://ant.design/components/<Component>.md cho API chính xác v6.
```

---

## 7. Kế hoạch redesign — checklist

### Phase 0 — Chuẩn bị tooling & prerequisite

- [ ] **Verify `@ant-design/icons` cùng major với `antd` (v6)** — sửa mismatch đã phát hiện
- [ ] Confirm React ≥ 18, Node ≥ 20 trên máy dev
- [ ] `npm i -g @ant-design/cli`
- [ ] `antd setup --client cursor --mode both`
- [ ] Baseline: `antd usage ./frontend/src` + `antd lint ./frontend/src`
- [ ] Chụp screenshot / ghi pain point từng page

### Phase 1 — Design system consolidation

- [ ] Mở rộng `proxyTheme.ts`: dark mode token (optional), `cssVar: true`
- [ ] Map `proxy.css` → token hoặc `theme.components`
- [ ] Tạo shared primitives: `PageShell`, `DataTable`, `StatusTag`, `MetricCard`
- [ ] Thống nhất spacing page: hero 16px, section 24px, toolbar card 12×16

### Phase 2 — Layout & navigation

- [ ] Review dark sider vs light content — có giữ `#001529` hay chuyển light sider?
- [ ] Breadcrumb / page header pattern thống nhất
- [ ] Responsive: `ProxiesPage` table scroll + column priority
- [ ] WS status badge — dùng `Badge` token, không inline style

### Phase 3 — Pages (ưu tiên)

| Page | Hướng redesign |
|---|---|
| **ProxiesPage** | Table density, filter toolbar, drawer analytics, copy proxy string |
| **DashboardPage** | Statistic grid, `@ant-design/plots` theme align |
| **FleetPage** | Card/list view toggle, status semantics |
| **WanPage** | Realtime toast qua `App`, PPPoE state colors |
| **SettingsPage** | Form sections, Descriptions → Pro layout |
| **LoginPage** | Minimal card, 1 primary CTA |
| **AuditPage** | Filter bar, monospace log optional |
| **DevicesPage** | Table + policy banner pattern |

### Phase 4 — Quality

- [ ] `antd lint ./frontend/src` — fix deprecated API
- [ ] A11y: contrast primary on `#1677FF` (WCAG note từ design.md)
- [ ] Bundle: code-split pages lớn (vite `manualChunks`)
- [ ] Xóa inline `style={{}}` hard-code màu → `token.color*`

### Phase 5 — Dark mode (optional)

```tsx
algorithm: [theme.defaultAlgorithm, theme.darkAlgorithm]
// + Switch trong Settings
```

---

## 8. Token map — redesign reference

### Global tokens (giữ / mở rộng)

```ts
// frontend/src/theme/proxyTheme.ts — đề xuất baseline
token: {
  colorPrimary: '#1677FF',
  colorSuccess: '#52C41A',
  colorWarning: '#FAAD14',
  colorError: '#FF4D4F',
  colorInfo: '#1677FF',
  colorBgLayout: '#F5F5F5',
  colorBgContainer: '#FFFFFF',
  colorText: '#1F1F1F',
  colorTextSecondary: '#595959',
  colorTextDisabled: '#BFBFBF',
  colorBorder: '#D9D9D9',
  colorBorderSecondary: '#F0F0F0',
  borderRadius: 6,
  borderRadiusLG: 8,
  fontSize: 14,
  fontSizeSM: 12,
  fontSizeLG: 16,
  controlHeight: 32,
  motionDurationMid: '0.2s',
}
```

### Component tokens (project-specific)

```ts
components: {
  Layout: {
    siderBg: '#001529',        // enterprise dark nav — review khi redesign
    headerBg: '#FFFFFF',
    bodyBg: '#F5F5F5',
    headerHeight: 56,
  },
  Menu: {
    darkItemSelectedBg: '#1677FF',  // hoặc #E6F4FF nếu chuyển light menu
    itemBorderRadius: 6,
  },
  Table: {
    headerBg: '#FAFAFA',
    rowHoverBg: '#E6F4FF',
    cellPaddingBlock: 12,
    cellPaddingInline: 16,
  },
  Card: { borderRadiusLG: 8, paddingLG: 20 },
  Button: { borderRadius: 6 },
  Tag: { borderRadiusSM: 4 },
}
```

### Semantic chips (proxy domain)

| Loại | Nền | Text | Border |
|---|---|---|---|
| HTTP endpoint | `#E6F4FF` | `#0958D9` | `#91CAFF` |
| SOCKS endpoint | `#FFF0F6` | `#9E1068` | `#FFADD2` |
| Running | `#F6FFED` | `#52C41A` | — |
| Error | `#FFF2F0` | `#FF4D4F` | — |

→ Nên đưa vào `theme.components.Tag` variants hoặc CSS variable từ token.

---

## 9. Component picker — ops UI

| Pattern | Ant Design component |
|---|---|
| Dense data | `Table` + `pagination` + `column.filter` |
| Realtime status | `Badge`, `Tag`, `Tooltip` |
| Metrics | `Statistic`, `Card`, `@ant-design/plots` |
| Filters | `Input`, `Select`, `Segmented`, `Space` |
| Bulk actions | `Dropdown`, `Button` default + 1 primary |
| Detail / logs | `Drawer`, `Tabs`, `Typography.Paragraph` |
| Confirm destructive | `Modal.confirm` / `Popconfirm` |
| Toast | `App.useApp().message` — **không** `message.xxx` static |
| Form settings | `Form` + `Card` sections |
| Empty state | `Empty` + CTA |
| Error boundary | `Result` (đã có `ErrorBoundary.tsx`) |

---

## 10. Link nhanh

| Resource | URL |
|---|---|
| design.md | https://ant.design/design.md |
| Customize theme | https://ant.design/docs/react/customize-theme |
| For Agents | https://ant.design/docs/react/for-agents |
| CLI | https://ant.design/docs/react/cli |
| MCP | https://ant.design/docs/react/mcp |
| LLMs.txt | https://ant.design/docs/react/llms |
| Migration v5 → v6 | https://ant.design/docs/react/migration-v6 |
| CLI GitHub | https://github.com/ant-design/ant-design-cli |
| CLI Skill | https://github.com/ant-design/ant-design-cli/blob/main/skills/antd/SKILL.md |

---

*Cập nhật: 2026-07-08 — dùng làm single source of truth khi redesign `frontend/`.*
*Đã review & fix: mismatch version icons (§0, §1), bổ sung prerequisite React/Node (§0),
bổ sung `--apply` flag cho `antd migrate` (§4).*
