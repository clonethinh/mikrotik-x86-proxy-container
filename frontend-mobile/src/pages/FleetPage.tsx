import { useEffect, useMemo, useState } from 'react';
import {
  Button, Chip, Drawer, Label, ListBox, Modal, Select, Switch, toast,
} from '@heroui/react';
import { api, WanInfo } from '../services/api';
import { useWSEvent } from '../services/ws';
import { containerStatusColor, containerStatusLabel, extHttpPort, extSocksPort, formatProxy } from '../lib/proxyUtils';
import { copyText } from '../lib/clipboard';
import { formatDateTime, formatLatency } from '../lib/format';
import MobileHeader from '../components/layout/MobileHeader';
import PageLayout from '../components/layout/PageLayout';

import LoadingScreen from '../components/ui/LoadingScreen';
import EmptyState from '../components/ui/EmptyState';
import KvList from '../components/ui/KvList';
import FilterChip from '../components/ui/FilterChip';
import ListPageTop from '../components/ui/ListPageTop';
import PageToolbarInline from '../components/ui/PageToolbarInline';
import ListCard from '../components/ui/ListCard';
import ActionBar from '../components/ui/ActionBar';
import RecordList from '../components/ui/RecordList';
import DismissibleAlert from '../components/ui/DismissibleAlert';
import PaginationBar from '../components/ui/PaginationBar';
import FleetDataTable from '../components/wide/FleetDataTable';
import { useWideLayout } from '../hooks/useWideLayout';
import { useListPagination } from '../hooks/useListPagination';
import { IconFleet, IconWan } from '../components/ui/Icons';
import IpQualityTag from '../components/IpQualityTag';
import EgressTag from '../components/EgressTag';
import { resolveIpQuality } from '../lib/ipQuality';

const FILTERS = [
  { id: 'all', label: 'Tất cả' },
  { id: 'up', label: 'Up' },
  { id: 'down', label: 'Down' },
  { id: 'proxy', label: 'Có proxy' },
  { id: 'noproxy', label: 'Chưa proxy' },
] as const;

function workflowLabel(state: string | null | undefined): { color: 'default' | 'accent' | 'success' | 'warning' | 'danger'; label: string; extra?: string } | null {
  if (!state || state === 'active') return null;
  const map: Record<string, { color: 'default' | 'accent' | 'success' | 'warning' | 'danger'; label: string }> = {
    discovered: { color: 'accent', label: 'Mới' },
    countdown: { color: 'accent', label: 'Đếm ngược' },
    provisioning: { color: 'accent', label: 'Đang tạo' },
    queued: { color: 'warning', label: 'Hàng đợi' },
    stale: { color: 'warning', label: 'Stale' },
    gone: { color: 'default', label: 'Đã rời' },
    error: { color: 'danger', label: 'Lỗi' },
    skipped: { color: 'default', label: 'Đã hủy' },
  };
  const m = map[state];
  if (!m) return null;
  return m;
}

function countdownExtra(row: WanInfo): string {
  if (row.workflowState !== 'countdown' || !row.countdownEnds) return '';
  const sec = Math.max(0, Math.ceil((new Date(row.countdownEnds).getTime() - Date.now()) / 1000));
  return ` ${sec}s`;
}

