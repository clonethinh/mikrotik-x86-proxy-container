import { Button } from '@heroui/react';

interface FilterChipProps {
  label: string;
  active: boolean;
  onSelect: () => void;
  count?: number;
}

export default function FilterChip({ label, active, onSelect, count }: FilterChipProps) {
  const display = count != null ? `${label} (${count})` : label;
  return (
    <Button
      size="sm"
      variant={active ? 'primary' : 'secondary'}
      onPress={onSelect}
      className={`filter-pill ${active ? 'filter-pill-active' : ''}`}
      data-active={active ? 'true' : 'false'}
    >
      {display}
    </Button>
  );
}