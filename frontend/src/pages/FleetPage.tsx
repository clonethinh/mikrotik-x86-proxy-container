import { useEffect, useMemo, useState } from 'react';
import {
  Table, Button, Space, Tag, Switch, Input, Modal, Form, Select,
  Card, Typography, App, Segmented, Tooltip, Drawer, Dropdown, Flex, Divider,
} from 'antd';
import {
  PlusOutlined, ReloadOutlined, ThunderboltOutlined, CopyOutlined,
  GlobalOutlined, ApiOutlined, RocketOutlined, PauseCircleOutlined,
  CheckCircleOutlined, CloseCircleOutlined, MoreOutlined, EyeOutlined,
  CloudServerOutlined,
} from '@ant-design/icons';
import { api, WanInfo } from '../services/api';
import { useWSEvent } from '../services/ws';
import ProxyEndpoint from '../components/ProxyEndpoint';
import ContainerStatusTag from '../components/ContainerStatusTag';
import ProxyPageShell, { ProxyCode } from '../components/proxy/ProxyPageShell';
import ProxyStatsRow from '../components/proxy/ProxyStatsRow';
import { extHttpPort, extSocksPort, HTTP_PORT_BASE, SOCKS_PORT_BASE } from '../lib/proxyUtils';
import { copyText } from '../lib/clipboard';
import { useTablePagination } from '../hooks/useTablePagination';

const { Text } = Typography;

type FleetRow = WanInfo;

