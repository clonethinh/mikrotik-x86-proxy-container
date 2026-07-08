import { useEffect, useState, useMemo, useCallback } from 'react';
import {
  Table, Tag, Typography, Card, Space, Statistic, Row, Col,
  Button, Switch, App, Tooltip, Progress, Modal, Alert, Input, Segmented, Popconfirm, Drawer,
} from 'antd';
import {
  GlobalOutlined, PlayCircleOutlined, PauseCircleOutlined, ThunderboltOutlined,
  CheckCircleOutlined, CloseCircleOutlined, RocketOutlined, ApiOutlined,
} from '@ant-design/icons';
import { api, WanInfo } from '../services/api';
import { useWSEvent } from '../services/ws';
import { useTablePagination } from '../hooks/useTablePagination';

const { Title, Text } = Typography;

interface WanActionEvent {
  pppoeIdx?: number;
  pppoeName?: string;
  action?: 'enable' | 'disable';
  status?: string;
  publicIp?: string | null;
  proxyId?: number | null;
  proxyCreated?: boolean;
  error?: string | null;
  durationMs?: number;
  total?: number;
  done?: number;
  succeeded?: number;
  failed?: number;
}

interface BulkProgress {
  total: number;
  done: number;
  succeeded: number;
  failed: number;
  visible: boolean;
}

function wanLabel(p: WanActionEvent): string {
  return p.pppoeName || (p.pppoeIdx != null ? `pppoe-out${p.pppoeIdx}` : 'PPPoE');
}

