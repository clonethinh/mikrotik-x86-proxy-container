import { useNavigate } from 'react-router-dom';
import { Button } from '@heroui/react';
import Panel from '../ui/Panel';
import { IconDashboard, IconDevices, IconFleet, IconProxy, IconSettings, IconWan } from '../ui/Icons';

const actions = [
  { to: '/fleet', label: 'Fleet', desc: 'WAN + container', Icon: IconFleet },
  { to: '/wan', label: 'WAN', desc: 'PPPoE pool', Icon: IconWan },
  { to: '/proxies', label: 'Proxies', desc: 'Proxy pool', Icon: IconProxy },
  { to: '/devices', label: 'Devices', desc: 'LAN routing', Icon: IconDevices },
  { to: '/settings', label: 'Settings', desc: 'Cấu hình', Icon: IconSettings },
] as const;

export default function DashboardQuickActions() {
  const navigate = useNavigate();

  return (
    <Panel className="dashboard-quick-actions">
      <div className="mb-2 flex items-center gap-2">
        <IconDashboard className="h-4 w-4 text-accent" />
        <span className="text-sm font-bold">Quick actions</span>
      </div>
      <div className="dashboard-quick-actions-grid">
        {actions.map((a) => (
          <Button
            key={a.to}
            className="dashboard-quick-action-btn"
            variant="secondary"
            onPress={() => navigate(a.to)}
          >
            <span className="dashboard-quick-action-icon" aria-hidden><a.Icon /></span>
            <span className="dashboard-quick-action-text">
              <span className="font-semibold">{a.label}</span>
              <span className="text-xs text-muted">{a.desc}</span>
            </span>
          </Button>
        ))}
      </div>
    </Panel>
  );
}