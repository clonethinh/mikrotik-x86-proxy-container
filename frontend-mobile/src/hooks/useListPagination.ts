import { useEffect, useMemo, useState } from 'react';

export function useListPagination<T>(
  items: T[],
  defaultPageSize = 20,
  resetKey: unknown = '',
) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultPageSize);

  useEffect(() => {
    setPage(1);
  }, [resetKey, pageSize]);

  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pageCount);

  const slice = useMemo(
    () => items.slice((safePage - 1) * pageSize, safePage * pageSize),
    [items, safePage, pageSize],
  );

  return {
    page: safePage,
    setPage,
    pageSize,
    setPageSize,
    total,
    pageCount,
    slice,
  };
}