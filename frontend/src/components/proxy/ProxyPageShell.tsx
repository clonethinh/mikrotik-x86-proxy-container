import type { ReactNode } from 'react';
import { Alert, Flex, Typography } from 'antd';

const { Title, Paragraph, Text } = Typography;

export interface ProxyPageShellProps {
  title: ReactNode;
  subtitle?: ReactNode;
  extra?: ReactNode;
  policy?: { message: string; description?: ReactNode };
  stats?: ReactNode;
  toolbar?: ReactNode;
  children: ReactNode;
}

export default function ProxyPageShell({
  title,
  subtitle,
  extra,
  policy,
  stats,
  toolbar,
  children,
}: ProxyPageShellProps) {
  return (
    <div className="proxy-page">
      <Flex className="proxy-page__hero" justify="space-between" align="flex-start" gap={16} wrap="wrap">
        <div>
          <Title level={3} className="proxy-page__hero-title">
            {title}
          </Title>
          {subtitle && (
            <Paragraph type="secondary" style={{ margin: '4px 0 0', maxWidth: 720 }}>
              {subtitle}
            </Paragraph>
          )}
        </div>
        {extra}
      </Flex>

      {policy && (
        <Alert
          className="proxy-policy-banner"
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message={policy.message}
          description={policy.description}
        />
      )}

      {stats}

      {toolbar}

      {children}
    </div>
  );
}

export function ProxyCode({ children }: { children: ReactNode }) {
  return <Text code>{children}</Text>;
}