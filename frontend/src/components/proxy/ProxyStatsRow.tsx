import type { ReactNode } from 'react';
import { Col, Row } from 'antd';
import MetricCard, { type MetricCardProps } from '../ui/MetricCard';

export interface ProxyStatItem {
  key: string;
  title: string;
  value: number | string;
  prefix?: ReactNode;
  suffix?: ReactNode;
  icon?: ReactNode;
  valueStyle?: React.CSSProperties;
  accent?: MetricCardProps['accent'];
}

interface Props {
  items: ProxyStatItem[];
}

export default function ProxyStatsRow({ items }: Props) {
  const colSpan = items.length <= 4 ? 6 : 4;
  return (
    <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
      {items.map(item => (
        <Col key={item.key} xs={12} sm={12} md={colSpan}>
          <MetricCard
            title={item.title}
            value={item.value}
            prefix={item.prefix}
            suffix={item.suffix}
            icon={item.icon}
            valueStyle={item.valueStyle}
            accent={item.accent}
          />
        </Col>
      ))}
    </Row>
  );
}