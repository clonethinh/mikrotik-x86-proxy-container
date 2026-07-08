import type { ReactNode } from 'react';
import { Card, Flex, theme, Typography } from 'antd';

const { Text } = Typography;

export interface SettingsSectionCardProps {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  extra?: ReactNode;
  children: ReactNode;
  accent?: string;
  className?: string;
}

export default function SettingsSectionCard({
  title,
  description,
  icon,
  extra,
  children,
  accent,
  className,
}: SettingsSectionCardProps) {
  const { token } = theme.useToken();
  const bar = accent ?? token.colorPrimary;

  return (
    <Card
      className={`settings-section-card ${className ?? ''}`.trim()}
      style={{
        marginBottom: 16,
        borderLeft: `3px solid ${bar}`,
        boxShadow: token.boxShadowTertiary,
      }}
      title={(
        <Flex align="center" gap={10}>
          {icon && (
            <span className="settings-section-card__icon" style={{ background: `${bar}14`, color: bar }}>
              {icon}
            </span>
          )}
          <div>
            <div className="settings-section-card__title">{title}</div>
            {description && (
              <Text type="secondary" className="settings-section-card__desc">{description}</Text>
            )}
          </div>
        </Flex>
      )}
      extra={extra}
    >
      {children}
    </Card>
  );
}