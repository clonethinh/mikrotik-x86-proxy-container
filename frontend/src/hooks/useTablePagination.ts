import { useCallback, useEffect, useMemo, useState } from 'react';
import type { TablePaginationConfig } from 'antd';

type PageSizeOptions = (string | number)[];

export function useTablePagination(
  defaultPageSize = 20,
  pageSizeOptions: PageSizeOptions = ['10', '20', '50', '100'],
  showTotal?: (total: number) => string,
  resetDeps: unknown[] = [],
) {
  const [current, setCurrent] = useState(1);
  const [pageSize, setPageSize] = useState(defaultPageSize);

  const resetKey = JSON.stringify(resetDeps);
  useEffect(() => {
    setCurrent(1);
  }, [resetKey]);

  const onChange = useCallback((page: number, size: number) => {
    setCurrent(page);
    setPageSize(size);
  }, []);

  const pagination: TablePaginationConfig = useMemo(
    () => ({
      current,
      pageSize,
      showSizeChanger: true,
      pageSizeOptions,
      onChange,
      showTotal: showTotal ?? ((total: number) => `${total} dòng`),
    }),
    [current, pageSize, pageSizeOptions, onChange, showTotal],
  );

  return { current, pageSize, pagination, setCurrent, setPageSize };
}