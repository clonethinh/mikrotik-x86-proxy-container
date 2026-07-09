import { NavLink } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
import { springBounce } from '../../lib/motion';
import { bottomNavItems } from './navItems';

export default function BottomNav() {
  const reduce = useReducedMotion();

  return (
    <motion.nav
      className="mobile-bottom-nav"
      aria-label="Điều hướng chính"
      initial={reduce ? false : { opacity: 0, y: 32 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...springBounce, delay: 0.05 }}
    >
      {bottomNavItems.map(({ to, label, Icon }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) => `mobile-nav-item${isActive ? ' active' : ''}`}
        >
          {({ isActive }) => (
            <>
              {isActive && !reduce ? (
                <motion.span
                  layoutId="bottom-nav-active"
                  className="mobile-nav-active-pill"
                  transition={springBounce}
                />
              ) : null}
              <span className="mobile-nav-icon-wrap">
                <Icon />
              </span>
              <span>{label}</span>
            </>
          )}
        </NavLink>
      ))}
    </motion.nav>
  );
}