import { staggerDelay } from '../../lib/stagger';

interface KvItem {
  label: string;
  value: React.ReactNode;
}

interface KvListProps {
  items: KvItem[];
  /** @deprecated dùng mặc định compact */
  compact?: boolean;
  grid?: boolean;
}

export default function KvList({ items, compact = true, grid = false }: KvListProps) {
  const listClass = grid ? 'mobile-kv-grid' : 'flex flex-col gap-2';
  const itemClass = compact !== false ? 'mobile-kv mobile-kv-compact' : 'mobile-kv';

  return (
    <dl className={listClass}>
      {items.map((item, idx) => (
        <div
          key={item.label}
          className={`${itemClass} animate-fade-up`}
          style={{ animationDelay: `${staggerDelay(idx, 35, 350)}ms` }}
        >
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}