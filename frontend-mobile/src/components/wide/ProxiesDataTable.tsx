import { Button, Chip, Switch } from '@heroui/react';
import type { ProxyUser, WanInfo } from '../../services/api';
import type { LiveMetrics } from '../../types/proxies';
import { formatBps } from '../../lib/format';
import { effectiveLatencyMs, isLatencyStale } from '../../lib/proxyLatency';
import { proxyStatusColor } from '../../lib/proxyUtils';
import DataTable, { type DataTableColumn } from '../ui/DataTable';
import IpQualityTag from '../IpQualityTag';
import EgressTag from '../EgressTag';

export interface ProxiesDataTableProps {
  rows: ProxyUser[];
  selected: number[];
  busy: number | null;
  metricsMap: Record<number, LiveMetrics>;
  wanByIdx: Map<number, WanInfo>;
  onToggleSelect: (id: number) => void;
  onSelectAll: (checked: boolean) => void;
  onRowClick: (p: ProxyUser) => void;
  onToggle: (p: ProxyUser) => void;
  onTest: (p: ProxyUser) => void;
  onReload: (p: ProxyUser) => void;
  onAnalytics: (p: ProxyUser) => void;
  onOpenConnection: (p: ProxyUser) => void;
}

export default function ProxiesDataTable({
  rows,
  selected,
  busy,
  metricsMap,
  wanByIdx,
  onToggleSelect,
  onSelectAll,
  onRowClick,
  onToggle,
  onTest,
  onReload,
  onAnalytics,
  onOpenConnection,
}: ProxiesDataTableProps) {
  const allSelected = rows.length > 0 && rows.every((r) => selected.includes(r.id));

  const columns: DataTableColumn<ProxyUser>[] = [
    {
      key: 'sel',
      header: <input type="checkbox" checked={allSelected} onChange={(e) => onSelectAll(e.target.checked)} aria-label="Chọn tất cả" />,
      width: '2.5rem',
      align: 'center',
      render: (p) => (
        <input type="checkbox" checked={selected.includes(p.id)} onChange={() => onToggleSelect(p.id)} aria-label={`Chọn ${p.pppoeName}`} />
      ),
    },
    { key: 'pppoe', header: 'PPPoE', width: '6.5rem', render: (p) => <span className="font-semibold">{p.pppoeName}</span> },
    {
      key: 'ip',
      header: 'IP',
      width: '7.5rem',
      render: (p) => (
        <div className="flex flex-col gap-1">
          <span className="mobile-mono" title={p.ipQualityHint || 'Client kết nối qua IP egress của proxy'}>
            {p.publicIp || '—'}
          </span>
          <div className="flex flex-wrap gap-1">
            <IpQualityTag {...p} publicIp={p.publicIp} />
            <EgressTag pppoeName={p.pppoeName} egressPppoeName={p.egressPppoeName} />
          </div>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: '5rem',
      render: (p) => <Chip size="sm" color={proxyStatusColor(p.status)}>{p.status}</Chip>,
    },
    {
      key: 'lat',
      header: 'Latency',
      width: '4.5rem',
      render: (p) => {
        const ms = effectiveLatencyMs(p, wanByIdx.get(p.pppoeIdx));
        const stale = isLatencyStale(p);
        return (
          <span className={`text-xs${stale && ms != null ? ' text-muted' : ''}`} title={stale && ms != null ? 'Latency cũ' : undefined}>
            {ms != null ? `${ms}ms` : '—'}
          </span>
        );
      },
    },
    {
      key: 'http',
      header: 'HTTP',
      width: '4.5rem',
      render: (p) => (
        p.proxyType !== 'socks5' && p.extHttpPort ? (
          <Button size="sm" variant="outline" className="mobile-mono min-w-0 px-2" onPress={() => onOpenConnection(p)}>
            :{p.extHttpPort}
          </Button>
        ) : <span className="text-muted">—</span>
      ),
    },
    {
      key: 'socks',
      header: 'SOCKS',
      width: '4.5rem',
      render: (p) => (
        p.proxyType !== 'http' && p.extSocksPort ? (
          <Button size="sm" variant="ghost" className="mobile-mono min-w-0 px-2" onPress={() => onOpenConnection(p)}>
            :{p.extSocksPort}
          </Button>
        ) : <span className="text-muted">—</span>
      ),
    },
    { key: 'user', header: 'User', width: '5rem', render: (p) => <span className="mobile-mono text-xs">{p.username}</span> },
    {
      key: 'traffic',
      header: 'Traffic',
      width: '7rem',
      render: (p) => {
        const m = metricsMap[p.id];
        if (!m) return <span className="text-muted">—</span>;
        const active = (m.rxBps ?? 0) > 0 || (m.txBps ?? 0) > 0;
        const sampledAt = m.sampledAt ? Date.parse(m.sampledAt) : 0;
        const fresh = sampledAt > 0 && Date.now() - sampledAt < 30_000;
        return (
          <div className="text-xs" title={m.sampledAt ? new Date(m.sampledAt).toLocaleTimeString() : undefined}>
            <div>{m.clients} cli</div>
            <div className={`mobile-mono${active ? '' : ' text-muted'}`}>↓{formatBps(m.rxBps)} ↑{formatBps(m.txBps)}</div>
            {!fresh && !active ? <div className="text-muted">idle</div> : null}
          </div>
        );
      },
    },
    {
      key: 'on',
      header: 'ON',
      width: '3.5rem',
      align: 'center',
      render: (p) => (
        <Switch isSelected={p.enabled} isDisabled={busy === p.id} onChange={() => onToggle(p)}>
          <Switch.Control><Switch.Thumb /></Switch.Control>
        </Switch>
      ),
    },
    {
      key: 'actions',
      header: '',
      width: '12rem',
      render: (p) => (
        <div className="data-table-actions">
          <Button size="sm" variant="outline" isPending={busy === p.id} onPress={() => onTest(p)}>Test</Button>
          <Button size="sm" variant="ghost" isPending={busy === p.id} onPress={() => onReload(p)}>Reload</Button>
          <Button size="sm" variant="secondary" onPress={() => onAnalytics(p)}>Analytics</Button>
        </div>
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={rows}
      rowKey={(p) => p.id}
      selectedKeys={new Set(selected)}
      onRowClick={onRowClick}
    />
  );
}