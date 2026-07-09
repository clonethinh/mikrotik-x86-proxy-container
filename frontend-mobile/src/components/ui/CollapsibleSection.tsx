import { useState } from 'react';
import Panel from './Panel';
import SectionHeader from './SectionHeader';

interface CollapsibleSectionProps {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  badge?: React.ReactNode;
  defaultOpen?: boolean;
  delay?: number;
  children: React.ReactNode;
}

export default function CollapsibleSection({
  title,
  subtitle,
  action,
  badge,
  defaultOpen = true,
  delay = 0,
  children,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Panel flush delay={delay} className="collapsible-section">
      <div className="collapsible-section-trigger">
        <button
          type="button"
          className="collapsible-section-hit min-w-0 flex-1"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <SectionHeader
            title={title}
            subtitle={open ? subtitle : undefined}
          />
        </button>
        <div className="collapsible-section-side">
          {!open && badge ? <div className="collapsible-section-badge">{badge}</div> : null}
          {action}
          <button
            type="button"
            className={`collapsible-chevron ${open ? 'collapsible-chevron-open' : ''}`}
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? 'Thu gọn' : 'Mở rộng'}
          >
            <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
              <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
      </div>

      <div className={`collapsible-section-body${open ? ' is-open' : ''}`}>
        <div className="collapsible-section-content">{children}</div>
      </div>
    </Panel>
  );
}