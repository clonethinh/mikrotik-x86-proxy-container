import type { ReactNode } from 'react';

export interface DrawerSectionProps {
  title: ReactNode;
  children: ReactNode;
  extra?: ReactNode;
  className?: string;
}

export function DrawerSection({ title, children, extra, className }: DrawerSectionProps) {
  return (
    <section className={`drawer-section ${className ?? ''}`.trim()}>
      <div className="drawer-section__head">
        <span className="drawer-section__title">{title}</span>
        {extra}
      </div>
      <div className="drawer-section__body">{children}</div>
    </section>
  );
}

export interface DrawerKvProps {
  label: ReactNode;
  children: ReactNode;
  icon?: ReactNode;
}

export function DrawerKv({ label, children, icon }: DrawerKvProps) {
  return (
    <div className="drawer-kv">
      <div className="drawer-kv__label">
        {icon && <span className="drawer-kv__icon">{icon}</span>}
        {label}
      </div>
      <div className="drawer-kv__value">{children}</div>
    </div>
  );
}

export function DrawerKvGrid({ children }: { children: ReactNode }) {
  return <div className="drawer-kv-grid">{children}</div>;
}

export interface DrawerStatusBandProps {
  children: ReactNode;
  tone?: 'success' | 'warning' | 'error' | 'info' | 'default';
}

export function DrawerStatusBand({ children, tone = 'default' }: DrawerStatusBandProps) {
  return (
    <div className={`drawer-status-band drawer-status-band--${tone}`}>
      {children}
    </div>
  );
}