import { useState } from 'react';
import { Alert, type AlertProps } from 'antd';

const STORAGE_PREFIX = 'banner_dismissed:';

function readDismissed(bannerId: string): boolean {
  try {
    return localStorage.getItem(`${STORAGE_PREFIX}${bannerId}`) === '1';
  } catch {
    return false;
  }
}

function writeDismissed(bannerId: string): void {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${bannerId}`, '1');
  } catch {
    /* ignore quota / private mode */
  }
}

export interface DismissibleAlertProps extends Omit<AlertProps, 'closable' | 'onClose'> {
  /** Stable id for persistence (e.g. fleet-pool-rotation). */
  bannerId: string;
  /** Remember dismissal in localStorage. Default true. */
  persist?: boolean;
}

export default function DismissibleAlert({
  bannerId,
  persist = true,
  ...alertProps
}: DismissibleAlertProps) {
  const [visible, setVisible] = useState(() => (persist ? !readDismissed(bannerId) : true));

  if (!visible) return null;

  return (
    <Alert
      {...alertProps}
      closable
      onClose={() => {
        setVisible(false);
        if (persist) writeDismissed(bannerId);
      }}
    />
  );
}