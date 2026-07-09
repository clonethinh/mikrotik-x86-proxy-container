import { Link } from 'react-router-dom';
import { Button } from '@heroui/react';
import { useAuth } from '../services/auth';
import MobileHeader from '../components/layout/MobileHeader';
import PageLayout from '../components/layout/PageLayout';
import Panel from '../components/ui/Panel';
import SectionHeader from '../components/ui/SectionHeader';
import { staggerDelay } from '../lib/stagger';
import {
  IconAudit, IconChevronRight, IconDevices, IconLogout, IconMore, IconSettings,
} from '../components/ui/Icons';

const links = [
  { to: '/devices', title: 'Thiết bị LAN', desc: 'Gán IP / MAC / DHCP ra WAN cụ thể', Icon: IconDevices },
  { to: '/audit', title: 'Audit Log', desc: 'Theo dõi thao tác và đăng nhập', Icon: IconAudit },
  { to: '/settings', title: 'Cài đặt', desc: 'Auto-proxy, scripts, đổi mật khẩu', Icon: IconSettings },
] as const;

export default function MorePage() {
  const { user, logout } = useAuth();

  const handleLogout = async () => {
    await logout();
    const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
    window.location.href = base ? `${base}/login` : '/login';
  };

  return (
    <div>
      <MobileHeader
        title="Thêm"
        subtitle={user ? `${user.username} · ${user.role}` : undefined}
        icon={<IconMore />}
      />
      <PageLayout>
        <SectionHeader title="Quản trị" subtitle="Các mục bổ sung ngoài tab chính" />

        <Panel flush delay={60} className="more-menu-panel">
          {links.map((item, idx) => (
            <Link key={item.to} to={item.to} className="no-underline">
              <div
                className="more-menu-item animate-fade-up"
                style={{
                  animationDelay: `${staggerDelay(idx, 70)}ms`,
                  borderBottom: idx < links.length - 1 ? '1px solid color-mix(in oklch, var(--border) 45%, transparent)' : undefined,
                }}
              >
                <div className="more-menu-icon">
                  <item.Icon />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{item.title}</div>
                  <div className="mt-0.5 text-sm text-muted">{item.desc}</div>
                </div>
                <div className="more-menu-chevron" aria-hidden>
                  <IconChevronRight />
                </div>
              </div>
            </Link>
          ))}
        </Panel>

        <Panel delay={120}>
          <SectionHeader
            title="Phiên đăng nhập"
            subtitle="Mobile UI tách biệt — HeroUI v3 + Tailwind v4"
          />
          <Button className="mt-4 w-full" variant="outline" onPress={handleLogout}>
            <IconLogout className="mr-2 h-4 w-4" />
            Đăng xuất
          </Button>
        </Panel>
      </PageLayout>
    </div>
  );
}