export default function FleetPage() {
  const [fleet, setFleet] = useState<WanInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<string>('all');
  const [selected, setSelected] = useState<number[]>([]);
  const [busyIdx, setBusyIdx] = useState<number | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [detail, setDetail] = useState<WanInfo | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [pppoeIdx, setPppoeIdx] = useState(2);
  const [proxyType, setProxyType] = useState('both');
  const [revealedPass, setRevealedPass] = useState<string | null>(null);

  const load = async () => {
    try { setFleet(await api.get<WanInfo[]>('/api/wan')); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);
  useWSEvent((msg) => msg.type?.startsWith('proxy.') || msg.type?.startsWith('wan.'), () => load());

  const wide = useWideLayout();

  const stats = useMemo(() => ({
    total: fleet.length,
    up: fleet.filter((f) => f.running).length,
    withProxy: fleet.filter((f) => f.hasProxy).length,
    containers: fleet.filter((f) => f.hasContainer).length,
    withDb: fleet.filter((f) => f.proxyId).length,
  }), [fleet]);

  const filtered = useMemo(() => {
    let rows = fleet;
    if (filter === 'up') rows = rows.filter((f) => f.running);
    else if (filter === 'down') rows = rows.filter((f) => !f.running);
    else if (filter === 'proxy') rows = rows.filter((f) => f.hasContainer);
    else if (filter === 'noproxy') rows = rows.filter((f) => !f.hasContainer);
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter((f) =>
        f.name.toLowerCase().includes(q)
        || (f.publicIp || '').includes(q)
        || (f.username || '').toLowerCase().includes(q)
        || (f.containerName || '').toLowerCase().includes(q),
      );
    }
    return rows;
  }, [fleet, filter, search]);

  const filterKey = `${search}|${filter}`;
  const {
    slice: pageRows,
    page,
    setPage,
    pageSize,
    setPageSize,
    total: pageTotal,
    pageCount,
  } = useListPagination(filtered, wide ? 15 : filtered.length, filterKey);

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

  const toggleWan = (row: WanInfo, enable: boolean) => {
    if (enable) enableWan(row);
    else disableWan(row);
  };

  const revealPassword = async (proxyId: number) => {
    const r = await api.get<{ password: string }>(`/api/proxies/${proxyId}/password`);
    return r.password;
  };

  const createProxy = async () => {
    try {
      await api.post('/api/proxies', { pppoeIdx, proxyType });
      toast.success(`Đã tạo proxy cho pppoe-out${pppoeIdx}`);
      setCreateOpen(false);
      load();
    } catch (e) {
      toast.danger(e instanceof Error ? e.message : 'Lỗi');
    }
  };

  const enableWan = async (row: WanInfo) => {
    setBusyIdx(row.index);
    try {
      toast.info(`Bật ${row.name} + tạo proxy…`);
      const r = await api.post<{ error?: string; publicIp?: string; proxyCreated?: boolean }>(`/api/wan/${row.index}/enable`);
      if (r.error) toast.danger(r.error);
      else toast.success(`${row.name} · IP ${r.publicIp || '—'} · ${r.proxyCreated ? 'proxy mới' : 'proxy sẵn sàng'}`);
      load();
    } catch (e) {
      toast.danger(e instanceof Error ? e.message : 'Lỗi');
    } finally {
      setBusyIdx(null);
    }
  };

  const disableWan = async (row: WanInfo) => {
    setBusyIdx(row.index);
    try {
      await api.post(`/api/wan/${row.index}/disable`);
      toast.success(`${row.name} đã tắt`);
      load();
    } catch (e) {
      toast.danger(e instanceof Error ? e.message : 'Lỗi');
    } finally {
      setBusyIdx(null);
    }
  };

  const testProxy = async (row: WanInfo) => {
    if (!row.proxyId) { toast.warning('Chưa có proxy trong DB — bật WAN để tạo'); return; }
    setBusyIdx(row.index);
    try {
      const r = await api.post<{ ok: boolean; latencyMs: number; exitIp: string | null; error: string | null }>(`/api/proxies/${row.proxyId}/test`);
      if (r.ok) toast.success(`Container OK ${r.latencyMs}ms · egress ${r.exitIp || row.publicIp}`);
      else toast.danger(r.error || 'Test fail');
      load();
    } catch (e) {
      toast.danger(e instanceof Error ? e.message : 'Lỗi');
    } finally {
      setBusyIdx(null);
    }
  };

  const reloadIp = async (row: WanInfo) => {
    if (!row.proxyId) { toast.warning('Chưa có proxy'); return; }
    setBusyIdx(row.index);
    try {
      await api.post(`/api/proxies/${row.proxyId}/reload-ip`);
      toast.success('Đã trigger reload IP');
      load();
    } catch (e) {
      toast.danger(e instanceof Error ? e.message : 'Lỗi');
    } finally {
      setBusyIdx(null);
    }
  };

  const cancelCountdown = async (row: WanInfo) => {
    setBusyIdx(row.index);
    try {
      await api.post(`/api/wan/${row.index}/provision/cancel`);
      toast.success('Đã hủy đếm ngược');
      load();
    } catch (e) {
      toast.danger(e instanceof Error ? e.message : 'Lỗi');
    } finally {
      setBusyIdx(null);
    }
  };

  const bulkEnable = async () => {
    if (!selected.length) return;
    setBulkBusy(true);
    try {
      const r = await api.post<{ summary?: { succeeded: number; failed: number } }>('/api/wan/bulk-enable', { indices: selected });
      toast.success(`Bulk: ${r.summary?.succeeded} OK / ${r.summary?.failed} FAIL`);
      setSelected([]);
      load();
    } catch (e) {
      toast.danger(e instanceof Error ? e.message : 'Lỗi');
    } finally {
      setBulkBusy(false);
    }
  };

  const copyEndpoint = async (row: WanInfo, kind: 'http' | 'socks5' = 'http') => {
    const text = kind === 'http'
      ? (row.publicIp ? `${row.publicIp}:${row.extHttpPort ?? extHttpPort(row.index)}` : '')
      : (row.publicIp && row.extSocksPort ? `${row.publicIp}:${row.extSocksPort ?? extSocksPort(row.index)}` : '');
    if (!text) { toast.warning('Chưa có IP public'); return; }
    try {
      await copyText(text);
      toast.success(`Đã copy ${kind.toUpperCase()} endpoint`);
    } catch {
      toast.danger('Copy thất bại');
    }
  };

  const copyFullProxy = async (row: WanInfo, kind: 'http' | 'socks5' = 'http') => {
    const text = formatProxy({ ...row, pppoeIdx: row.index }, kind);
    if (!text) { toast.warning('Chưa có IP public'); return; }
    try {
      await copyText(text);
      toast.success('Đã copy URL');
    } catch {
      toast.danger('Copy thất bại');
    }
  };

  const openDetail = (row: WanInfo) => {
    setDetail(row);
    setRevealedPass(null);
  };

  if (loading) return <LoadingScreen />;

  const availableForCreate = fleet.filter((f) => !f.hasContainer);

  return (
    <div>
      <MobileHeader
        title="Fleet"
        subtitle={`${stats.up}/${stats.total} WAN up`}
        icon={<IconFleet />}
        onRefresh={load}
      />
      <PageLayout>
        <DismissibleAlert bannerId="fleet-pool-rotation" title="Pool rotation & auto-provision">
          Proxy bắt đầu từ <code className="mobile-mono">pppoe-out1</code>.
          Hub mode: 1 container <code className="mobile-mono">proxy3p-hub</code>, nhiều slot/IP.
          WAN biến mất &gt; 30 phút → dọn proxy + veth/NAT.
        </DismissibleAlert>
        <ListPageTop
          eyebrow="Fleet Status"
          heroValue={stats.total > 0 ? Math.round((stats.up / stats.total) * 100) : 0}
          heroSuffix="%"
          summary={`${stats.up}/${stats.total} WAN up · ${stats.containers} container · ${stats.withDb} DB`}
          metrics={wide ? [
            { label: 'PPPoE', value: stats.total, hint: `${stats.up} up`, accent: true, icon: <IconWan /> },
            { label: 'UP', value: stats.up },
            { label: 'Container', value: stats.containers },
            { label: 'Ghi DB', value: stats.withDb, icon: <IconFleet /> },
          ] : [
            { label: 'WAN', value: stats.total, hint: `${stats.up} up`, accent: true, icon: <IconWan /> },
            { label: 'Proxy', value: stats.withProxy, icon: <IconFleet /> },
            { label: 'Container', value: stats.containers },
            { label: 'Down', value: stats.total - stats.up },
          ]}
          gauges={[
            { label: 'UP', value: stats.total > 0 ? Math.round((stats.up / stats.total) * 100) : 0, color: 'success' },
            { label: 'Proxy', value: stats.total > 0 ? Math.round((stats.withProxy / stats.total) * 100) : 0, color: 'accent' },
            { label: 'Container', value: stats.total > 0 ? Math.round((stats.containers / stats.total) * 100) : 0, color: 'accent' },
          ]}
          toolbar={(
            <PageToolbarInline
              search={{ value: search, onChange: setSearch, placeholder: 'Tìm WAN, IP, container…' }}
            >
              <div className="filter-scroll">
                {FILTERS.map((f) => (
                  <FilterChip key={f.id} label={f.label} active={filter === f.id} onSelect={() => setFilter(f.id)} />
                ))}
              </div>
              <Button className="w-full" onPress={() => setCreateOpen(true)}>Tạo proxy mới</Button>
              {selected.length > 0 ? (
                <ActionBar label={`Đã chọn ${selected.length}`}>
                  <Button size="sm" isPending={bulkBusy} onPress={bulkEnable}>Bật {selected.length} WAN</Button>
                </ActionBar>
              ) : null}
            </PageToolbarInline>
          )}
        />
        {filtered.length === 0 ? (
          <EmptyState title="Không có WAN" description="Thử đổi bộ lọc hoặc tìm kiếm" />
        ) : wide ? (
          <>
            <FleetDataTable
              rows={pageRows}
              selected={selected}
              busyIdx={busyIdx}
              onToggleSelect={toggleSelect}
              onSelectAll={toggleSelectAll}
              onRowClick={openDetail}
              onToggleWan={toggleWan}
              onTest={testProxy}
              onReload={reloadIp}
              onCopyHttp={(r) => copyEndpoint(r, 'http')}
              onCopySocks={(r) => copyEndpoint(r, 'socks5')}
              onEnableProxy={enableWan}
              onCancelCountdown={cancelCountdown}
            />
            <PaginationBar
              page={page}
              pageCount={pageCount}
              pageSize={pageSize}
              total={pageTotal}
              pageSizes={[10, 15, 30, 50]}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
            />
          </>
        ) : (
          <RecordList>
            {filtered.map((row) => {
              const wf = workflowLabel(row.workflowState);
              const cd = countdownExtra(row);
              const ports = row.hasProxy
                ? `H:${row.extHttpPort ?? extHttpPort(row.index)} S:${row.extSocksPort ?? extSocksPort(row.index)}`
                : null;
              return (
                <ListCard key={row.index} selected={selected.includes(row.index)}>
                  <ListCard.Body>
                    <ListCard.Row>
                      <input
                        type="checkbox"
                        className="list-card-checkbox"
                        checked={selected.includes(row.index)}
                        onChange={() => toggleSelect(row.index)}
                        aria-label={`Chọn ${row.name}`}
                      />
                      <ListCard.Main>
                        <ListCard.Title>{row.name}</ListCard.Title>
                        <ListCard.Subtitle>
                          {row.publicIp || 'Chưa có IP'}
                          {row.username ? ` · ${row.username}` : ''}
                        </ListCard.Subtitle>
                        <ListCard.Meta>
                          {row.hasProxy ? <Chip size="sm" color="accent">Proxy</Chip> : <Chip size="sm">No proxy</Chip>}
                          {row.containerStatus ? (
                            <Chip size="sm" color={containerStatusColor(row.containerStatus)}>
                              {containerStatusLabel(row.containerStatus)}
                            </Chip>
                          ) : null}
                          {wf ? <Chip size="sm" color={wf.color}>{wf.label}{cd}</Chip> : null}
                          {ports ? <span className="mobile-mono">{ports}</span> : null}
                          <IpQualityTag {...row} publicIp={row.publicIp} />
                          <EgressTag pppoeName={row.name} egressPppoeName={row.egressPppoeName} />
                          {row.quayipLabel ? <span>{row.quayipLabel}</span> : null}
                        </ListCard.Meta>
                      </ListCard.Main>
                      <ListCard.Aside>
                        <Chip size="sm" color={row.running ? 'success' : 'danger'}>{row.running ? 'UP' : 'DOWN'}</Chip>
                      </ListCard.Aside>
                    </ListCard.Row>
                    <ListCard.Actions>
                      {row.workflowState === 'countdown' ? (
                        <Button size="sm" variant="danger" isPending={busyIdx === row.index} onPress={() => cancelCountdown(row)}>Hủy</Button>
                      ) : null}
                      {!row.hasContainer && row.running ? (
                        <Button size="sm" isPending={busyIdx === row.index} onPress={() => enableWan(row)}>Tạo proxy</Button>
                      ) : null}
                      <Button size="sm" variant="secondary" onPress={() => openDetail(row)}>Chi tiết</Button>
                      <Button size="sm" variant="outline" isDisabled={!row.proxyId} isPending={busyIdx === row.index} onPress={() => testProxy(row)}>Test</Button>
                      <Button size="sm" variant="ghost" isDisabled={!row.proxyId} isPending={busyIdx === row.index} onPress={() => reloadIp(row)}>Reload IP</Button>
                      <Button size="sm" variant="ghost" onPress={() => copyEndpoint(row, 'http')}>Copy</Button>
                    </ListCard.Actions>
                  </ListCard.Body>
                </ListCard>
              );
            })}
          </RecordList>
        )}
      </PageLayout>

      <Drawer isOpen={!!detail} onOpenChange={(open) => !open && setDetail(null)}>
        <Drawer.Backdrop>
          <Drawer.Content placement="bottom">
            <Drawer.Dialog className="max-h-[90vh]">
              <Drawer.Header>
                <Drawer.Heading>{detail?.name}</Drawer.Heading>
              </Drawer.Header>
              <Drawer.Body className="overflow-y-auto">
                {detail ? (
                  <>
                    <div className="mb-3 flex flex-wrap gap-2">
                      <Chip size="sm" color={detail.running ? 'success' : 'danger'}>{detail.running ? 'WAN UP' : 'WAN DOWN'}</Chip>
                      {detail.containerStatus ? (
                        <Chip size="sm" color={containerStatusColor(detail.containerStatus)}>
                          {containerStatusLabel(detail.containerStatus)}
                        </Chip>
                      ) : null}
                      {workflowLabel(detail.workflowState) ? (
                        <Chip size="sm" color={workflowLabel(detail.workflowState)!.color}>
                          {workflowLabel(detail.workflowState)!.label}{countdownExtra(detail)}
                        </Chip>
                      ) : null}
                    </div>
                    <KvList items={[
                      { label: 'IP public', value: detail.publicIp || '—' },
                      { label: 'Chất lượng IP', value: resolveIpQuality(detail).ipQualityLabel || '—' },
                      { label: 'HTTP', value: detail.publicIp ? `${detail.publicIp}:${detail.extHttpPort ?? extHttpPort(detail.index)}` : '—' },
                      { label: 'SOCKS', value: detail.publicIp && (detail.extSocksPort ?? extSocksPort(detail.index)) ? `${detail.publicIp}:${detail.extSocksPort ?? extSocksPort(detail.index)}` : '—' },
                      { label: 'User', value: detail.username || '—' },
                      { label: 'Password', value: revealedPass || '••••••' },
                      { label: 'Uptime', value: detail.uptime || '—' },
                      { label: 'Container', value: detail.containerName || '—' },
                      { label: 'Veth', value: detail.vethName || '—' },
                      { label: 'Proxy status', value: detail.proxyStatus || '—' },
                      { label: 'Latency', value: formatLatency(detail.lastLatencyMs) },
                      { label: 'Last check', value: formatDateTime(detail.lastCheckAt) },
                      { label: 'Workflow', value: detail.workflowState || 'active' },
                    ]} />
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Switch
                        isSelected={detail.running}
                        isDisabled={busyIdx === detail.index}
                        onChange={(on) => (on ? enableWan(detail) : disableWan(detail))}
                      >
                        <Switch.Content>
                          <Switch.Control><Switch.Thumb /></Switch.Control>
                          <span className="text-xs">WAN toggle</span>
                        </Switch.Content>
                      </Switch>
                      {detail.proxyId ? (
                        <Button size="sm" onPress={async () => {
                          try {
                            const pw = await revealPassword(detail.proxyId!);
                            setRevealedPass(pw);
                          } catch (e) {
                            toast.danger(e instanceof Error ? e.message : 'Lỗi');
                          }
                        }}>Reveal pass</Button>
                      ) : null}
                      <Button size="sm" variant="secondary" onPress={() => copyFullProxy(detail, 'http')}>Copy HTTP URL</Button>
                      <Button size="sm" variant="outline" onPress={() => copyFullProxy(detail, 'socks5')}>Copy SOCKS URL</Button>
                      {detail.proxyId ? (
                        <Button size="sm" variant="ghost" onPress={async () => {
                          try {
                            const pw = await revealPassword(detail.proxyId!);
                            await copyText(pw);
                            toast.success('Đã copy password');
                          } catch (e) {
                            toast.danger(e instanceof Error ? e.message : 'Lỗi');
                          }
                        }}>Copy password</Button>
                      ) : null}
                      <Button size="sm" variant="ghost" isPending={busyIdx === detail.index} onPress={() => testProxy(detail)}>Test</Button>
                      <Button size="sm" variant="ghost" isPending={busyIdx === detail.index} onPress={() => reloadIp(detail)}>Reload IP</Button>
                    </div>
                  </>
                ) : null}
              </Drawer.Body>
            </Drawer.Dialog>
          </Drawer.Content>
        </Drawer.Backdrop>
      </Drawer>

      <Modal isOpen={createOpen} onOpenChange={setCreateOpen}>
        <Modal.Backdrop>
          <Modal.Container>
            <Modal.Dialog className="sm:max-w-md">
              <Modal.CloseTrigger />
              <Modal.Header><Modal.Heading>Tạo proxy</Modal.Heading></Modal.Header>
              <Modal.Body className="flex flex-col gap-4">
                <Select selectedKey={String(pppoeIdx)} onSelectionChange={(k) => setPppoeIdx(Number(k))}>
                  <Label>PPPoE interface</Label>
                  <Select.Trigger><Select.Value /></Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      {availableForCreate.map((f) => (
                        <ListBox.Item key={String(f.index)} id={String(f.index)} textValue={f.name}>
                          {f.name} · {f.publicIp || 'chưa có IP'} {f.running ? '· UP' : '· DOWN'}
                          <ListBox.ItemIndicator />
                        </ListBox.Item>
                      ))}
                    </ListBox>
                  </Select.Popover>
                </Select>
                <Select selectedKey={proxyType} onSelectionChange={(k) => setProxyType(String(k))}>
                  <Label>Loại proxy</Label>
                  <Select.Trigger><Select.Value /></Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      {[
                        { id: 'both', label: 'HTTP + SOCKS5' },
                        { id: 'http', label: 'HTTP only' },
                        { id: 'socks5', label: 'SOCKS5 only' },
                      ].map((t) => (
                        <ListBox.Item key={t.id} id={t.id} textValue={t.id}>{t.label}<ListBox.ItemIndicator /></ListBox.Item>
                      ))}
                    </ListBox>
                  </Select.Popover>
                </Select>
              </Modal.Body>
              <Modal.Footer>
                <Button variant="tertiary" onPress={() => setCreateOpen(false)}>Huỷ</Button>
                <Button onPress={createProxy}>Tạo</Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </div>
  );
}