import {
  Button, Card, Dropdown, Empty, Input, Popconfirm, Segmented, Skeleton, Space, Tag, Typography, Flex,
} from 'antd';
import {
  ApiOutlined, CheckCircleOutlined, DownloadOutlined, ImportOutlined,
  KeyOutlined, MoreOutlined, PauseCircleOutlined, PlusOutlined,
  ReloadOutlined, WarningOutlined, FileTextOutlined, GlobalOutlined, EyeOutlined, CopyOutlined,
} from '@ant-design/icons';
import ProxyPageShell, { ProxyCode } from '../proxy/ProxyPageShell';
import ProxyStatsRow from '../proxy/ProxyStatsRow';
import ProxyToolbar from '../ui/ProxyToolbar';
import AppDrawer from '../ui/AppDrawer';
import { DrawerSection, DrawerKv, DrawerKvGrid, DrawerStatusBand } from '../ui/DrawerSection';
import ProxyEndpoint from '../ProxyEndpoint';
import ContainerStatusTag from '../ContainerStatusTag';
import ProxiesDataTable from './ProxiesDataTable';
import ProxyModals from './ProxyModals';
import ProxyAnalyticsDrawer from './ProxyAnalyticsDrawer';
import ProxyTrafficMini from './ProxyTrafficMini';
import { HTTP_PORT_BASE, SOCKS_PORT_BASE } from '../../lib/proxyUtils';
import type { ProxiesPageViewProps } from '../../hooks/useProxiesPage';

const { Text } = Typography;

const STATUS_TONE: Record<string, 'success' | 'error' | 'warning' | 'info' | 'default'> = {
  running: 'success',
  stopped: 'default',
  error: 'error',
  pending: 'info',
};

