import type { ReactNode } from 'react';

export interface ProxyInlineStatItem {
  key: string;
  label: string;
  value: number | string;
  tone?: 'primary' | 'success' | 'warning' | 'error' | 'default';
}

interface Props {
  items: ProxyInlineStatItem[];
  extra?: ReactNode;
}

const TONE_CLASS: Record<NonNullable<ProxyInlineStatItem['tone']>, string> = {
  primary: 'proxy-inline-stat--primary',
  success: 'proxy-inline-stat--success',
  warning: 'proxy-inline-stat--warning',
  error: 'proxy-inline-stat--error',
  default: '',
};

export default function ProxyInlineStats({ items, extra }: Props) {
  return (
    <div className="proxy-inline-stats">
      <div className="proxy-inline-stats__items">
        {items.map(item => (
          <div
            key={item.key}
            className={`proxy-inline-stat ${TONE_CLASS[item.tone ?? 'default']}`}
          >
            <span className="proxy-inline-stat__value">{item.value}</span>
            <span className="proxy-inline-stat__label">{item.label}</span>
          </div>
        ))}
      </div>
      {extra && <div className="proxy-inline-stats__extra">{extra}</div>}
    </div>
  );
}