export default function FleetPage() {
  const { message: msgApi } = App.useApp();
  const [fleet, setFleet] = useState<FleetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<string>('all');
  const [selected, setSelected] = useState<number[]>([]);
  const [busyIdx, setBusyIdx] = useState<number | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [detailRow, setDetailRow] = useState<FleetRow | null>(null);
  const [createForm] = Form.useForm();

  const load = async () => {
    try {
      setFleet(await api.get<FleetRow[]>('/api/wan'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  useWSEvent(
    (msg) => msg.type?.startsWith('proxy.') || msg.type?.startsWith('wan.'),
    () => load(),
  );

  const workflowTag = (r: FleetRow) => {
    const s = r.workflowState;
    if (!s || s === 'active') return null;
    const map: Record<string, { color: string; label: string }> = {
      discovered: { color: 'cyan', label: 'Mới' },
      countdown: { color: 'processing', label: 'Đếm ngược' },
      provisioning: { color: 'blue', label: 'Đang tạo' },
      queued: { color: 'orange', label: 'Hàng đợi' },
      stale: { color: 'warning', label: 'Stale' },
      gone: { color: 'default', label: 'Đã rời' },
      error: { color: 'error', label: 'Lỗi' },
      skipped: { color: 'default', label: 'Đã hủy' },
    };
    const m = map[s];
    if (!m) return null;
    const extra = s === 'countdown' && r.countdownEnds
      ? ` ${Math.max(0, Math.ceil((new Date(r.countdownEnds).getTime() - Date.now()) / 1000))}s`
      : '';
    return <Tag color={m.color} bordered={false}>{m.label}{extra}</Tag>;
  };

  const stats = useMemo(() => ({
    total: fleet.length,
    up: fleet.filter(f => f.running).length,
    withContainer: fleet.filter(f => f.hasContainer).length,
    withDb: fleet.filter(f => f.proxyId).length,
  }), [fleet]);

  const filtered = useMemo(() => fleet.filter(row => {
    if (filter === 'up' && !row.running) return false;
    if (filter === 'down' && row.running) return false;
    if (filter === 'proxy' && !row.hasContainer) return false;
    if (filter === 'noproxy' && row.hasContainer) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!row.name.includes(q) && !(row.publicIp || '').includes(q) &&
          !(row.containerName || '').includes(q)) return false;
    }
    return true;
  }), [fleet, search, filter]);

  const { pagination: tablePagination } = useTablePagination(
    15,
    ['10', '15', '30', '50'],
    total => `${total} dòng`,
    [search, filter],
  );

  const copy = async (text: string, label = 'Đã copy') => {
    try {
      await copyText(text);
      msgApi.success(label);
    } catch {
      msgApi.error('Copy thất bại — thử chọn text và Ctrl+C');
    }
  };

  const revealPassword = async (proxyId: number) => {
    const r = await api.get<{ password: string }>(`/api/proxies/${proxyId}/password`);
    return r.password;
  };

  const enableWan = async (row: FleetRow) => {
    setBusyIdx(row.index);
    try {
      msgApi.loading({ content: `Bật ${row.name} + tạo proxy…`, key: `en-${row.index}`, duration: 0 });
      const r = await api.post<{ error?: string; publicIp?: string; proxyCreated?: boolean }>(`/api/wan/${row.index}/enable`);
      msgApi.destroy(`en-${row.index}`);
      if (r.error) msgApi.error(r.error);
      else msgApi.success(`${row.name} · IP ${r.publicIp || '—'} · ${r.proxyCreated ? 'proxy mới' : 'proxy sẵn sàng'}`);
      load();
    } catch (e: unknown) {
      msgApi.destroy(`en-${row.index}`);
      msgApi.error(e instanceof Error ? e.message : 'Lỗi');
    } finally {
      setBusyIdx(null);
    }
  };

  const disableWan = async (row: FleetRow) => {
    setBusyIdx(row.index);
    try {
      await api.post(`/api/wan/${row.index}/disable`);
      msgApi.success(`${row.name} đã tắt`);
      load();
    } catch (e: unknown) {
      msgApi.error(e instanceof Error ? e.message : 'Lỗi');
    } finally {
      setBusyIdx(null);
    }
  };

  const testProxy = async (row: FleetRow) => {
    if (!row.proxyId) return msgApi.warning('Chưa có proxy trong DB — bật WAN để tạo');
    setBusyIdx(row.index);
    try {
      const r = await api.post<{ ok: boolean; latencyMs: number; exitIp: string | null; error: string | null }>(`/api/proxies/${row.proxyId}/test`);
      if (r.ok) msgApi.success(`Container OK ${r.latencyMs}ms · egress ${r.exitIp || row.publicIp}`);
      else msgApi.error(r.error || 'Test fail');
      load();
    } catch (e: unknown) {
      msgApi.error(e instanceof Error ? e.message : 'Lỗi');
    } finally {
      setBusyIdx(null);
    }
  };

  const reloadIp = async (row: FleetRow) => {
    if (!row.proxyId) return msgApi.warning('Chưa có proxy');
    setBusyIdx(row.index);
    try {
      await api.post(`/api/proxies/${row.proxyId}/reload-ip`);
      msgApi.success('Đã trigger reload IP');
      load();
    } catch (e: unknown) {
      msgApi.error(e instanceof Error ? e.message : 'Lỗi');
    } finally {
      setBusyIdx(null);
    }
  };

  const createProxy = async (vals: { pppoeIdx: number; proxyType: string }) => {
    try {
      await api.post('/api/proxies', vals);
      msgApi.success(`Đã tạo proxy cho pppoe-out${vals.pppoeIdx}`);
      setCreateOpen(false);
      createForm.resetFields();
      load();
    } catch (e: unknown) {
      msgApi.error(e instanceof Error ? e.message : 'Lỗi');
    }
  };

  const bulkEnable = async () => {
    if (!selected.length) return;
    setBulkBusy(true);
    try {
      const r = await api.post<{ summary?: { succeeded: number; failed: number } }>('/api/wan/bulk-enable', { indices: selected });
      msgApi.success(`Bulk: ${r.summary?.succeeded} OK / ${r.summary?.failed} FAIL`);
      setSelected([]);
      load();
    } catch (e: unknown) {
      msgApi.error(e instanceof Error ? e.message : 'Lỗi');
    } finally {
      setBulkBusy(false);
    }
  };

  const columns = [
    {
      title: 'PPPoE',
      key: 'wan',
      width: 140,
      fixed: 'left' as const,
      render: (_: unknown, r: FleetRow) => (
        <Flex vertical gap={4}>
          <Tag color="geekblue" icon={<GlobalOutlined />} bordered={false}>{r.name}</Tag>
          {workflowTag(r)}
        </Flex>
      ),
      sorter: (a: FleetRow, b: FleetRow) => a.index - b.index,
      defaultSortOrder: 'ascend' as const,
    },
    {
      title: 'IP public',
      key: 'ip',
      width: 148,
      render: (_: unknown, r: FleetRow) => (
        r.publicIp
          ? (
            <Tooltip title="Client kết nối qua IP động của PPPoE này">
              <span className="proxy-endpoint-chip proxy-endpoint-chip--http" style={{ padding: '2px 8px', borderRadius: 4 }}>
                {r.publicIp}
              </span>
            </Tooltip>
          )
          : <Text type="secondary">—</Text>
      ),
    },
    {
      title: 'Link',
      key: 'status',
      width: 88,
      render: (_: unknown, r: FleetRow) => (
        r.running
          ? <Tag color="success" icon={<CheckCircleOutlined />} bordered={false}>UP</Tag>
          : <Tag color="error" icon={<CloseCircleOutlined />} bordered={false}>DOWN</Tag>
      ),
    },
    {
      title: 'Uptime',
      key: 'uptime',
      width: 100,
      render: (_: unknown, r: FleetRow) => (
        <Text type={r.uptime ? undefined : 'secondary'} style={{ fontSize: 12 }}>
          {r.uptime || '—'}
        </Text>
      ),
    },
    {
      title: 'Container',
      key: 'container',
      width: 120,
      render: (_: unknown, r: FleetRow) => (
        <ContainerStatusTag
          status={r.containerStatus}
          containerName={r.containerName}
          hasContainer={r.hasContainer}
        />
      ),
    },
    {
      title: `HTTP :${HTTP_PORT_BASE}+N`,
      key: 'http',
      width: 108,
      render: (_: unknown, r: FleetRow) => (
        <ProxyEndpoint row={r} kind="http" onCopy={copy} compact />
      ),
    },
    {
      title: `SOCKS :${SOCKS_PORT_BASE}+N`,
      key: 'socks',
      width: 108,
      render: (_: unknown, r: FleetRow) => (
        <ProxyEndpoint row={r} kind="socks5" onCopy={copy} compact />
      ),
    },
    {
      title: 'User',
      key: 'user',
      width: 96,
      render: (_: unknown, r: FleetRow) => (
        r.username ? <Text code style={{ fontSize: 12 }}>{r.username}</Text> : <Text type="secondary">—</Text>
      ),
    },
    {
      title: 'Latency',
      key: 'lat',
      width: 84,
      render: (_: unknown, r: FleetRow) => (
        <Text type={r.lastLatencyMs ? undefined : 'secondary'} style={{ fontSize: 13 }}>
          {r.lastLatencyMs ? `${r.lastLatencyMs} ms` : '—'}
        </Text>
      ),
    },
    {
      title: 'WAN',
      key: 'toggle',
      width: 88,
      render: (_: unknown, r: FleetRow) => (
        <Switch
          size="small"
          checked={r.running}
          loading={busyIdx === r.index}
          onChange={(on) => (on ? enableWan(r) : disableWan(r))}
          checkedChildren={<RocketOutlined />}
          unCheckedChildren={<PauseCircleOutlined />}
        />
      ),
    },
    {
      title: '',
      key: 'actions',
      width: 148,
      fixed: 'right' as const,
      render: (_: unknown, r: FleetRow) => (
        <Space size={4}>
          {r.workflowState === 'countdown' && (
            <Button size="small" danger loading={busyIdx === r.index}
              onClick={async () => {
                setBusyIdx(r.index);
                try {
                  await api.post(`/api/wan/${r.index}/provision/cancel`);
                  msgApi.success('Đã hủy đếm ngược');
                  load();
                } catch (e: unknown) {
                  msgApi.error(e instanceof Error ? e.message : 'Lỗi');
                } finally {
                  setBusyIdx(null);
                }
              }}>Hủy</Button>
          )}
          {!r.hasContainer && r.running && (
            <Tooltip title="Tạo proxy container">
              <Button size="small" type="primary" icon={<PlusOutlined />} loading={busyIdx === r.index}
                onClick={() => enableWan(r)} />
            </Tooltip>
          )}
          <Tooltip title="Test proxy">
            <Button size="small" icon={<ThunderboltOutlined />} disabled={!r.proxyId}
              loading={busyIdx === r.index} onClick={() => testProxy(r)} />
          </Tooltip>
          <Tooltip title="Reload IP">
            <Button size="small" icon={<ReloadOutlined />} disabled={!r.proxyId}
              loading={busyIdx === r.index} onClick={() => reloadIp(r)} />
          </Tooltip>
          <Dropdown menu={{
            items: [
              { key: 'detail', label: 'Chi tiết endpoint', onClick: () => setDetailRow(r) },
              { type: 'divider' },
              { key: 'copy_http', label: 'Copy HTTP ip:port', disabled: !r.publicIp,
                onClick: () => copy(`${r.publicIp}:${r.extHttpPort ?? extHttpPort(r.index)}`) },
              { key: 'copy_socks', label: 'Copy SOCKS ip:port', disabled: !r.publicIp,
                onClick: () => copy(`${r.publicIp}:${r.extSocksPort ?? extSocksPort(r.index)}`) },
              ...(r.proxyId ? [{
                key: 'pass',
                label: 'Copy password',
                icon: <EyeOutlined />,
                onClick: async () => {
                  try {
                    const pw = await revealPassword(r.proxyId!);
                    copy(pw, 'Đã copy password');
                  } catch (e: unknown) {
                    msgApi.error(e instanceof Error ? e.message : 'Lỗi');
                  }
                },
              }] : []),
            ],
          }}>
            <Button size="small" icon={<MoreOutlined />} />
          </Dropdown>
        </Space>
      ),
    },
  ];

  return (
    <ProxyPageShell
      title={<><CloudServerOutlined style={{ marginRight: 8, color: '#1677FF' }} />Proxy Fleet</>}
      subtitle={
        <>
          Mỗi <ProxyCode>pppoe-outN</ProxyCode> là một egress IP động + container 3proxy.
          HTTP <ProxyCode>{HTTP_PORT_BASE}+N</ProxyCode> · SOCKS <ProxyCode>{SOCKS_PORT_BASE}+N</ProxyCode>
        </>
      }
      policy={{
        message: 'Pool rotation & auto-provision',
        description: (
          <>
            Proxy bắt đầu từ <ProxyCode>pppoe-out1</ProxyCode>.
            Hub mode: 1 container <ProxyCode>proxy3p-hub</ProxyCode>, nhiều slot/IP. Proxy chỉ <ProxyCode>pppoe-out1</ProxyCode>→<ProxyCode>X</ProxyCode> — client kết nối IP egress:port.
            WAN biến mất &gt; 30 phút → dọn proxy + veth/NAT.
          </>
        ),
      }}
      stats={
        <ProxyStatsRow
          items={[
            { key: 'pppoe', title: 'PPPoE trong pool', value: stats.total, prefix: <GlobalOutlined style={{ color: '#1677FF' }} /> },
            { key: 'up', title: 'WAN đang UP', value: stats.up, valueStyle: { color: '#52C41A' } },
            { key: 'ctn', title: 'Container chạy', value: stats.withContainer, prefix: <ApiOutlined style={{ color: '#722ED1' }} /> },
            { key: 'db', title: 'Ghi trong DB', value: stats.withDb },
          ]}
        />
      }
      toolbar={
        <Card className="proxy-toolbar-card" style={{ marginBottom: 16 }}>
          <Flex gap={12} wrap="wrap" align="center" justify="space-between">
            <Flex gap={12} wrap="wrap" align="center" style={{ flex: 1 }}>
              <Input.Search
                placeholder="Tìm PPPoE, IP động, container…"
                allowClear
                style={{ width: 280, maxWidth: '100%' }}
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              <Segmented
                value={filter}
                onChange={v => setFilter(v as string)}
                options={[
                  { label: 'Tất cả', value: 'all' },
                  { label: 'UP', value: 'up' },
                  { label: 'Có proxy', value: 'proxy' },
                  { label: 'Chưa proxy', value: 'noproxy' },
                ]}
              />
            </Flex>
            <Space wrap>
              <Button icon={<ReloadOutlined />} onClick={load}>Làm mới</Button>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
                Tạo proxy
              </Button>
              {selected.length > 0 && (
                <Button type="primary" icon={<RocketOutlined />} loading={bulkBusy} onClick={bulkEnable}>
                  Bật {selected.length} WAN
                </Button>
              )}
            </Space>
          </Flex>
        </Card>
      }
    >
      <Card className="proxy-table-card" styles={{ body: { padding: 0 } }}>
        <Table
          rowKey="name"
          loading={loading}
          dataSource={filtered}
          columns={columns}
          rowSelection={{
            selectedRowKeys: selected,
            onChange: keys => setSelected(keys as number[]),
          }}
          pagination={tablePagination}
          scroll={{ x: 1280 }}
          size="middle"
        />
      </Card>

      <Modal
        title="Tạo proxy mới"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => createForm.submit()}
        okText="Tạo proxy"
        destroyOnHidden
      >
        <Form form={createForm} layout="vertical" onFinish={createProxy} initialValues={{ proxyType: 'both' }}>
          <Form.Item name="pppoeIdx" label="PPPoE interface" rules={[{ required: true }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={fleet.filter(f => !f.hasContainer).map(f => ({
                value: f.index,
                label: `${f.name} · ${f.publicIp || 'chưa có IP'} ${f.running ? '· UP' : '· DOWN'}`,
              }))}
              placeholder="Chọn pppoe-out chưa có container"
            />
          </Form.Item>
          <Form.Item name="proxyType" label="Giao thức">
            <Select options={[
              { value: 'both', label: 'HTTP + SOCKS5' },
              { value: 'http', label: 'HTTP only' },
              { value: 'socks5', label: 'SOCKS5 only' },
            ]} />
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        title={detailRow ? `${detailRow.name} · ${detailRow.publicIp || 'chưa có IP'}` : ''}
        open={!!detailRow}
        onClose={() => setDetailRow(null)}
        width={520}
      >
        {detailRow && (
          <Flex vertical gap={20}>
            <div>
              <Text type="secondary">Container</Text>
              <div style={{ marginTop: 8 }}>
                <ContainerStatusTag
                  status={detailRow.containerStatus}
                  containerName={detailRow.containerName}
                  hasContainer={detailRow.hasContainer}
                />
              </div>
            </div>
            <Divider style={{ margin: 0 }} />
            <div>
              <Text type="secondary">HTTP endpoint</Text>
              <div style={{ marginTop: 8 }}>
                <ProxyEndpoint row={detailRow} kind="http" onCopy={copy} />
              </div>
            </div>
            <div>
              <Text type="secondary">SOCKS5 endpoint</Text>
              <div style={{ marginTop: 8 }}>
                <ProxyEndpoint row={detailRow} kind="socks5" onCopy={copy} />
              </div>
            </div>
            <div>
              <Text type="secondary">Veth</Text>
              <div style={{ marginTop: 4 }}><Text code>{detailRow.vethName || '—'}</Text></div>
            </div>
            <div>
              <Text type="secondary">Uptime</Text>
              <div style={{ marginTop: 4 }}>{detailRow.uptime || '—'}</div>
            </div>
          </Flex>
        )}
      </Drawer>
    </ProxyPageShell>
  );
}