export default function ProxiesPageView(vm: ProxiesPageViewProps) {
  const {
    loading,
    stats,
    search,
    setSearch,
    statusFilter,
    setStatusFilter,
    selected,
    setSelected,
    proxies,
    filtered,
    focusTarget,
    setFocusTarget,
    tablePagination,
    metricsMap,
    wanByIdx,
    busy,
    bulkBusy,
    load,
    copyToClipboard,
    revealPassword,
    toggleOne,
    testOne,
    reloadOne,
    showLogs,
    openAnalytics,
    openEdit,
    bulk,
    openBulkCreds,
    regenerateCreds,
    setCreateOpen,
    setImportOpen,
    setImportText,
    setExportOpen,
    logsTarget,
    setLogsTarget,
    logsText,
    logsLoading,
  } = vm;

  if (loading) {
    return (
      <div className="proxy-page">
        <Skeleton.Input active style={{ width: '100%', height: 72, marginBottom: 16 }} />
        <Skeleton active paragraph={{ rows: 10 }} />
      </div>
    );
  }

  const emptyNode = (
    <Empty
      image={Empty.PRESENTED_IMAGE_SIMPLE}
      description={
        proxies.length === 0
          ? 'Chưa có proxy — tạo mới hoặc import danh sách pppoe-out'
          : 'Không có proxy khớp bộ lọc'
      }
    >
      {proxies.length === 0 && (
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
          Tạo proxy đầu tiên
        </Button>
      )}
    </Empty>
  );

  const detail = focusTarget;
  const detailMetrics = detail ? metricsMap[detail.id] : null;
  const detailWan = detail ? wanByIdx.get(detail.pppoeIdx) : null;

  return (
    <ProxyPageShell
      compactHeader
      title={<><ApiOutlined style={{ marginRight: 8, color: '#1677FF' }} />Quản lý Proxy</>}
      subtitle={(
        <>
          Proxy đã ghi trong DB — HTTP <ProxyCode>{HTTP_PORT_BASE}+N</ProxyCode> · SOCKS <ProxyCode>{SOCKS_PORT_BASE}+N</ProxyCode>.
          Click dòng hoặc menu ⋯ để xem chi tiết, analytics và logs.
        </>
      )}
      extra={<Button icon={<ReloadOutlined />} onClick={load}>Làm mới</Button>}
      stats={(
        <ProxyStatsRow
          items={[
            { key: 'all', title: 'Tổng proxy', value: stats.total, icon: <ApiOutlined />, accent: 'primary' },
            { key: 'run', title: 'Running', value: stats.running, icon: <CheckCircleOutlined />, accent: 'success' },
            { key: 'stop', title: 'Stopped', value: stats.stopped, icon: <PauseCircleOutlined /> },
            { key: 'err', title: 'Error', value: stats.error, icon: <WarningOutlined />, accent: stats.error ? 'error' : 'default' },
            ...(stats.pending > 0 ? [{
              key: 'pend',
              title: 'Pending',
              value: stats.pending,
              icon: <ReloadOutlined spin />,
              accent: 'warning' as const,
            }] : []),
          ]}
        />
      )}
      toolbar={(
        <ProxyToolbar
          filters={(
            <>
              <Input.Search
                placeholder="Tìm PPPoE, user, IP public…"
                allowClear
                style={{ width: 280, maxWidth: '100%' }}
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              <Segmented
                value={statusFilter}
                onChange={v => setStatusFilter(v as string)}
                options={[
                  { label: `Tất cả (${stats.total})`, value: 'all' },
                  { label: `Running (${stats.running})`, value: 'running' },
                  { label: `Stopped (${stats.stopped})`, value: 'stopped' },
                  { label: `Error (${stats.error})`, value: 'error' },
                  ...(stats.pending > 0 ? [{ label: `Pending (${stats.pending})`, value: 'pending' }] : []),
                ]}
              />
            </>
          )}
          actions={(
            <>
              <Dropdown
                menu={{
                  items: [
                    { key: 'import', label: 'Import danh sách', icon: <ImportOutlined />, onClick: () => { setImportText(''); setImportOpen(true); } },
                    { key: 'export', label: 'Export', icon: <DownloadOutlined />, disabled: proxies.length === 0, onClick: () => setExportOpen(true) },
                    { type: 'divider' },
                    { key: 'creds', label: 'Đổi user/pass hàng loạt', icon: <KeyOutlined />, disabled: proxies.length === 0, onClick: openBulkCreds },
                    { key: 'regen', label: 'Regenerate password', icon: <ReloadOutlined />, disabled: proxies.length === 0, onClick: regenerateCreds },
                  ],
                }}
              >
                <Button icon={<MoreOutlined />}>Thêm</Button>
              </Dropdown>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
                Tạo proxy
              </Button>
            </>
          )}
          bulk={selected.length > 0 ? (
            <>
              <Tag color="blue" bordered={false}>Đã chọn {selected.length}</Tag>
              <Button size="small" loading={bulkBusy} onClick={() => bulk('start')}>Bật</Button>
              <Button size="small" loading={bulkBusy} onClick={() => bulk('stop')}>Tắt</Button>
              <Button size="small" loading={bulkBusy} onClick={() => bulk('reload-ip')}>Reload IP</Button>
              <Button size="small" loading={bulkBusy} onClick={() => bulk('test')}>Test</Button>
              <Button size="small" icon={<KeyOutlined />} onClick={openBulkCreds}>Đổi user/pass</Button>
              <Popconfirm title={`Xoá ${selected.length} proxy?`} onConfirm={() => bulk('delete')}>
                <Button size="small" danger loading={bulkBusy}>Xoá</Button>
              </Popconfirm>
            </>
          ) : undefined}
        />
      )}
    >
      <Card className="proxy-table-card" styles={{ body: { padding: 0 } }}>
        <ProxiesDataTable
          data={filtered}
          selected={selected}
          busyId={busy}
          metricsMap={metricsMap}
          wanByIdx={wanByIdx}
          pagination={tablePagination}
            onSelect={setSelected}
            onCopy={copyToClipboard}
            onToggle={toggleOne}
            onTest={testOne}
            onReloadIp={reloadOne}
            onDetail={setFocusTarget}
            onAnalytics={openAnalytics}
            onLogs={showLogs}
            onEdit={openEdit}
            onRevealPassword={revealPassword}
          emptyNode={emptyNode}
        />
      </Card>

      <ProxyModals {...vm} />
      <ProxyAnalyticsDrawer {...vm} />

      <AppDrawer
        open={!!detail}
        onClose={() => setFocusTarget(null)}
        width="md"
        icon={<GlobalOutlined />}
        title={detail?.pppoeName ?? 'Chi tiết proxy'}
        subtitle={detail ? (detail.publicIp || 'Chưa có IP public') : undefined}
      >
        {detail && (
          <>
            <DrawerStatusBand tone={STATUS_TONE[detail.status] ?? 'default'}>
              <Tag
                color={detail.status === 'running' ? 'success' : detail.status === 'error' ? 'error' : 'default'}
                bordered={false}
              >
                {detail.status.toUpperCase()}
              </Tag>
              <ContainerStatusTag status={detail.status} containerName={detail.containerName} hasContainer />
              <Tag bordered={false}>{detail.proxyType.toUpperCase()}</Tag>
              <Tag bordered={false} color={detail.enabled ? 'success' : 'default'}>
                {detail.enabled ? 'Đang bật' : 'Đã tắt'}
              </Tag>
              <Tag bordered={false}>{detail.username}</Tag>
            </DrawerStatusBand>

            <DrawerSection title="Endpoints">
              <Flex vertical gap={12}>
                {detail.proxyType !== 'socks5' && (
                  <div>
                    <Text type="secondary" style={{ fontSize: 12 }}>HTTP</Text>
                    <div style={{ marginTop: 6 }}>
                      <ProxyEndpoint row={{
                        publicIp: detail.publicIp,
                        pppoeIdx: detail.pppoeIdx,
                        index: detail.pppoeIdx,
                        username: detail.username,
                        password: detail.password,
                        extHttpPort: detail.extHttpPort,
                        extSocksPort: detail.extSocksPort,
                        proxyType: detail.proxyType,
                      }} kind="http" onCopy={copyToClipboard} />
                    </div>
                  </div>
                )}
                {detail.proxyType !== 'http' && (
                  <div>
                    <Text type="secondary" style={{ fontSize: 12 }}>SOCKS5</Text>
                    <div style={{ marginTop: 6 }}>
                      <ProxyEndpoint row={{
                        publicIp: detail.publicIp,
                        pppoeIdx: detail.pppoeIdx,
                        index: detail.pppoeIdx,
                        username: detail.username,
                        password: detail.password,
                        extHttpPort: detail.extHttpPort,
                        extSocksPort: detail.extSocksPort,
                        proxyType: detail.proxyType,
                      }} kind="socks5" onCopy={copyToClipboard} />
                    </div>
                  </div>
                )}
              </Flex>
            </DrawerSection>

            <DrawerSection title="Đăng nhập">
              <Space>
                <Text code>{detail.username}</Text>
                <Button
                  size="small"
                  icon={<EyeOutlined />}
                  onClick={async () => {
                    try {
                      const pw = await revealPassword(detail.id);
                      copyToClipboard(pw, 'Đã copy password');
                    } catch { /* upstream */ }
                  }}
                >
                  Password
                </Button>
                <Button
                  size="small"
                  icon={<CopyOutlined />}
                  onClick={async () => {
                    try {
                      const pw = await revealPassword(detail.id);
                      copyToClipboard(`${detail.username}:${pw}`, 'Đã copy user:pass');
                    } catch { /* upstream */ }
                  }}
                >
                  user:pass
                </Button>
              </Space>
            </DrawerSection>

            <DrawerSection title="Traffic live">
              <ProxyTrafficMini metrics={detailMetrics} />
            </DrawerSection>

            <DrawerSection title="Thông tin kỹ thuật">
              <DrawerKvGrid>
                <DrawerKv label="Container" icon={<ApiOutlined />}>
                  {detail.containerName}
                </DrawerKv>
                <DrawerKv label="Veth">
                  <Text code>{detail.vethName}</Text>
                </DrawerKv>
                <DrawerKv label="Veth IP">
                  <Text code>{detail.vethIp}</Text>
                </DrawerKv>
                <DrawerKv label="WAN uptime">
                  {detailWan?.uptime || '—'}
                </DrawerKv>
                <DrawerKv label="Latency">
                  {detail.lastLatencyMs ? `${detail.lastLatencyMs} ms` : '—'}
                </DrawerKv>
                <DrawerKv label="HTTP port">
                  {detail.extHttpPort ? `:${detail.extHttpPort}` : '—'}
                </DrawerKv>
                <DrawerKv label="SOCKS port">
                  {detail.extSocksPort ? `:${detail.extSocksPort}` : '—'}
                </DrawerKv>
              </DrawerKvGrid>
            </DrawerSection>

            <DrawerSection title="Hành động">
              <Space wrap>
                <Button type="primary" onClick={() => openAnalytics(detail)}>Analytics</Button>
                <Button onClick={() => testOne(detail.id)} loading={busy === detail.id}>Test</Button>
                <Button onClick={() => reloadOne(detail.id)} loading={busy === detail.id}>Reload IP</Button>
                <Button onClick={() => showLogs(detail)}>Logs</Button>
                <Button onClick={() => openEdit(detail)}>Sửa</Button>
              </Space>
            </DrawerSection>
          </>
        )}
      </AppDrawer>

      <AppDrawer
        open={!!logsTarget}
        onClose={() => setLogsTarget(null)}
        width="xl"
        className="app-drawer--logs"
        icon={<FileTextOutlined />}
        title={logsTarget ? 'Container logs' : 'Logs'}
        subtitle={logsTarget?.containerName}
      >
        {logsLoading ? <Skeleton active paragraph={{ rows: 8 }} /> : (
          <pre className="proxy-logs-pre">{logsText || '(empty)'}</pre>
        )}
      </AppDrawer>
    </ProxyPageShell>
  );
}