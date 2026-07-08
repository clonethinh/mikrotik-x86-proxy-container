import type { ReactNode } from 'react';
import { Card, Flex, Progress, Space, Tag, Typography, theme } from 'antd';

const { Text, Title } = Typography;

export interface HealthStatItem {
  key: string;
  label: string;
  value: number;
  icon?: ReactNode;
  color?: string;
}

interface Props {
  title: string;
  percent: number;
  subtitle: string;
  items: HealthStatItem[];
  accent?: string;
}

export default function DashboardHealthCard({ title, percent, subtitle, items, accent }: Props) {
  const { token } = theme.useToken();
  const stroke = accent ?? (percent >= 90 ? token.colorSuccess : percent >= 70 ? token.colorPrimary : token.colorWarning);
  const status = percent >= 90 ? 'success' : percent >= 70 ? 'active' : 'normal';

  return (
    <Card className="dashboard-health-card" style={{ boxShadow: token.boxShadowTertiary, height: '100%' }}>
      <Flex gap={20} align="center" wrap="wrap">
        <Progress
          type="dashboard"
          percent={percent}
          size={120}
          strokeWidth={10}
          strokeColor={stroke}
          status={status}
          format={p => (
            <div className="dashboard-health-card__ring">
              <span className="dashboard-health-card__pct">{p}%</span>
              <span className="dashboard-health-card__pct-label">healthy</span>
            </div>
          )}
        />
        <div style={{ flex: 1, minWidth: 180 }}>
          <Title level={5} style={{ margin: 0, fontWeight: 600 }}>{title}</Title>
          <Text type="secondary" style={{ fontSize: 13 }}>{subtitle}</Text>
          <Space wrap size={[8, 8]} style={{ marginTop: 14 }}>
            {items.map(item => (
              <Tag
                key={item.key}
                icon={item.icon}
                color={item.color}
                bordered={false}
                className="dashboard-health-card__tag"
              >
                {item.value} {item.label}
              </Tag>
            ))}
          </Space>
        </div>
      </Flex>
    </Card>
  );
}