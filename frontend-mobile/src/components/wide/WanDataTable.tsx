import { Button, Chip, Switch } from '@heroui/react';
import type { WanInfo } from '../../services/api';
import { HTTP_PORT_BASE, SOCKS_PORT_BASE } from '../../lib/proxyUtils';
import DataTable, { type DataTableColumn } from '../ui/DataTable';
import IpQualityTag from '../IpQualityTag';
import QuayIpTag from '../QuayIpTag';

export interface WanDataTableProps {
  rows: WanInfo[];
  selected: number[];
  busyIdx: number | null;
  onToggleSelect: (idx: number) => void;
  onSelectAll: (checked: boolean) => void;
  onRowClick: (row: WanInfo) => void;
  onToggle: (row: WanInfo, enable: boolean) => void;
}

export default function WanDataTable({
  rows, selected, busyIdx, onToggleSelect, onSelectAll, onRowClick, onToggle,
}: WanDataTableProps) {
  const allSelected = rows.length > 0 && rows.every((r) => selected.includes(r.index));

  const columns: DataTableColumn<WanInfo>[] = [
    {
      key: 'sel',
      header: <input type="checkbox" checked={allSelected} onChange={(e) => onSelectAll(e.target.checked)} aria-label="Chọn tất cả" />,
      width: '2.5rem',
      align: 'center',
      render: (r) => (
        <input type="checkbox" checked={selected.includes(r.index)} onChange={() => onToggleSelect(r.index)} aria-label={`Chọn ${r.name}`} />
      ),
    },
    { key: 'name', header: 'PPPoE', width: '7rem', render: (r) => <span className="font-semibold">{r.name}</span> },
    {
      key: 'status',
      header: 'Link',
      width: '4rem',
      render: (r) => <Chip size="sm" color={r.running ? 'success' : 'danger'}>{r.running ? 'UP' : 'DOWN'}</Chip>,
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
            <QuayIpTag quayipStatus={r.quayipStatus} quayipLabel={r.quayipLabel} />
          </div>
        </div>
      ),
    },
    { key: 'user', header: 'PPPoE user', width: '6rem', render: (r) => <span className="text-xs">{r.user || '—'}</span> },
    { key: 'uptime', header: 'Uptime', width: '5.5rem', render: (r) => <span className="text-xs">{r.uptime || '—'}</span> },
    {
      key: 'proxy',
      header: 'Proxy',
      width: '5rem',
      render: (r) => r.hasProxy ? (
        <Chip size="sm" color={r.proxyStatus === 'running' ? 'success' : 'default'}>{r.proxyStatus || '—'}</Chip>
      ) : <Chip size="sm">Chưa có</Chip>,
    },
    {
      key: 'ports',
      header: 'Ports',
      width: '7rem',
      render: (r) => (
        <span className="mobile-mono text-xs">:{HTTP_PORT_BASE + r.index} / :{SOCKS_PORT_BASE + r.index}</span>
      ),
    },
    {
      key: 'toggle',
      header: 'WAN',
      width: '4rem',
      align: 'center',
      render: (r) => (
        <Switch isSelected={r.running} isDisabled={busyIdx === r.index} onChange={(on) => onToggle(r, on)}>
          <Switch.Control><Switch.Thumb /></Switch.Control>
        </Switch>
      ),
    },
    {
      key: 'detail',
      header: '',
      width: '5rem',
      render: (r) => <Button size="sm" variant="secondary" onPress={() => onRowClick(r)}>Chi tiết</Button>,
    },
  ];

  return (
    <DataTable columns={columns} data={rows} rowKey={(r) => r.index} selectedKeys={new Set(selected)} onRowClick={onRowClick} />
  );
}