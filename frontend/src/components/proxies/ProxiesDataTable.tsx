import {
  Table, Button, Space, Tag, Switch, Tooltip, Dropdown, Flex, Typography, type TablePaginationConfig,
} from 'antd';
import {
  GlobalOutlined, ThunderboltOutlined, ReloadOutlined, MoreOutlined,
  EyeOutlined, BarChartOutlined, FileTextOutlined, EditOutlined,
  CheckCircleOutlined, PauseCircleOutlined, WarningOutlined, SyncOutlined,
  TeamOutlined, ArrowUpOutlined, ArrowDownOutlined,
} from '@ant-design/icons';
import type { ProxyUser, WanInfo } from '../../services/api';
import type { LiveMetrics } from '../../types/proxies';
import ProxyEndpoint from '../ProxyEndpoint';
import ContainerStatusTag from '../ContainerStatusTag';
import { HTTP_PORT_BASE, SOCKS_PORT_BASE } from '../../lib/proxyUtils';
import { formatBps } from '../../lib/proxiesFormat';

const { Text } = Typography;

const STATUS_TAG: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
  running: { color: 'success', icon: <CheckCircleOutlined />, label: 'RUNNING' },
  stopped: { color: 'default', icon: <PauseCircleOutlined />, label: 'STOPPED' },
  error: { color: 'error', icon: <WarningOutlined />, label: 'ERROR' },
  pending: { color: 'processing', icon: <SyncOutlined spin />, label: 'PENDING' },
};

interface Props {
  data: ProxyUser[];
  loading?: boolean;
  selected: number[];
  busyId: number | null;
  metricsMap: Record<number, LiveMetrics>;
  wanByIdx: Map<number, WanInfo>;
  pagination: TablePaginationConfig;
  onSelect: (ids: number[]) => void;
  onCopy: (text: string, label?: string) => void;
  onToggle: (proxy: ProxyUser) => void;
  onTest: (id: number) => void;
  onReloadIp: (id: number) => void;
  onDetail: (proxy: ProxyUser) => void;
  onAnalytics: (proxy: ProxyUser) => void;
  onLogs: (proxy: ProxyUser) => void;
  onEdit: (proxy: ProxyUser) => void;
  onRevealPassword: (id: number) => Promise<string>;
  emptyNode: React.ReactNode;
}

function proxyRow(r: ProxyUser) {
  return {
    publicIp: r.publicIp,
    pppoeIdx: r.pppoeIdx,
    index: r.pppoeIdx,
    username: r.username,
    password: r.password,
    extHttpPort: r.extHttpPort,
    extSocksPort: r.extSocksPort,
    proxyType: r.proxyType,
  };
}

function TrafficCell({ metrics }: { metrics?: LiveMetrics | null }) {
  if (!metrics) return <Text type="secondary" style={{ fontSize: 12 }}>—</Text>;
  const active = (metrics.rxBps ?? 0) > 0 || (metrics.txBps ?? 0) > 0;
  return (
    <Flex vertical gap={2}>
      <Text style={{ fontSize: 12 }}>
        <TeamOutlined style={{ marginRight: 4, color: '#8c8c8c' }} />
        {metrics.clients}
      </Text>
      <Text type={active ? undefined : 'secondary'} style={{ fontSize: 11, fontFamily: 'monospace' }}>
        <ArrowUpOutlined style={{ color: '#52c41a', marginRight: 2 }} />
        {formatBps(metrics.txBps)}
      </Text>
      <Text type={active ? undefined : 'secondary'} style={{ fontSize: 11, fontFamily: 'monospace' }}>
        <ArrowDownOutlined style={{ color: '#1677ff', marginRight: 2 }} />
        {formatBps(metrics.rxBps)}
      </Text>
    </Flex>
  );
}

