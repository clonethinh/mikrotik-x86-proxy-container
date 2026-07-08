import type { ReactNode } from 'react';
import { Drawer, type DrawerProps, theme } from 'antd';

export type AppDrawerWidth = number | 'sm' | 'md' | 'lg' | 'xl';

const WIDTH_MAP: Record<Exclude<AppDrawerWidth, number>, number> = {
  sm: 400,
  md: 520,
  lg: 640,
  xl: 760,
};

export interface AppDrawerProps extends Omit<DrawerProps, 'title' | 'extra' | 'width'> {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  headerExtra?: ReactNode;
  width?: AppDrawerWidth;
}

export default function AppDrawer({
  title,
  subtitle,
  icon,
  headerExtra,
  width = 'md',
  className,
  children,
  ...rest
}: AppDrawerProps) {
  const { token } = theme.useToken();
  const resolvedWidth = typeof width === 'number' ? width : WIDTH_MAP[width];

  return (
    <Drawer
      {...rest}
      width={resolvedWidth}
      className={`app-drawer ${className ?? ''}`.trim()}
      extra={headerExtra}
      title={(
        <div className="app-drawer__head">
          {icon && <span className="app-drawer__icon">{icon}</span>}
          <div className="app-drawer__titles">
            <div className="app-drawer__title">{title}</div>
            {subtitle && <div className="app-drawer__subtitle">{subtitle}</div>}
          </div>
        </div>
      )}
      styles={{
        header: {
          padding: '16px 24px',
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          background: `linear-gradient(135deg, ${token.colorBgContainer} 0%, #f7faff 100%)`,
        },
        body: {
          padding: '20px 24px',
          background: token.colorBgLayout,
        },
        footer: {
          borderTop: `1px solid ${token.colorBorderSecondary}`,
          padding: '12px 24px',
          background: token.colorBgContainer,
        },
      }}
    >
      {children}
    </Drawer>
  );
}