import { Chip } from '@heroui/react';
import type { AuditItem } from '../../services/api';
import { formatDateTime } from '../../lib/format';
import DataTable, { type DataTableColumn } from '../ui/DataTable';

function actionColor(action: string): 'default' | 'success' | 'danger' | 'accent' | 'warning' {
  if (action.includes('delete')) return 'danger';
  if (action.includes('create')) return 'success';
  if (action.includes('login')) return 'accent';
  if (action.includes('error') || action.includes('fail')) return 'warning';
  return 'default';
}

export default function AuditDataTable({ rows }: { rows: AuditItem[] }) {
  const columns: DataTableColumn<AuditItem>[] = [
    { key: 'time', header: 'Thời gian', width: '8.5rem', render: (r) => <span className="text-xs">{formatDateTime(r.createdAt)}</span> },
    { key: 'user', header: 'User', width: '5.5rem', render: (r) => r.username },
    { key: 'action', header: 'Action', width: '5.5rem', render: (r) => <Chip size="sm" color={actionColor(r.action)}>{r.action}</Chip> },
    {
      key: 'resource',
      header: 'Resource',
      width: '6rem',
      render: (r) => r.resource ? `${r.resource}${r.resourceId != null ? ` #${r.resourceId}` : ''}` : '—',
    },
    { key: 'ip', header: 'IP', width: '6.5rem', render: (r) => <span className="mobile-mono text-xs">{r.ip || '—'}</span> },
    {
      key: 'details',
      header: 'Details',
      render: (r) => (
        <pre className="audit-details-pre m-0 max-h-24 overflow-auto whitespace-pre-wrap text-xs">{r.details || '—'}</pre>
      ),
    },
  ];

  return <DataTable columns={columns} data={rows} rowKey={(r) => r.id} />;
}