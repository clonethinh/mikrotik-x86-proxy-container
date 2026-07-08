import type { ReactNode } from 'react';
import { Card, Col, Row, Statistic } from 'antd';

export interface ProxyStatItem {
  key: string;
  title: string;
  value: number | string;
  prefix?: ReactNode;
  suffix?: ReactNode;
  valueStyle?: React.CSSProperties;
}

interface Props {
  items: ProxyStatItem[];
}

export default function ProxyStatsRow({ items }: Props) {
  return (
    <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
      {items.map(item => (
        <Col key={item.key} xs={12} sm={12} md={6}>
          <Card size="small" className="proxy-stat-card" styles={{ body: { padding: '12px 16px' } }}>
            <Statistic
              title={item.title}
              value={item.value}
              prefix={item.prefix}
              suffix={item.suffix}
              valueStyle={item.valueStyle}
            />
          </Card>
        </Col>
      ))}
    </Row>
  );
}