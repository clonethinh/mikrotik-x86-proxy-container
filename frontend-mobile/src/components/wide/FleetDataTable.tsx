import { Button, Chip, Switch } from '@heroui/react';
import type { WanInfo } from '../../services/api';
import { containerStatusColor, containerStatusLabel, extHttpPort, extSocksPort } from '../../lib/proxyUtils';
import { formatLatency } from '../../lib/format';
import DataTable, { type DataTableColumn } from '../ui/DataTable';
import IpQualityTag from '../IpQualityTag';
import EgressTag from '../EgressTag';

function workflowLabel(state: string | null | undefined) {
  if (!state || state === 'active') return null;
  const map: Record<string, string> = {
    discovered: 'Mới', countdown: 'Đếm ngược', provisioning: 'Đang tạo', queued: 'Hàng đợi',
    stale: 'Stale', gone: 'Đã rời', error: 'Lỗi', skipped: 'Đã hủy',
  };
  return map[state] ?? state;
}

export interface FleetDataTableProps {
  rows: WanInfo[];
  selected: number[];
  busyIdx: number | null;
  onToggleSelect: (idx: number) => void;
  onSelectAll: (checked: boolean) => void;
  onRowClick: (row: WanInfo) => void;
  onToggleWan: (row: WanInfo, enable: boolean) => void;
  onTest: (row: WanInfo) => void;
  onReload: (row: WanInfo) => void;
  onCopyHttp: (row: WanInfo) => void;
  onCopySocks: (row: WanInfo) => void;
  onEnableProxy: (row: WanInfo) => void;
  onCancelCountdown: (row: WanInfo) => void;
}

export default function FleetDataTable({
  rows,
  selected,
  busyIdx,
  onToggleSelect,
  onSelectAll,
  onRowClick,
  onToggleWan,
  onTest,
  onReload,
  onCopyHttp,
  onCopySocks,
  onEnableProxy,
  onCancelCountdown,
}: FleetDataTableProps) {
  const allSelected = rows.length > 0 && rows.every((r) => selected.includes(r.index));

  const columns: DataTableColumn<WanInfo>[] = [
    {
      key: 'sel',
      header: (
        <input
          type="checkbox"
          checked={allSelected}
          onChange={(e) => onSelectAll(e.target.checked)}
          aria-label="Chọn tất cả"
        />
      ),
      width: '2.5rem',
      align: 'center',
      render: (r) => (
        <input
          type="checkbox"
          checked={selected.includes(r.index)}
          onChange={() => onToggleSelect(r.index)}
          aria-label={`Chọn ${r.name}`}
        />
      ),
    },
    {
      key: 'wan',
      header: 'PPPoE',
      width: '8rem',
      render: (r) => (
        <div>
          <div className="font-semibold">{r.name}</div>
          {workflowLabel(r.workflowState) ? (
            <Chip size="sm" className="mt-1">{workflowLabel(r.workflowState)}</Chip>
          ) : null}
        </div>
      ),
    },
    {
      key: 'ip',
      header: 'IP public',
      width: '8.5rem',
      render: (r) => (
        <div className="flex flex-col gap-1">
          <span className="mobile-mono">{r.publicIp || '—'}</span>
          <div className="flex flex-wrap gap-1">
            <IpQualityTag {...r} publicIp={r.publicIp} />
            <EgressTag pppoeName={r.name} egressPppoeName={r.egressPppoeName} />
          </div>
        </div>
      ),
    },
    {
      key: 'link',
      header: 'Link',
      width: '4.5rem',
      render: (r) => (
        <Chip size="sm" color={r.running ? 'success' : 'danger'}>{r.running ? 'UP' : 'DOWN'}</Chip>
      ),
    },
    {
      key: 'uptime',
      header: 'Uptime',
      width: '5.5rem',
      render: (r) => <span className="text-xs">{r.uptime || '—'}</span>,
    },
    {
      key: 'container',
      header: 'Container',
      width: '6.5rem',
      render: (r) => r.containerStatus ? (
        <Chip size="sm" color={containerStatusColor(r.containerStatus)}>
          {containerStatusLabel(r.containerStatus)}
        </Chip>
      ) : <span className="text-muted">—</span>,
    },
    {
      key: 'http',
      header: 'HTTP',
      width: '6rem',
      render: (r) => (
        <button type="button" className="data-table-link mobile-mono" onClick={() => onCopyHttp(r)}>
          :{r.extHttpPort ?? extHttpPort(r.index)}
        </button>
      ),
    },
    {
      key: 'socks',
      header: 'SOCKS',
      width: '6rem',
      render: (r) => (
        <button type="button" className="data-table-link mobile-mono" onClick={() => onCopySocks(r)}>
          :{r.extSocksPort ?? extSocksPort(r.index)}
        </button>
      ),
    },
    {
      key: 'user',
      header: 'User',
      width: '5.5rem',
      render: (r) => <span className="mobile-mono text-xs">{r.username || '—'}</span>,
    },
    {
      key: 'lat',
      header: 'Latency',
      width: '4.5rem',
      render: (r) => <span className="text-xs">{formatLatency(r.lastLatencyMs)}</span>,
    },
    {
      key: 'wan-toggle',
      header: 'WAN',
      width: '4.5rem',
      align: 'center',
      render: (r) => (
        <Switch
          isSelected={r.running}
          isDisabled={busyIdx === r.index}
          onChange={(on) => onToggleWan(r, on)}
        >
          <Switch.Control><Switch.Thumb /></Switch.Control>
        </Switch>
      ),
    },
    {
      key: 'actions',
      header: '',
      width: '11rem',
      render: (r) => (
        <div className="data-table-actions">
          {r.workflowState === 'countdown' ? (
            <Button size="sm" variant="danger" isPending={busyIdx === r.index} onPress={() => onCancelCountdown(r)}>Hủy</Button>
          ) : null}
          {!r.hasContainer && r.running ? (
            <Button size="sm" isPending={busyIdx === r.index} onPress={() => onEnableProxy(r)}>Tạo</Button>
          ) : null}
          <Button size="sm" variant="outline" isDisabled={!r.proxyId} isPending={busyIdx === r.index} onPress={() => onTest(r)}>Test</Button>
          <Button size="sm" variant="ghost" isDisabled={!r.proxyId} isPending={busyIdx === r.index} onPress={() => onReload(r)}>Reload</Button>
        </div>
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={rows}
      rowKey={(r) => r.index}
      selectedKeys={new Set(selected)}
      onRowClick={onRowClick}
    />
  );
}