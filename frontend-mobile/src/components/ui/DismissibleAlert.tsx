import { useState } from 'react';
import { Button } from '@heroui/react';
import Panel from './Panel';

const STORAGE_PREFIX = 'banner_dismissed:';

function readDismissed(id: string): boolean {
  try { return localStorage.getItem(`${STORAGE_PREFIX}${id}`) === '1'; } catch { return false; }
}

function writeDismissed(id: string): void {
  try { localStorage.setItem(`${STORAGE_PREFIX}${id}`, '1'); } catch { /* ignore */ }
}

interface DismissibleAlertProps {
  bannerId: string;
  title: string;
  children?: React.ReactNode;
  variant?: 'info' | 'warning' | 'danger';
  persist?: boolean;
}

export default function DismissibleAlert({
  bannerId,
  title,
  children,
  variant = 'info',
  persist = true,
}: DismissibleAlertProps) {
  const [visible, setVisible] = useState(() => (persist ? !readDismissed(bannerId) : true));

  if (!visible) return null;

  return (
    <Panel className={`dismissible-alert dismissible-alert-${variant}`}>
      <div className="dismissible-alert-head">
        <span className="dismissible-alert-title">{title}</span>
        <Button
          size="sm"
          variant="ghost"
          aria-label="Đóng"
          onPress={() => {
            setVisible(false);
            if (persist) writeDismissed(bannerId);
          }}
        >
          ✕
        </Button>
      </div>
      {children ? <div className="dismissible-alert-body">{children}</div> : null}
    </Panel>
  );
}