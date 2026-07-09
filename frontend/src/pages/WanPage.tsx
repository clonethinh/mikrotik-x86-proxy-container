import { useEffect, useState, useMemo, useCallback } from 'react';
import {
  Table, Tag, Typography, Card, Space, Button, Switch, App, Tooltip, Progress,
  Input, Segmented,
} from 'antd';
import AppDrawer from '../components/ui/AppDrawer';
import ProxyToolbar from '../components/ui/ProxyToolbar';
import ProxyPageShell from '../components/proxy/ProxyPageShell';
import ProxyStatsRow from '../components/proxy/ProxyStatsRow';
import { HTTP_PORT_BASE, SOCKS_PORT_BASE } from '../lib/proxyUtils';
import {
  GlobalOutlined, PauseCircleOutlined, ThunderboltOutlined,
  CheckCircleOutlined, CloseCircleOutlined, RocketOutlined, ApiOutlined, ReloadOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { api, WanInfo } from '../services/api';
import { useWSEvent } from '../services/ws';
import { useTablePagination } from '../hooks/useTablePagination';
import IpQualityTag from '../components/IpQualityTag';
import { resolveIpQuality } from '../lib/ipQuality';

const { Text } = Typography;

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

interface CreateQueueState {
  pending: number;
  processing: boolean;
  currentName?: string;
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
  const [createQueue, setCreateQueue] = useState<CreateQueueState>({ pending: 0, processing: false });

  const load = useCallback(async () => {
    try { setWans(await api.get<WanInfo[]>('/api/wan')); }
    finally { setLoading(false); }
  }, []);

  const loadCreateQueue = useCallback(async () => {
    try {
      const q = await api.get<CreateQueueState & { current?: { name?: string } | null }>('/api/wan/create-queue');
      setCreateQueue({
        pending: q.pending ?? 0,
        processing: q.processing ?? false,
        currentName: q.current?.name,
      });
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { load(); loadCreateQueue(); }, [load, loadCreateQueue]);

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
        if (p.pppoeIdx != null) msgApi.destroy(`wan-${p.pppoeIdx}`);
        setBusyIdx(null);
        load();
        const ms = p.durationMs ? ` (${(p.durationMs / 1000).toFixed(1)}s)` : '';
        const proxyPart = p.proxyCreated ? ' · proxy mới' : (p.proxyId ? ' · proxy OK' : '');
        const ipPart = p.publicIp ? ` · ${p.publicIp}` : ' · chờ IP WAN';
        msgApi.success(`${name} bật${ipPart}${proxyPart}${ms}`);
      } else if (p.status === 'error') {
        if (p.pppoeIdx != null) msgApi.destroy(`wan-${p.pppoeIdx}`);
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
    (msg) => msg.type === 'wan.sync' || msg.type === 'wan.action' || msg.type === 'wan.bulk' || msg.type === 'wan.created'
      || msg.type.startsWith('wan.create.'),
    (msg) => {
      if (msg.type === 'wan.action' && msg.payload) {
        handleWanAction(msg.payload as WanActionEvent);
      }
      if (msg.type === 'wan.sync' || msg.type === 'wan.created') {
        load();
      }
      if (msg.type === 'wan.create.queue' && msg.payload) {
        const p = msg.payload as CreateQueueState & { current?: { name?: string } | null };
        const next = {
          pending: p.pending ?? 0,
          processing: p.processing ?? false,
          currentName: p.current?.name,
        };
        setCreateQueue(next);
        if (!next.processing && next.pending === 0) {
          clearWanToasts();
        }
      }
      if (msg.type === 'wan.create.processing' && msg.payload) {
        const p = msg.payload as { name?: string; pending?: number };
        setCreateQueue(prev => ({
          ...prev,
          processing: true,
          pending: p.pending ?? prev.pending,
          currentName: p.name ?? prev.currentName,
        }));
        if (p.name) {
          msgApi.loading({
            content: `Đang xử lý ${p.name}${p.pending ? ` · còn ${p.pending} trong hàng đợi` : ''}…`,
            duration: 0,
            key: 'wan-create',
          });
        }
      }
      if (msg.type === 'wan.create.done' && msg.payload) {
        const p = msg.payload as { name?: string; enable?: boolean };
        load();
        if (p.enable) {
          msgApi.loading({
            content: `${p.name || 'PPPoE'} đã tạo — đang bật…`,
            duration: 0,
            key: 'wan-create',
          });
        } else {
          msgApi.success(`${p.name || 'PPPoE'} đã tạo`);
        }
      }
      if (msg.type === 'wan.create.error' && msg.payload) {
        const p = msg.payload as { error?: string };
        msgApi.error(`Tạo PPPoE: ${p.error || 'lỗi'}`);
      }
      if (msg.type === 'wan.create.queued' && msg.payload) {
        const p = msg.payload as { position?: number; queueSize?: number };
        setCreateQueue(prev => ({
          ...prev,
          pending: Math.max(prev.pending, (p.queueSize ?? 1) - (prev.processing ? 1 : 0)),
        }));
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
    [handleWanAction, clearWanToasts, load, msgApi],
  );

  const createNextPppoe = async (autoEnable = true) => {
    try {
      const r = await api.post<{
        error?: string;
        queued?: boolean;
        position?: number;
        queueSize?: number;
      }>('/api/wan/create-next', { enable: autoEnable });
      if (r.error) {
        msgApi.error(r.error);
        return;
      }
      if (r.queued) {
        setCreateQueue(prev => ({
          ...prev,
          pending: r.queueSize != null
            ? Math.max(0, r.queueSize - (prev.processing ? 1 : 0))
            : prev.pending + 1,
        }));
        const pos = r.position ?? r.queueSize ?? 1;
        msgApi.info(`Đã thêm vào hàng đợi · vị trí #${pos}`);
        if (!createQueue.processing) {
          msgApi.loading({ content: 'Đang xử lý hàng đợi tạo PPPoE…', duration: 0, key: 'wan-create' });
        }
        return;
      }
      load();
    } catch (e: any) {
      msgApi.error(e.message);
    }
  };

  const createQueueSize = createQueue.pending + (createQueue.processing ? 1 : 0);

  const up = wans.filter(w => w.running).length;
  const down = wans.length - up;

  const ipStats = useMemo(() => {
    let cgnat = 0;
    let bad = 0;
    let publicOk = 0;
    for (const w of wans) {
      const q = resolveIpQuality(w);
      if (q.ipQuality === 'cgnat') cgnat++;
      else if (q.ipUsable) publicOk++;
      else if (w.publicIp || q.ipQuality !== 'missing') bad++;
    }
    return { cgnat, bad, publicOk };
  }, [wans]);

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
      title: 'IP Public', key: 'publicIp', width: 200,
      render: (_: unknown, r: WanInfo) => (
        <Space size={4} wrap>
          {r.publicIp
            ? <Tag color="blue" className="proxy-endpoint-chip--http">{r.publicIp}</Tag>
            : <Tag>—</Tag>}
          <IpQualityTag {...r} publicIp={r.publicIp} />
          {r.quayipStatus && r.quayipStatus !== 'protected' ? (
            <Tooltip title="Script quayip trên router (comment OK/DEAD)">
              <Tag
                color={r.quayipStatus === 'ok' ? 'success' : r.quayipStatus === 'dead' ? 'error' : 'processing'}
                bordered={false}
              >
                {r.quayipLabel}
              </Tag>
            </Tooltip>
          ) : null}
        </Space>
      ),
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

  const withProxy = wans.filter(w => w.hasProxy).length;

  return (
    <ProxyPageShell
      stats={(
        <ProxyStatsRow
          items={[
            { key: 'all', title: 'Tổng WAN', value: wans.length, icon: <GlobalOutlined />, accent: 'primary' },
            { key: 'up', title: 'Đang UP', value: up, icon: <CheckCircleOutlined />, accent: 'success' },
            { key: 'down', title: 'DOWN', value: down, icon: <CloseCircleOutlined />, accent: 'error', valueStyle: down ? { color: '#FF4D4F' } : undefined },
            { key: 'proxy', title: 'Có proxy', value: withProxy, icon: <ApiOutlined />, accent: 'purple' },
            ...(ipStats.cgnat > 0 || ipStats.bad > 0 ? [{
              key: 'badip',
              title: 'IP xấu / CGNAT',
              value: ipStats.cgnat + ipStats.bad,
              suffix: ipStats.cgnat > 0 ? ` (${ipStats.cgnat} CGNAT)` : undefined,
              icon: <WarningOutlined />,
              accent: 'error' as const,
            }] : []),
          ]}
        />
      )}
      toolbar={(
        <ProxyToolbar
          filters={(
            <>
              <Input.Search
                placeholder="Tìm PPPoE / IP public…"
                allowClear
                style={{ width: 240, maxWidth: '100%' }}
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
              />
            </>
          )}
          actions={(
            <>
              <Button icon={<ReloadOutlined />} onClick={load}>Làm mới</Button>
              {createQueueSize > 0 && (
                <Tag color="processing" bordered={false}>
                  Hàng đợi: {createQueueSize}
                  {createQueue.currentName ? ` · ${createQueue.currentName}` : ''}
                </Tag>
              )}
              <Tooltip title="Clone pppoe-out1 → tạo index tiếp, bật + auto-proxy (có thể bấm liên tục)">
                <Button type="primary" icon={<ThunderboltOutlined />} onClick={() => createNextPppoe(true)}>
                  + PPPoE tiếp
                </Button>
              </Tooltip>
              <Tooltip title="Chỉ tạo interface, chưa bật dial (có thể bấm liên tục)">
                <Button onClick={() => createNextPppoe(false)}>Tạo (chưa bật)</Button>
              </Tooltip>
            </>
          )}
          bulk={selected.length > 0 ? (
            <>
              <Tag color="blue" bordered={false}>Đã chọn {selected.length}</Tag>
              <Button type="primary" icon={<RocketOutlined />} loading={bulkBusy} onClick={bulkEnable}>
                Bật {selected.length}
              </Button>
              <Button icon={<PauseCircleOutlined />} loading={bulkBusy} onClick={bulkDisable}>
                Tắt {selected.length}
              </Button>
            </>
          ) : undefined}
        />
      )}
    >
      {progress.visible && progress.total > 0 && (
        <Card
          size="small"
          className={`wan-bulk-progress ${progress.failed > 0 ? 'wan-bulk-progress--warn' : 'wan-bulk-progress--ok'}`}
          style={{ marginBottom: 16 }}
        >
          <Space direction="vertical" style={{ width: '100%' }} size={6}>
            <Space wrap>
              <Text strong>Bulk operation</Text>
              <Tag color="blue" bordered={false}>{progress.done}/{progress.total}</Tag>
              <Tag color="success" bordered={false}>{progress.succeeded} OK</Tag>
              {progress.failed > 0 && <Tag color="error" bordered={false}>{progress.failed} FAIL</Tag>}
            </Space>
            <Progress
              percent={Math.round((progress.done / progress.total) * 100)}
              status={progress.failed > 0 ? 'exception' : 'success'}
              strokeWidth={8}
            />
          </Space>
        </Card>
      )}

      <Card className="proxy-table-card" styles={{ body: { padding: 0 } }}>
        <Table
          rowKey="name"
          loading={loading}
          dataSource={filtered}
          columns={columns}
          rowSelection={{
            selectedRowKeys: selected,
            onChange: (keys) => setSelected(keys as number[]),
          }}
          pagination={tablePagination}
          scroll={{ x: 1100 }}
          size="middle"
        />
      </Card>

      <AppDrawer
        open={resultsDrawer.open}
        onClose={() => setResultsDrawer({ ...resultsDrawer, open: false })}
        width="md"
        icon={<WarningOutlined />}
        title={resultsDrawer.title || 'Lỗi bulk'}
        subtitle={`${resultsDrawer.results.length} PPPoE gặp lỗi`}
      >
        <div className="drawer-error-list">
          {resultsDrawer.results.map((r: { pppoeIdx?: number; pppoeName?: string; error?: string }, i: number) => (
            <div key={i} className="drawer-error-item">
              <div className="drawer-error-item__title">
                {r.pppoeName || `pppoe-out${r.pppoeIdx ?? '?'}`}
              </div>
              <p className="drawer-error-item__msg">{r.error || 'Unknown error'}</p>
            </div>
          ))}
        </div>
      </AppDrawer>
    </ProxyPageShell>
  );
}