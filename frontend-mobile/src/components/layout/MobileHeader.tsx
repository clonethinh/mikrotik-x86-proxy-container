import { Button, Chip } from '@heroui/react';
import { useWSStore } from '../../services/ws';
import { IconRefresh } from '../ui/Icons';

interface MobileHeaderProps {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
  actions?: React.ReactNode;
}

export default function MobileHeader({ title, subtitle, icon, onRefresh, refreshing, actions }: MobileHeaderProps) {
  const connected = useWSStore((s) => s.connected);

  return (
    <header className="mobile-header animate-header-enter">
      <div className="mobile-header-title-wrap min-w-0 flex-1">
        {icon ? <div className="mobile-header-icon" aria-hidden>{icon}</div> : null}
        <div className="min-w-0">
          <h1 className="mobile-truncate">{title}</h1>
          {subtitle ? <div className="mobile-header-subtitle mobile-truncate">{subtitle}</div> : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Chip size="sm" color={connected ? 'success' : 'warning'}>
          <span className="flex items-center gap-1.5">
            <span className={`live-dot inline-block h-1.5 w-1.5 rounded-full ${connected ? 'live-dot-on bg-success' : 'bg-warning'}`} />
            {connected ? 'Live' : 'Offline'}
          </span>
        </Chip>
        {onRefresh ? (
          <Button
            isIconOnly
            size="sm"
            variant="secondary"
            aria-label="Làm mới"
            isPending={refreshing}
            onPress={onRefresh}
          >
            <IconRefresh />
          </Button>
        ) : null}
        {actions}
      </div>
    </header>
  );
}