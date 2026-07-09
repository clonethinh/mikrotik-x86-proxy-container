import type { ComponentType } from 'react';
import {
  IconAudit, IconDashboard, IconDevices, IconFleet, IconMore, IconProxy, IconSettings, IconWan,
} from '../ui/Icons';

export interface NavItem {
  to: string;
  label: string;
  shortLabel?: string;
  Icon: ComponentType<{ className?: string }>;
}

/** Tab chính — hiện trên bottom nav (điện thoại) */
export const primaryNavItems: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', shortLabel: 'Dash', Icon: IconDashboard },
  { to: '/fleet', label: 'Fleet', Icon: IconFleet },
  { to: '/proxies', label: 'Proxies', Icon: IconProxy },
  { to: '/wan', label: 'WAN', Icon: IconWan },
];

/** Mục phụ — sidebar tablet+ (trên điện thoại nằm trong More) */
export const secondaryNavItems: NavItem[] = [
  { to: '/devices', label: 'Thiết bị LAN', shortLabel: 'Devices', Icon: IconDevices },
  { to: '/audit', label: 'Audit Log', shortLabel: 'Audit', Icon: IconAudit },
  { to: '/settings', label: 'Cài đặt', shortLabel: 'Settings', Icon: IconSettings },
];

export const bottomNavItems: NavItem[] = [
  ...primaryNavItems,
  { to: '/more', label: 'Thêm', Icon: IconMore },
];