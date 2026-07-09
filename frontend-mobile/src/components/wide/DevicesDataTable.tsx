import { Button, Chip, Switch } from '@heroui/react';
import type { DeviceRoute } from '../../services/api';
import DataTable, { type DataTableColumn } from '../ui/DataTable';

export interface DevicesDataTableProps {
  rows: DeviceRoute[];
  onToggle: (d: DeviceRoute, enabled: boolean) => void;
  onApply: (id: number) => void;
  onEdit: (d: DeviceRoute) => void;
  onDelete: (id: number) => void;
}

export default function DevicesDataTable({
  rows, onToggle, onApply, onEdit, onDelete,
}: DevicesDataTableProps) {
  const columns: DataTableColumn<DeviceRoute>[] = [
    { key: 'idx', header: '#', width: '2.5rem', align: 'center', render: (_, i) => i + 1 },
    { key: 'name', header: 'Tên', width: '7rem', render: (d) => <span className="font-semibold">{d.name}</span> },
    {
      key: 'match',
      header: 'Match',
      width: '5rem',
      render: (d) => <Chip size="sm">{d.matchType.toUpperCase()}</Chip>,
    },
    { key: 'ip', header: 'IP', width: '6.5rem', render: (d) => <span className="mobile-mono text-xs">{d.ipAddress || '—'}</span> },
    { key: 'mac', header: 'MAC', width: '7rem', render: (d) => <span className="mobile-mono text-xs">{d.macAddress || '—'}</span> },
    { key: 'wan', header: 'Egress WAN', width: '6.5rem', render: (d) => d.pppoeName },
    {
      key: 'status',
      header: 'Trạng thái',
      width: '8rem',
      render: (d) => (
        <div className="flex flex-wrap gap-1">
          <Chip size="sm" color={d.enabled ? 'success' : 'default'}>{d.enabled ? 'On' : 'Off'}</Chip>
          <Chip size="sm" color={d.applied ? 'accent' : 'warning'}>{d.applied ? 'OK' : 'Pending'}</Chip>
        </div>
      ),
    },
    {
      key: 'err',
      header: 'Lỗi',
      width: '8rem',
      render: (d) => <span className="text-xs text-danger">{d.statusMessage || '—'}</span>,
    },
    {
      key: 'toggle',
      header: 'Bật',
      width: '4rem',
      align: 'center',
      render: (d) => (
        <Switch isSelected={d.enabled} onChange={(v) => onToggle(d, v)}>
          <Switch.Control><Switch.Thumb /></Switch.Control>
        </Switch>
      ),
    },
    {
      key: 'actions',
      header: '',
      width: '10rem',
      render: (d) => (
        <div className="data-table-actions">
          {d.enabled && !d.applied ? (
            <Button size="sm" variant="outline" onPress={() => onApply(d.id)}>Apply</Button>
          ) : null}
          <Button size="sm" variant="secondary" onPress={() => onEdit(d)}>Sửa</Button>
          <Button size="sm" variant="danger" onPress={() => onDelete(d.id)}>Xoá</Button>
        </div>
      ),
    },
  ];

  return <DataTable columns={columns} data={rows} rowKey={(d) => d.id} />;
}