export default function ProxiesDataTable({
  data,
  loading,
  selected,
  busyId,
  metricsMap,
  wanByIdx,
  pagination,
  onSelect,
  onCopy,
  onToggle,
  onTest,
  onReloadIp,
  onDetail,
  onAnalytics,
  onLogs,
  onEdit,
  onRevealPassword,
  emptyNode,
}: Props) {
  const columns = [
    {
      title: 'PPPoE',
      key: 'wan',
      width: 140,
      fixed: 'left' as const,
      render: (_: unknown, r: ProxyUser) => (
        <Flex vertical gap={4}>
          <Tag color="geekblue" icon={<GlobalOutlined />} bordered={false}>{r.pppoeName}</Tag>
          <Tag bordered={false} color={r.proxyType === 'both' ? 'blue' : r.proxyType === 'http' ? 'geekblue' : 'magenta'}>
            {r.proxyType.toUpperCase()}
          </Tag>
        </Flex>
      ),
      sorter: (a: ProxyUser, b: ProxyUser) => a.pppoeIdx - b.pppoeIdx,
      defaultSortOrder: 'ascend' as const,
    },
    {
      title: 'IP public',
      key: 'ip',
      width: 148,
      render: (_: unknown, r: ProxyUser) => (
        r.publicIp
          ? (
            <Tooltip title="Client kết nối qua IP egress của proxy">
              <span className="proxy-endpoint-chip proxy-endpoint-chip--http" style={{ padding: '2px 8px', borderRadius: 4 }}>
                {r.publicIp}
              </span>
            </Tooltip>
          )
          : <Text type="secondary">—</Text>
      ),
    },
    {
      title: 'Trạng thái',
      key: 'status',
      width: 108,
      render: (_: unknown, r: ProxyUser) => {
        const m = STATUS_TAG[r.status] ?? { color: 'default', icon: undefined, label: r.status?.toUpperCase() };
        return <Tag color={m.color} icon={m.icon} bordered={false}>{m.label}</Tag>;
      },
    },
    {
      title: 'Uptime',
      key: 'uptime',
      width: 96,
      render: (_: unknown, r: ProxyUser) => {
        const up = wanByIdx.get(r.pppoeIdx)?.uptime;
        return (
          <Text type={up ? undefined : 'secondary'} style={{ fontSize: 12 }}>
            {up || '—'}
          </Text>
        );
      },
    },
    {
      title: 'Container',
      key: 'container',
      width: 108,
      render: (_: unknown, r: ProxyUser) => (
        <ContainerStatusTag
          status={r.status}
          containerName={r.containerName}
          hasContainer
        />
      ),
    },
    {
      title: `HTTP :${HTTP_PORT_BASE}+N`,
      key: 'http',
      width: 108,
      render: (_: unknown, r: ProxyUser) => (
        r.proxyType !== 'socks5'
          ? <ProxyEndpoint row={proxyRow(r)} kind="http" onCopy={onCopy} proxyId={r.id} revealPassword={onRevealPassword} compact />
          : <Text type="secondary">—</Text>
      ),
    },
    {
      title: `SOCKS :${SOCKS_PORT_BASE}+N`,
      key: 'socks',
      width: 108,
      render: (_: unknown, r: ProxyUser) => (
        r.proxyType !== 'http'
          ? <ProxyEndpoint row={proxyRow(r)} kind="socks5" onCopy={onCopy} proxyId={r.id} revealPassword={onRevealPassword} compact />
          : <Text type="secondary">—</Text>
      ),
    },
    {
      title: 'User',
      key: 'user',
      width: 96,
      render: (_: unknown, r: ProxyUser) => (
        r.username ? <Text code style={{ fontSize: 12 }}>{r.username}</Text> : <Text type="secondary">—</Text>
      ),
    },
    {
      title: 'Traffic',
      key: 'traffic',
      width: 108,
      render: (_: unknown, r: ProxyUser) => <TrafficCell metrics={metricsMap[r.id]} />,
    },
    {
      title: 'Latency',
      key: 'lat',
      width: 84,
      render: (_: unknown, r: ProxyUser) => (
        <Text type={r.lastLatencyMs ? undefined : 'secondary'} style={{ fontSize: 13 }}>
          {r.lastLatencyMs ? `${r.lastLatencyMs} ms` : '—'}
        </Text>
      ),
    },
    {
      title: 'Bật',
      key: 'toggle',
      width: 72,
      render: (_: unknown, r: ProxyUser) => (
        <Switch
          size="small"
          checked={r.enabled}
          loading={busyId === r.id}
          onChange={() => onToggle(r)}
        />
      ),
    },
    {
      title: '',
      key: 'actions',
      width: 148,
      fixed: 'right' as const,
      render: (_: unknown, r: ProxyUser) => (
        <Space size={4}>
          <Tooltip title="Test proxy">
            <Button size="small" icon={<ThunderboltOutlined />}
              loading={busyId === r.id} onClick={() => onTest(r.id)} />
          </Tooltip>
          <Tooltip title="Reload IP">
            <Button size="small" icon={<ReloadOutlined />}
              loading={busyId === r.id} onClick={() => onReloadIp(r.id)} />
          </Tooltip>
          <Tooltip title="Analytics">
            <Button size="small" icon={<BarChartOutlined />} onClick={() => onAnalytics(r)} />
          </Tooltip>
          <Dropdown menu={{
            items: [
              { key: 'detail', label: 'Chi tiết proxy', onClick: () => onDetail(r) },
              { key: 'logs', label: 'Container logs', icon: <FileTextOutlined />, onClick: () => onLogs(r) },
              { key: 'edit', label: 'Sửa proxy', icon: <EditOutlined />, onClick: () => onEdit(r) },
              { type: 'divider' },
              { key: 'copy_http', label: 'Copy HTTP URL', disabled: !r.publicIp || r.proxyType === 'socks5',
                onClick: async () => {
                  try {
                    const pw = await onRevealPassword(r.id);
                    const url = `http://${r.username}:${pw}@${r.publicIp}:${r.extHttpPort}`;
                    onCopy(url, 'Đã copy HTTP URL');
                  } catch { /* handled upstream */ }
                } },
              { key: 'copy_socks', label: 'Copy SOCKS URL', disabled: !r.publicIp || r.proxyType === 'http',
                onClick: async () => {
                  try {
                    const pw = await onRevealPassword(r.id);
                    const url = `socks5://${r.username}:${pw}@${r.publicIp}:${r.extSocksPort}`;
                    onCopy(url, 'Đã copy SOCKS URL');
                  } catch { /* handled upstream */ }
                } },
              {
                key: 'pass',
                label: 'Copy password',
                icon: <EyeOutlined />,
                onClick: async () => {
                  try {
                    const pw = await onRevealPassword(r.id);
                    onCopy(pw, 'Đã copy password');
                  } catch { /* handled upstream */ }
                },
              },
            ],
          }}>
            <Button size="small" icon={<MoreOutlined />} />
          </Dropdown>
        </Space>
      ),
    },
  ];

  return (
    <Table
      rowKey="id"
      loading={loading}
      size="middle"
      dataSource={data}
      columns={columns}
      rowSelection={{
        selectedRowKeys: selected,
        onChange: (keys) => onSelect(keys as number[]),
      }}
      pagination={pagination}
      scroll={{ x: 1480 }}
      locale={{ emptyText: emptyNode }}
      onRow={(r) => ({
        onClick: () => onDetail(r),
        style: { cursor: 'pointer' },
      })}
    />
  );
}