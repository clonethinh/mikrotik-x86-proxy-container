import { Input, Label, SearchField } from '@heroui/react';

interface SearchBarProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}

export default function SearchBar({ value, onChange, placeholder = 'Tìm kiếm…' }: SearchBarProps) {
  return (
    <SearchField
      className="w-full"
      value={value}
      onChange={(v) => onChange(String(v))}
      aria-label={placeholder}
    >
      <Label className="sr-only">Tìm kiếm</Label>
      <Input placeholder={placeholder} />
    </SearchField>
  );
}