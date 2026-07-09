import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button, Card, Chip, Drawer, ProgressBar, Switch, toast,
} from '@heroui/react';
import { api, WanInfo } from '../services/api';
import { useWSEvent } from '../services/ws';
import { HTTP_PORT_BASE, SOCKS_PORT_BASE } from '../lib/proxyUtils';
import { formatDateTime } from '../lib/format';
import MobileHeader from '../components/layout/MobileHeader';
import PageLayout from '../components/layout/PageLayout';
import Panel from '../components/ui/Panel';
import ListPageTop from '../components/ui/ListPageTop';
import PageToolbarInline from '../components/ui/PageToolbarInline';
import LoadingScreen from '../components/ui/LoadingScreen';
import EmptyState from '../components/ui/EmptyState';
import KvList from '../components/ui/KvList';
import FilterChip from '../components/ui/FilterChip';
import ActionBar from '../components/ui/ActionBar';
import ListCard from '../components/ui/ListCard';
import RecordList from '../components/ui/RecordList';
import PaginationBar from '../components/ui/PaginationBar';
import WanDataTable from '../components/wide/WanDataTable';
import { useWideLayout } from '../hooks/useWideLayout';
import { useListPagination } from '../hooks/useListPagination';
import { IconWan } from '../components/ui/Icons';
import IpQualityTag from '../components/IpQualityTag';
import { resolveIpQuality } from '../lib/ipQuality';

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

const STATUS_FILTERS = [
  { id: 'all', label: 'Tất cả' },
  { id: 'true', label: 'UP' },
  { id: 'false', label: 'DOWN' },
] as const;

