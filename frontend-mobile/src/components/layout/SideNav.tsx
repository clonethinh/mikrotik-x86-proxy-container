import { NavLink } from 'react-router-dom';
import { Button } from '@heroui/react';
import { motion, useReducedMotion } from 'motion/react';
import { springBounce } from '../../lib/motion';
import { useAuth } from '../../services/auth';
import { IconLogout, IconServer } from '../ui/Icons';
import { primaryNavItems, secondaryNavItems, type NavItem } from './navItems';

function SideNavLink({ to, label, Icon }: { to: string; label: string; Icon: NavItem['Icon'] }) {
  const reduce = useReducedMotion();

  return (
    <NavLink
      to={to}
      className={({ isActive }) => `mobile-side-nav-item${isActive ? ' active' : ''}`}
      title={label}
    >
      {({ isActive }) => (
        <>
          {isActive && !reduce ? (
            <motion.span
              layoutId="side-nav-active"
              className="mobile-side-nav-active-pill"
              transition={springBounce}
            />
          ) : null}
          <span className="mobile-side-nav-icon" aria-hidden>
            <Icon />
          </span>
          <span className="mobile-side-nav-label">{label}</span>
        </>
      )}
    </NavLink>
  );
}

export default function SideNav() {
  const { user, logout } = useAuth();

  const handleLogout = async () => {
    await logout();
    const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
    window.location.href = base ? `${base}/login` : '/login';
  };

  return (
    <aside className="mobile-side-nav" aria-label="Điều hướng tablet">
      <div className="mobile-side-nav-brand">
        <div className="mobile-side-nav-brand-icon" aria-hidden>
          <IconServer />
        </div>
        <div className="mobile-side-nav-brand-text">
          <span className="mobile-side-nav-brand-title">MikroTik</span>
          <span className="mobile-side-nav-brand-sub">Proxy Console</span>
        </div>
      </div>

      <nav className="mobile-side-nav-section">
        <span className="mobile-side-nav-section-label">Chính</span>
        {primaryNavItems.map((item) => (
          <SideNavLink key={item.to} to={item.to} label={item.label} Icon={item.Icon} />
        ))}
      </nav>

      <nav className="mobile-side-nav-section">
        <span className="mobile-side-nav-section-label">Quản trị</span>
        {secondaryNavItems.map((item) => (
          <SideNavLink key={item.to} to={item.to} label={item.label} Icon={item.Icon} />
        ))}
      </nav>

      <div className="mobile-side-nav-footer">
        {user ? (
          <div className="mobile-side-nav-user">
            <span className="mobile-side-nav-username">{user.username}</span>
            <span className="mobile-side-nav-role">{user.role}</span>
          </div>
        ) : null}
        <Button className="w-full" size="sm" variant="outline" onPress={handleLogout}>
          <IconLogout className="mr-1.5 h-3.5 w-3.5" />
          Đăng xuất
        </Button>
      </div>
    </aside>
  );
}