import { Button, Label, ListBox, Select } from '@heroui/react';

interface PaginationBarProps {
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
  pageSizes?: number[];
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

export default function PaginationBar({
  page,
  pageCount,
  pageSize,
  total,
  pageSizes = [10, 15, 20, 30, 50, 100],
  onPageChange,
  onPageSizeChange,
}: PaginationBarProps) {
  const canPrev = page > 1;
  const canNext = page < pageCount;

  return (
    <div className="pagination-bar">
      <span className="pagination-bar-meta">{total} dòng · trang {page}/{pageCount}</span>
      <div className="pagination-bar-controls">
        <Select
          className="pagination-bar-size"
          selectedKey={String(pageSize)}
          onSelectionChange={(k) => onPageSizeChange(Number(k))}
          aria-label="Số dòng mỗi trang"
        >
          <Label className="sr-only">Page size</Label>
          <Select.Trigger><Select.Value /></Select.Trigger>
          <Select.Popover>
            <ListBox>
              {pageSizes.map((s) => (
                <ListBox.Item key={String(s)} id={String(s)} textValue={`${s}/trang`}>
                  {s}/trang<ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
        <Button size="sm" variant="outline" isDisabled={!canPrev} onPress={() => onPageChange(page - 1)}>
          Trước
        </Button>
        <Button size="sm" variant="outline" isDisabled={!canNext} onPress={() => onPageChange(page + 1)}>
          Sau
        </Button>
      </div>
    </div>
  );
}