export default function WanPage() {
  const [wans, setWans] = useState<WanInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selected, setSelected] = useState<number[]>([]);
  const [busyIdx, setBusyIdx] = useState<number | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [createQueue, setCreateQueue] = useState<CreateQueueState>({ pending: 0, processing: false });
  const [detail, setDetail] = useState<WanInfo | null>(null);
  const [progress, setProgress] = useState<BulkProgress>({ total: 0, done: 0, succeeded: 0, failed: 0, visible: false });
  const [resultsDrawer, setResultsDrawer] = useState<{ open: boolean; results: Array<{ pppoeIdx?: number; pppoeName?: string; error?: string }>; title: string }>({
    open: false, results: [], title: '',
  });

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

  const handleWanAction = useCallback((p: WanActionEvent) => {
    const name = wanLabel(p);
    if (p.action === 'enable') {
      if (p.status === 'starting') {
        toast.info(`Đang bật ${name}…`);
      } else if (p.status === 'pppoe-up') {
        toast.info(`${name} UP ${p.publicIp || ''} — đang setup proxy…`);
      } else if (p.status === 'creating-proxy' || p.status === 'applying-proxy') {
        const step = p.status === 'creating-proxy' ? 'tạo proxy' : 'apply proxy';
        toast.info(`${name}: đang ${step}…`);
      } else if (p.status === 'done') {
        setBusyIdx(null);
        load();
        const ms = p.durationMs ? ` (${(p.durationMs / 1000).toFixed(1)}s)` : '';
        const proxyPart = p.proxyCreated ? ' · proxy mới' : (p.proxyId ? ' · proxy OK' : '');
        const ipPart = p.publicIp ? ` · ${p.publicIp}` : ' · chờ IP WAN';
        toast.success(`${name} bật${ipPart}${proxyPart}${ms}`);
      } else if (p.status === 'error') {
        setBusyIdx(null);
        load();
        toast.danger(`${name}: ${p.error || 'lỗi'}`);
      }
    }
    if (p.action === 'disable' && (p.status === 'done' || p.status === 'error')) {
      setBusyIdx(null);
      load();
      if (p.status === 'error') toast.danger(`${name}: ${p.error || 'lỗi'}`);
    }
  }, [load]);

  useWSEvent(
    (msg) => msg.type === 'wan.sync' || msg.type === 'wan.action' || msg.type === 'wan.bulk' || msg.type === 'wan.created'
      || msg.type === 'wan.internet-up' || msg.type === 'wan.internet-pending' || msg.type.startsWith('wan.create.'),
    (msg) => {
      if (msg.type === 'wan.action' && msg.payload) {
        handleWanAction(msg.payload as WanActionEvent);
      }
      if (msg.type === 'wan.sync' || msg.type === 'wan.created') load();
      if (msg.type === 'wan.create.queue' && msg.payload) {
        const p = msg.payload as CreateQueueState & { current?: { name?: string } | null };
        setCreateQueue({
          pending: p.pending ?? 0,
          processing: p.processing ?? false,
          currentName: p.current?.name,
        });
      }
      if (msg.type === 'wan.create.error' && msg.payload) {
        const p = msg.payload as { error?: string };
        toast.danger(`Tạo PPPoE: ${p.error || 'lỗi'}`);
      }
      if (msg.type === 'wan.create.done' && msg.payload) {
        const p = msg.payload as { name?: string; enable?: boolean };
        load();
        if (!p.enable) toast.success(`${p.name || 'PPPoE'} đã tạo`);
      }
      if (msg.type === 'wan.internet-up' && msg.payload) {
        const p = msg.payload as { pppoeName?: string; publicIp?: string; pingMs?: number };
        toast.success(`${p.pppoeName || 'WAN'} có internet · ${p.publicIp}${p.pingMs != null ? ` · ping ${p.pingMs}ms` : ''}`);
        load();
      }
      if (msg.type === 'wan.internet-pending' && msg.payload) {
        const p = msg.payload as { pppoeName?: string; publicIp?: string };
        toast.info(`${p.pppoeName || 'WAN'} ${p.publicIp || ''} — chờ internet…`);
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

  const stats = useMemo(() => ({
    total: wans.length,
    up: wans.filter((w) => w.running).length,
    withProxy: wans.filter((w) => w.hasProxy).length,
    withIp: wans.filter((w) => w.publicIp).length,
  }), [wans]);

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

  const wide = useWideLayout();

  const filtered = useMemo(() => wans.filter((w) => {
    if (statusFilter !== 'all' && String(w.running) !== statusFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      if (!w.name.toLowerCase().includes(q) && !(w.publicIp || '').includes(search)) return false;
    }
    return true;
  }), [wans, search, statusFilter]);

  const filterKey = `${search}|${statusFilter}`;
  const {
    slice: pageRows, page, setPage, pageSize, setPageSize, total: pageTotal, pageCount,
  } = useListPagination(filtered, wide ? 20 : filtered.length, filterKey);

  const toggleSelect = (idx: number) => {
    setSelected((prev) => prev.includes(idx) ? prev.filter((x) => x !== idx) : [...prev, idx]);
  };

  const toggleSelectAll = (checked: boolean) => {
    if (!checked) {
      setSelected((prev) => prev.filter((id) => !pageRows.some((r) => r.index === id)));
      return;
    }
    setSelected((prev) => [...new Set([...prev, ...pageRows.map((r) => r.index)])]);
  };

  const createNextPppoe = async (autoEnable = true) => {
    try {
      const r = await api.post<{
        error?: string;
        queued?: boolean;
        position?: number;
        queueSize?: number;
      }>('/api/wan/create-next', { enable: autoEnable });
      if (r.error) {
        toast.danger(r.error);
        return;
      }
      if (r.queued) {
        const pos = r.position ?? r.queueSize ?? 1;
        toast.info(`Đã thêm vào hàng đợi · vị trí #${pos}`);
        loadCreateQueue();
        return;
      }
      load();
    } catch (e) {
      toast.danger(e instanceof Error ? e.message : 'Lỗi');
    }
  };

  const createQueueSize = createQueue.pending + (createQueue.processing ? 1 : 0);
  const createQueueHint = createQueueSize > 0
    ? createQueue.processing && createQueue.currentName
      ? ` · đang tạo ${createQueue.currentName}`
      : ` · hàng đợi ${createQueueSize}`
    : '';

  const toggleOne = async (w: WanInfo, enable: boolean) => {
    setBusyIdx(w.index);
    try {
      if (enable) {
        toast.info(`Đang bật ${w.name}…`);
        const r = await api.post<{ error?: string; accepted?: boolean; enabling?: boolean; publicIp?: string }>(
          `/api/wan/${w.index}/enable`,
        );
        if (r.error) {
          toast.danger(`${w.name}: ${r.error}`);
          setBusyIdx(null);
          return;
        }
        if (r.accepted || r.enabling) return;
        const ipPart = r.publicIp ? ` · IP ${r.publicIp}` : '';
        toast.success(`${w.name} UP${ipPart}`);
        load();
      } else {
        await api.post(`/api/wan/${w.index}/disable`);
        toast.success(`${w.name} đã tắt`);
        load();
      }
    } catch (e) {
      toast.danger(e instanceof Error ? e.message : 'Lỗi');
    } finally {
      if (!enable) setBusyIdx(null);
    }
  };

  const bulkEnable = async () => {
    if (selected.length === 0) return;
    if (selected.length > 50) { toast.warning('Tối đa 50 PPPoE/lần'); return; }
    setBulkBusy(true);
    setProgress({ total: selected.length, done: 0, succeeded: 0, failed: 0, visible: true });
    try {
      const r = await api.post<{
        summary?: { total: number; succeeded: number; failed: number; durationMs: number };
        results: Array<{ error?: string }>;
      }>('/api/wan/bulk-enable', { indices: selected });
      const succ = r.summary?.succeeded ?? 0;
      const fail = r.summary?.failed ?? 0;
      setProgress({
        total: r.summary?.total ?? selected.length,
        done: r.summary?.total ?? selected.length,
        succeeded: succ,
        failed: fail,
        visible: true,
      });
      toast[fail === 0 ? 'success' : 'warning'](
        `Bulk enable: ${succ} OK / ${fail} FAIL · ${((r.summary?.durationMs ?? 0) / 1000).toFixed(1)}s`,
      );
      if (fail > 0) {
        setResultsDrawer({
          open: true,
          results: r.results.filter((x) => x.error),
          title: `${fail} PPPoE lỗi`,
        });
      }
      setSelected([]);
      load();
    } catch (e) {
      toast.danger(e instanceof Error ? e.message : 'Lỗi');
    } finally {
      setBulkBusy(false);
    }
  };

  const bulkDisable = async () => {
    if (selected.length === 0) return;
    if (selected.length > 50) { toast.warning('Tối đa 50 PPPoE/lần'); return; }
    setBulkBusy(true);
    try {
      const r = await api.post<{ summary?: { succeeded: number; failed: number; durationMs: number } }>(
        '/api/wan/bulk-disable',
        { indices: selected },
      );
      const succ = r.summary?.succeeded ?? 0;
      const fail = r.summary?.failed ?? 0;
      toast[fail === 0 ? 'success' : 'warning'](
        `Bulk disable: ${succ} OK / ${fail} FAIL · ${((r.summary?.durationMs ?? 0) / 1000).toFixed(1)}s`,
      );
      setSelected([]);
      load();
    } catch (e) {
      toast.danger(e instanceof Error ? e.message : 'Lỗi');
    } finally {
      setBulkBusy(false);
    }
  };

  if (loading) return <LoadingScreen />;

  return (
    <div>
      <MobileHeader
        title="WAN Status"
        subtitle={`${stats.up}/${stats.total} up · ${stats.withIp} có IP`}
        icon={<IconWan />}
        onRefresh={load}
      />
      <PageLayout
        banner={progress.visible && progress.total > 0 ? (
          <Panel>
            <div className="mb-2 flex flex-wrap gap-2 text-xs">
              <span className="font-medium">Bulk operation</span>
              <Chip size="sm">{progress.done}/{progress.total}</Chip>
              <Chip size="sm" color="success">{progress.succeeded} OK</Chip>
              {progress.failed > 0 ? <Chip size="sm" color="danger">{progress.failed} FAIL</Chip> : null}
            </div>
            <ProgressBar value={Math.round((progress.done / progress.total) * 100)} />
          </Panel>
        ) : createQueue.processing ? (
          <Panel>
            <div className="mb-2 text-xs font-medium">
              Đang tạo PPPoE{createQueue.currentName ? `: ${createQueue.currentName}` : '…'}
              {createQueue.pending > 0 ? ` · ${createQueue.pending} chờ` : ''}
            </div>
            <ProgressBar isIndeterminate />
          </Panel>
        ) : undefined}
      >
        <ListPageTop
          eyebrow="WAN Status"
          heroValue={stats.total > 0 ? Math.round((stats.up / stats.total) * 100) : 0}
          heroSuffix="%"
          summary={`${stats.up}/${stats.total} up · ${stats.withProxy} proxy · ${stats.withIp} có IP${createQueueHint}`}
          badge={createQueue.processing ? (
            <Chip size="sm" color="warning" className="shrink-0">Tạo PPPoE</Chip>
          ) : createQueue.pending > 0 ? (
            <Chip size="sm" color="default" className="shrink-0">{createQueue.pending} chờ</Chip>
          ) : undefined}
          metrics={[
            { label: 'WAN', value: stats.total, hint: `${stats.up} up`, accent: true, icon: <IconWan /> },
            { label: 'UP', value: stats.up },
            { label: 'DOWN', value: stats.total - stats.up },
            ...(ipStats.cgnat > 0 || ipStats.bad > 0
              ? [{ label: 'IP xấu', value: ipStats.cgnat + ipStats.bad, hint: ipStats.cgnat > 0 ? `${ipStats.cgnat} CGNAT` : undefined }]
              : [{ label: 'Proxy', value: stats.withProxy, hint: `${stats.withIp} IP` }]),
          ]}
          gauges={[
            { label: 'UP', value: stats.total > 0 ? Math.round((stats.up / stats.total) * 100) : 0, color: 'success' },
            { label: 'Proxy', value: stats.total > 0 ? Math.round((stats.withProxy / stats.total) * 100) : 0, color: 'accent' },
            { label: 'Có IP', value: stats.total > 0 ? Math.round((stats.withIp / stats.total) * 100) : 0, color: 'accent' },
          ]}
          toolbar={(
            <PageToolbarInline
              search={{ value: search, onChange: setSearch, placeholder: 'Tìm PPPoE / IP public…' }}
            >
              <div className="filter-scroll">
                {STATUS_FILTERS.map((f) => (
                  <FilterChip key={f.id} label={f.label} active={statusFilter === f.id} onSelect={() => setStatusFilter(f.id)} />
                ))}
              </div>
              <div className="mobile-fab-row">
                <Button className="flex-1" isPending={createQueue.processing} onPress={() => createNextPppoe(true)}>+ PPPoE tiếp</Button>
                <Button className="flex-1" variant="outline" isPending={createQueue.processing} onPress={() => createNextPppoe(false)}>Tạo (chưa bật)</Button>
              </div>
              {selected.length > 0 ? (
                <ActionBar label={`Đã chọn ${selected.length}`}>
                  <Button size="sm" isPending={bulkBusy} onPress={bulkEnable}>Bật {selected.length}</Button>
                  <Button size="sm" variant="outline" isPending={bulkBusy} onPress={bulkDisable}>Tắt</Button>
                </ActionBar>
              ) : null}
            </PageToolbarInline>
          )}
        />
        {filtered.length === 0 ? (
          <EmptyState title="Không có WAN" />
        ) : wide ? (
          <>
            <WanDataTable
              rows={pageRows}
              selected={selected}
              busyIdx={busyIdx}
              onToggleSelect={toggleSelect}
              onSelectAll={toggleSelectAll}
              onRowClick={setDetail}
              onToggle={toggleOne}
            />
            <PaginationBar
              page={page}
              pageCount={pageCount}
              pageSize={pageSize}
              total={pageTotal}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
            />
          </>
        ) : (
          <RecordList>
            {filtered.map((w) => (
              <ListCard key={w.index} selected={selected.includes(w.index)}>
                <ListCard.Body>
                  <ListCard.Row>
                    <input
                      type="checkbox"
                      className="list-card-checkbox"
                      checked={selected.includes(w.index)}
                      onChange={() => toggleSelect(w.index)}
                      aria-label={`Chọn ${w.name}`}
                    />
                    <ListCard.Main>
                      <ListCard.Title>{w.name}</ListCard.Title>
                      <ListCard.Subtitle>{w.publicIp || 'Chưa có IP'}</ListCard.Subtitle>
                      <ListCard.Meta>
                        <IpQualityTag {...w} publicIp={w.publicIp} />
                        {w.hasProxy ? (
                          <>
                            <Chip size="sm" color={w.proxyStatus === 'running' ? 'success' : 'default'}>{w.proxyStatus || '—'}</Chip>
                            <Chip size="sm" color={w.proxyEnabled ? 'success' : 'default'}>{w.proxyEnabled ? 'ON' : 'OFF'}</Chip>
                            <span className="mobile-mono">:{HTTP_PORT_BASE + w.index} / :{SOCKS_PORT_BASE + w.index}</span>
                          </>
                        ) : (
                          <Chip size="sm">Chưa có proxy</Chip>
                        )}
                      </ListCard.Meta>
                    </ListCard.Main>
                    <ListCard.Aside>
                      <Chip size="sm" color={w.running ? 'success' : 'danger'}>{w.running ? 'UP' : 'DOWN'}</Chip>
                    </ListCard.Aside>
                  </ListCard.Row>
                  <ListCard.Actions>
                    <Switch
                      isSelected={w.running}
                      isDisabled={busyIdx === w.index}
                      onChange={(checked) => toggleOne(w, checked)}
                    >
                      <Switch.Content>
                        <Switch.Control><Switch.Thumb /></Switch.Control>
                        <span className="text-xs">{w.running ? 'WAN bật' : 'WAN tắt'}</span>
                      </Switch.Content>
                    </Switch>
                    <Button size="sm" variant="secondary" onPress={() => setDetail(w)}>Chi tiết</Button>
                  </ListCard.Actions>
                </ListCard.Body>
              </ListCard>
            ))}
          </RecordList>
        )}
      </PageLayout>

      <Drawer isOpen={!!detail} onOpenChange={(open) => !open && setDetail(null)}>
        <Drawer.Backdrop>
          <Drawer.Content placement="bottom">
            <Drawer.Dialog className="max-h-[85vh]">
              <Drawer.Header><Drawer.Heading>{detail?.name}</Drawer.Heading></Drawer.Header>
              <Drawer.Body className="overflow-y-auto">
                {detail ? (
                  <KvList items={[
                    { label: 'Trạng thái', value: detail.running ? 'UP' : 'DOWN' },
                    { label: 'IP public', value: detail.publicIp || '—' },
                    { label: 'Chất lượng IP', value: resolveIpQuality(detail).ipQualityLabel || '—' },
                    { label: 'Uptime', value: detail.uptime || '—' },
                    { label: 'User PPPoE', value: detail.user || '—' },
                    { label: 'Comment', value: detail.comment || '—' },
                    { label: 'Proxy', value: detail.hasProxy ? `${detail.proxyStatus || '—'} (${detail.proxyEnabled ? 'ON' : 'OFF'})` : 'Chưa có' },
                    { label: 'HTTP port', value: String(HTTP_PORT_BASE + detail.index) },
                    { label: 'SOCKS port', value: String(SOCKS_PORT_BASE + detail.index) },
                    { label: 'Last check', value: formatDateTime(detail.lastCheckAt) },
                    { label: 'Discovery error', value: detail.discoveryError || '—' },
                  ]} />
                ) : null}
              </Drawer.Body>
            </Drawer.Dialog>
          </Drawer.Content>
        </Drawer.Backdrop>
      </Drawer>

      <Drawer isOpen={resultsDrawer.open} onOpenChange={(open) => setResultsDrawer((s) => ({ ...s, open }))}>
        <Drawer.Backdrop>
          <Drawer.Content placement="bottom">
            <Drawer.Dialog className="max-h-[70vh]">
              <Drawer.Header><Drawer.Heading>{resultsDrawer.title}</Drawer.Heading></Drawer.Header>
              <Drawer.Body className="overflow-y-auto">
                <div className="mobile-list">
                  {resultsDrawer.results.map((r, i) => (
                    <Card key={i} className="p-3">
                      <div className="font-medium">{r.pppoeName || `pppoe-out${r.pppoeIdx ?? '?'}`}</div>
                      <div className="mt-1 text-sm text-danger">{r.error || 'Unknown error'}</div>
                    </Card>
                  ))}
                </div>
              </Drawer.Body>
            </Drawer.Dialog>
          </Drawer.Content>
        </Drawer.Backdrop>
      </Drawer>
    </div>
  );
}