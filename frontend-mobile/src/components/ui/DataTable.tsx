import type { ReactNode } from 'react';

export interface DataTableColumn<T> {
  key: string;
  header: ReactNode;
  width?: string;
  align?: 'left' | 'center' | 'right';
  render: (row: T, index: number) => ReactNode;
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  data: T[];
  rowKey: (row: T) => string | number;
  empty?: ReactNode;
  onRowClick?: (row: T) => void;
  selectedKeys?: Set<string | number>;
  className?: string;
}

export default function DataTable<T>({
  columns,
  data,
  rowKey,
  empty,
  onRowClick,
  selectedKeys,
  className = '',
}: DataTableProps<T>) {
  if (data.length === 0 && empty) return <>{empty}</>;

  return (
    <div className={`data-table-wrap ${className}`}>
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                style={col.width ? { width: col.width, minWidth: col.width } : undefined}
                className={col.align ? `data-table-align-${col.align}` : undefined}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => {
            const key = rowKey(row);
            const selected = selectedKeys?.has(key);
            return (
              <tr
                key={key}
                className={`data-table-row${selected ? ' data-table-row-selected' : ''}${onRowClick ? ' data-table-row-clickable' : ''}`}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={col.align ? `data-table-align-${col.align}` : undefined}
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest('button, a, input, [role="switch"]')) {
                        e.stopPropagation();
                      }
                    }}
                  >
                    {col.render(row, i)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}