export default function WanPage() {
  const { message: msgApi } = App.useApp();
  const [wans, setWans] = useState<WanInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selected, setSelected] = useState<number[]>([]);
  const [busyIdx, setBusyIdx] = useState<number | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [progress, setProgress] = useState<BulkProgress>({ total: 0, done: 0, succeeded: 0, failed: 0, visible: false });
  const [resultsDrawer, setResultsDrawer] = useState<{ open: boolean; results: any[]; title: string }>({ open: false, results: [], title: '' });
  const [creatingPppoe, setCreatingPppoe] = useState(false);

  const load = useCallback(async () => {
    try { setWans(await api.get<WanInfo[]>('/api/wan')); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const clearWanToasts = useCallback((pppoeIdx?: number) => {
    msgApi.destroy('wan-create');
    if (pppoeIdx != null) msgApi.destroy(`wan-${pppoeIdx}`);
  }, [msgApi]);

  const handleWanAction = useCallback((p: WanActionEvent) => {
    const name = wanLabel(p);
    const toastKey = p.pppoeIdx != null ? `wan-${p.pppoeIdx}` : 'wan-create';

    if (p.action === 'enable') {
      if (p.status === 'starting') {
        msgApi.loading({ content: `Đang bật ${name}…`, duration: 0, key: toastKey });
        if (toastKey !== 'wan-create') {
          msgApi.loading({ content: `Đang bật ${name}…`, duration: 0, key: 'wan-create' });
        }
      } else if (p.status === 'pppoe-up') {
        msgApi.loading({ content: `${name} UP ${p.publicIp || ''} — đang setup proxy…`, duration: 0, key: toastKey });
      } else if (p.status === 'creating-proxy' || p.status === 'applying-proxy') {
        const step = p.status === 'creating-proxy' ? 'tạo proxy' : 'apply proxy';
        msgApi.loading({ content: `${name}: đang ${step}…`, duration: 0, key: toastKey });
      } else if (p.status === 'done') {
        clearWanToasts(p.pppoeIdx);
        setCreatingPppoe(false);
        setBusyIdx(null);
        load();
        const ms = p.durationMs ? ` (${(p.durationMs / 1000).toFixed(1)}s)` : '';
        const proxyPart = p.proxyCreated ? ' · proxy mới' : (p.proxyId ? ' · proxy OK' : '');
        const ipPart = p.publicIp ? ` · ${p.publicIp}` : ' · chờ IP WAN';
        msgApi.success(`${name} bật${ipPart}${proxyPart}${ms}`);
      } else if (p.status === 'error') {
        clearWanToasts(p.pppoeIdx);
        setCreatingPppoe(false);
        setBusyIdx(null);
        load();
        msgApi.error(`${name}: ${p.error || 'lỗi'}`);
      }
    }

    if (p.action === 'disable' && (p.status === 'done' || p.status === 'error')) {
      if (p.pppoeIdx != null) msgApi.destroy(`wan-${p.pppoeIdx}`);
      setBusyIdx(null);
      load();
      if (p.status === 'error') msgApi.error(`${name}: ${p.error || 'lỗi'}`);
    }
  }, [clearWanToasts, load, msgApi]);

  useWSEvent(
    (msg) => msg.type === 'wan.sync' || msg.type === 'wan.action' || msg.type === 'wan.bulk' || msg.type === 'wan.created',
    (msg) => {
      if (msg.type === 'wan.action' && msg.payload) {
        handleWanAction(msg.payload as WanActionEvent);
      }
      if (msg.type === 'wan.sync' || msg.type === 'wan.created') {
        load();
      }
      if (msg.type === 'wan.internet-up' && msg.payload) {
        const p = msg.payload as { pppoeName?: string; publicIp?: string; pingMs?: number };
        if (p.pppoeName) msgApi.destroy(`wan-inet-${p.pppoeName}`);
        msgApi.success(`${p.pppoeName || 'WAN'} có internet · ${p.publicIp}${p.pingMs != null ? ` · ping ${p.pingMs}ms` : ''}`);
        load();
      }
      if (msg.type === 'wan.internet-pending' && msg.payload) {
        const p = msg.payload as { pppoeName?: string; publicIp?: string };
        msgApi.loading({
          content: `${p.pppoeName || 'WAN'} ${p.publicIp || ''} — chờ internet…`,
          duration: 0,
          key: `wan-inet-${p.pppoeName}`,
        });
      }
      if (msg.type === 'wan.bulk' && msg.payload) {
        const p = msg.payload as WanActionEvent;
        if (p.status === 'done') {
          setProgress({
            total: p.total || 0,
            done: p.total || 0,
            succeeded: p.succeeded || 0,
            failed: p.failed || 0,
            visible: true,
          });
          load();
        }
      }
    },
    [handleWanAction, load],
  );

  const createNextPppoe = async (autoEnable = true) => {
    setCreatingPppoe(true);
    try {
      msgApi.loading({
        content: autoEnable ? 'Đang tạo pppoe-out…' : 'Đang tạo pppoe-out…',
        duration: 0,
        key: 'wan-create',
      });
      const r = await api.post<any>('/api/wan/create-next', { enable: autoEnable });
      if (r.error) {
        clearWanToasts();
        setCreatingPppoe(false);
        msgApi.error(r.error);
        return;
      }
      load();
      if (r.enabling || r.accepted) {
        msgApi.loading({
          content: `Đã tạo ${r.name} — đang bật…`,
          duration: 0,
          key: 'wan-create',
        });
        return;
      }
      clearWanToasts();
      setCreatingPppoe(false);
      const action = r.created ? 'đã tạo' : 'đã có sẵn';
      msgApi.success(`${r.name} ${action}`);
    } catch (e: any) {
      clearWanToasts();
      setCreatingPppoe(false);
      msgApi.error(e.message);
    }
  };

  const up = wans.filter(w => w.running).length;
  const down = wans.length - up;

  const filtered = useMemo(() => {
    return wans.filter(w => {
      if (statusFilter !== 'all' && String(w.running) !== statusFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!w.name.toLowerCase().includes(q) && !(w.publicIp || '').includes(search)) return false;
      }
      return true;
    });
  }, [wans, search, statusFilter]);

  const { pagination: tablePagination } = useTablePagination(
    20,
    ['10', '20', '50', '100'],
    total => `${total} WAN`,
    [search, statusFilter],
  );

  const toggleOne = async (w: WanInfo, enable: boolean) => {
    setBusyIdx(w.index);
    try {
      if (enable) {
        msgApi.loading({ content: `Đang bật ${w.name}…`, duration: 0, key: `wan-${w.index}` });
        const r = await api.post<any>(`/api/wan/${w.index}/enable`);
        if (r.error) {
          msgApi.destroy(`wan-${w.index}`);
          msgApi.error(`${w.name}: ${r.error}`);
          setBusyIdx(null);
          return;
        }
        if (r.accepted || r.enabling) {
          return;
        }
        msgApi.destroy(`wan-${w.index}`);
        const ipPart = r.publicIp ? ` · IP ${r.publicIp}` : '';
        msgApi.success(`${w.name} UP${ipPart}`);
        load();
      } else {
        await api.post(`/api/wan/${w.index}/disable`);
        msgApi.success(`${w.name} đã tắt`);
        load();
      }
    } catch (e: any) {
      msgApi.destroy(`wan-${w.index}`);
      msgApi.error(e.message);
    } finally {
      if (!enable) setBusyIdx(null);
    }
  };

  const bulkEnable = async () => {
    if (selected.length === 0) return;
    if (selected.length > 50) {
      msgApi.warning('Tối đa 50 PPPoE/lần');
      return;
    }
    setBulkBusy(true);
    setProgress({ total: selected.length, done: 0, succeeded: 0, failed: 0, visible: true });
    try {
      const r = await api.post<any>('/api/wan/bulk-enable', { indices: selected });
      const succ = r.summary?.succeeded ?? 0;
      const fail = r.summary?.failed ?? 0;
      setProgress({ total: r.summary?.total ?? selected.length, done: r.summary?.total ?? selected.length, succeeded: succ, failed: fail, visible: true });
      msgApi[fail === 0 ? 'success' : 'warning'](
        `Bulk enable: ${succ} OK / ${fail} FAIL · ${(r.summary?.durationMs/1000).toFixed(1)}s`
      );
      if (fail > 0) {
        setResultsDrawer({ open: true, results: r.results.filter((x: any) => x.error), title: `${fail} PPPoE lỗi` });
      }
      setSelected([]);
      load();
    } catch (e: any) {
      msgApi.error(e.message);
    } finally {
      setBulkBusy(false);
    }
  };

  const bulkDisable = async () => {
    if (selected.length === 0) return;
    if (selected.length > 50) {
      msgApi.warning('Tối đa 50 PPPoE/lần');
      return;
    }
    setBulkBusy(true);
    try {
      const r = await api.post<any>('/api/wan/bulk-disable', { indices: selected });
      const succ = r.summary?.succeeded ?? 0;
      const fail = r.summary?.failed ?? 0;
      msgApi[fail === 0 ? 'success' : 'warning'](
        `Bulk disable: ${succ} OK / ${fail} FAIL · ${(r.summary?.durationMs / 1000).toFixed(1)}s`,
      );
      setSelected([]);
      load();
    } catch (e: any) {
      msgApi.error(e.message);
    } finally {
      setBulkBusy(false);
    }
  };

  const columns = [
    {
      title: 'Interface', dataIndex: 'name', key: 'name', width: 130,
      render: (v: string) => (
        <Space size={4}>
          <Tag color="purple" icon={<GlobalOutlined />}>{v}</Tag>
        </Space>
      ),
    },
    {
      title: 'Trạng thái', key: 'status', width: 110,
      render: (_: unknown, r: WanInfo) => (
        r.running
          ? <Tag color="success" icon={<CheckCircleOutlined />}>UP</Tag>
          : <Tag color="error" icon={<CloseCircleOutlined />}>DOWN</Tag>
      ),
    },
    {
      title: 'IP Public', dataIndex: 'publicIp', key: 'publicIp', width: 150,
      render: (v: string | null) => (v ? <Tag color="blue">{v}</Tag> : <Tag>—</Tag>),
    },
    {
      title: 'Uptime', dataIndex: 'uptime', key: 'uptime', width: 120,
      render: (v: string) => v || '—',
    },
    {
      title: 'User', dataIndex: 'user', key: 'user', width: 120,
      render: (v: string) => <span style={{ fontSize: 12 }}>{v}</span>,
    },
    {
      title: 'Proxy', key: 'proxy', width: 240,
      render: (_: unknown, r: WanInfo) => (
        r.hasProxy
          ? (
            <Space size={4} wrap>
              <Tag color={r.proxyStatus === 'running' ? 'success' : 'default'}>{r.proxyStatus || '—'}</Tag>
              {r.proxyEnabled ? <Tag color="green">ON</Tag> : <Tag>OFF</Tag>}
              <Tag color="cyan" icon={<ApiOutlined />}>HTTP:{30055 + r.index}</Tag>
              <Tag color="magenta">SOCKS:{31055 + r.index}</Tag>
            </Space>
          )
          : <Tag color="default">Chưa có proxy</Tag>
      ),
    },
    {
      title: 'Bật/Tắt', key: 'enable', width: 130, fixed: 'right' as const,
      render: (_: unknown, r: WanInfo) => {
        const isLoading = busyIdx === r.index;
        return (
          <Space size={4}>
            <Tooltip title={r.running ? 'Tắt PPPoE (giữ proxy)' : 'Bật PPPoE + tự tạo proxy nếu chưa có'}>
              <Switch
                checked={r.running}
                loading={isLoading}
                onChange={(checked: boolean) => toggleOne(r, checked)}
                size="small"
                checkedChildren={<RocketOutlined />}
                unCheckedChildren={<PauseCircleOutlined />}
              />
            </Tooltip>
          </Space>
        );
      },
    },
  ];

  return (
    <div>
      <Title level={3}>WAN Status</Title>
      <Text type="secondary">
        Realtime · PPPoE up/down & IP public · Tạo nhanh pppoe-outX · Bật/Tắt kèm auto-proxy (hub 2×50)
      </Text>

      <div style={{ height: 16 }} />

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col xs={12} md={6}><Card><Statistic title="Tổng WAN" value={wans.length} prefix={<GlobalOutlined />} /></Card></Col>
        <Col xs={12} md={6}><Card><Statistic title="UP" value={up} valueStyle={{ color: '#52c41a' }} prefix={<CheckCircleOutlined />} /></Card></Col>
        <Col xs={12} md={6}><Card><Statistic title="DOWN" value={down} valueStyle={{ color: '#ff4d4f' }} prefix={<CloseCircleOutlined />} /></Card></Col>
        <Col xs={12} md={6}>
          <Card>
            <Statistic
              title="Có proxy"
              value={wans.filter(w => w.hasProxy).length}
              prefix={<ApiOutlined />}
              valueStyle={{ color: '#1677ff' }}
            />
          </Card>
        </Col>
      </Row>

      {progress.visible && progress.total > 0 && (
        <Card size="small" style={{ marginBottom: 12, background: progress.failed > 0 ? '#fff7e6' : '#f6ffed' }}>
          <Space direction="vertical" style={{ width: '100%' }} size={4}>
            <Space wrap>
              <Text strong>Bulk đang chạy / đã xong:</Text>
              <Tag color="blue">{progress.done}/{progress.total}</Tag>
              <Tag color="success">{progress.succeeded} OK</Tag>
              {progress.failed > 0 && <Tag color="error">{progress.failed} FAIL</Tag>}
            </Space>
            <Progress
              percent={Math.round((progress.done / progress.total) * 100)}
              status={progress.failed > 0 ? 'exception' : 'success'}
              size="small"
            />
          </Space>
        </Card>
      )}

      <Space style={{ marginBottom: 12, flexWrap: 'wrap' }}>
        <Input.Search
          placeholder="Tìm PPPoE / IP…"
          allowClear
          style={{ width: 200 }}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <Segmented
          options={[
            { label: 'Tất cả', value: 'all' },
            { label: 'UP', value: 'true' },
            { label: 'DOWN', value: 'false' },
          ]}
          value={statusFilter}
          onChange={(v) => setStatusFilter(v as string)}
          size="small"
        />
        <Button onClick={load}>Refresh</Button>
        <Tooltip title="Clone pppoe-out1 → tạo index tiếp theo, bật PPPoE + auto-proxy">
          <Button
            type="primary"
            icon={<ThunderboltOutlined />}
            loading={creatingPppoe}
            onClick={() => createNextPppoe(true)}
          >
            + Tạo PPPoE tiếp
          </Button>
        </Tooltip>
        <Tooltip title="Chỉ tạo interface, chưa bật dial">
          <Button loading={creatingPppoe} onClick={() => createNextPppoe(false)}>
            Tạo (chưa bật)
          </Button>
        </Tooltip>
        {selected.length > 0 && (
          <>
            <Tag color="blue">Đã chọn {selected.length}</Tag>
            <Button type="primary" icon={<RocketOutlined />} loading={bulkBusy} onClick={bulkEnable}>
              Bật {selected.length} PPPoE (+ auto-proxy)
            </Button>
            <Button icon={<PauseCircleOutlined />} loading={bulkBusy} onClick={bulkDisable}>
              Tắt {selected.length}
            </Button>
          </>
        )}
      </Space>

      <Card styles={{ body: { padding: 0 } }}>
        <Table
          rowKey="name"
          loading={loading}
          dataSource={filtered}
          columns={columns}
          rowSelection={{
            selectedRowKeys: selected,
            onChange: (keys) => setSelected(keys as number[]),
            getCheckboxProps: () => ({}),
          }}
          pagination={tablePagination}
          scroll={{ x: 1100 }}
          size="small"
        />
      </Card>

      <Drawer
        title={resultsDrawer.title}
        open={resultsDrawer.open}
        onClose={() => setResultsDrawer({ ...resultsDrawer, open: false })}
        width={560}
      >
        {resultsDrawer.results.map((r: { pppoeIdx?: number; pppoeName?: string; error?: string }, i: number) => (
          <Alert
            key={i}
            type="error"
            showIcon
            message={`pppoe-out${r.pppoeIdx ?? r.pppoeName}`}
            description={r.error}
            style={{ marginBottom: 8 }}
          />
        ))}
      </Drawer>
    </div>
  );
}