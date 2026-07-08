import type { ReactNode } from 'react';
import { Card, Divider, Flex, theme } from 'antd';

export interface ProxyToolbarProps {
  filters?: ReactNode;
  actions?: ReactNode;
  bulk?: ReactNode;
  className?: string;
}

export default function ProxyToolbar({ filters, actions, bulk, className }: ProxyToolbarProps) {
  const { token } = theme.useToken();

  return (
    <Card
      className={`proxy-toolbar-card ${className ?? ''}`.trim()}
      style={{
        marginBottom: 16,
        borderLeft: `3px solid ${token.colorPrimary}`,
      }}
    >
      <Flex gap={12} wrap="wrap" align="center" justify="space-between">
        {filters && (
          <Flex gap={12} wrap="wrap" align="center" className="proxy-toolbar__filters" style={{ flex: 1 }}>
            {filters}
          </Flex>
        )}
        {actions && (
          <Flex gap={8} wrap="wrap" align="center" className="proxy-toolbar__actions">
            {actions}
          </Flex>
        )}
      </Flex>
      {bulk && (
        <>
          <Divider className="proxy-toolbar__divider" />
          <div className="proxy-bulk-bar">{bulk}</div>
        </>
      )}
    </Card>
  );
}