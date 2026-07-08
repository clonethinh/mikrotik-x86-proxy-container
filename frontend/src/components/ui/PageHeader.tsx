import type { ReactNode } from 'react';
import { Flex, Typography, theme } from 'antd';

const { Title, Paragraph } = Typography;

export interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  extra?: ReactNode;
  compact?: boolean;
}

export default function PageHeader({ title, subtitle, extra, compact }: PageHeaderProps) {
  const { token } = theme.useToken();

  return (
    <div
      className={`page-header-panel${compact ? ' page-header-panel--compact' : ''}`}
      style={{
        marginBottom: compact ? 10 : 20,
        padding: compact ? '12px 16px' : '20px 24px',
        borderRadius: token.borderRadiusLG,
        background: `linear-gradient(135deg, ${token.colorBgContainer} 0%, #f0f5ff 100%)`,
        border: `1px solid ${token.colorBorderSecondary}`,
        boxShadow: token.boxShadowTertiary,
      }}
    >
      <Flex justify="space-between" align="flex-start" gap={16} wrap="wrap">
        <div style={{ minWidth: 0, flex: 1 }}>
          <Title level={3} className="proxy-page__hero-title" style={{ fontSize: 22 }}>
            {title}
          </Title>
          {subtitle && (
            <Paragraph type="secondary" style={{ margin: '6px 0 0', maxWidth: 720, fontSize: 14 }}>
              {subtitle}
            </Paragraph>
          )}
        </div>
        {extra && <div style={{ flexShrink: 0 }}>{extra}</div>}
      </Flex>
    </div>
  );
}