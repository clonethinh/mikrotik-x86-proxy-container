import type { ReactNode } from 'react';
import { Card, Statistic, theme, Flex } from 'antd';

export interface MetricCardProps {
  title: string;
  value: number | string;
  prefix?: ReactNode;
  suffix?: ReactNode;
  icon?: ReactNode;
  valueStyle?: React.CSSProperties;
  accent?: 'primary' | 'success' | 'warning' | 'error' | 'purple' | 'default';
}

const ACCENT: Record<NonNullable<MetricCardProps['accent']>, { bar: string; iconBg: string; iconColor: string; value?: string }> = {
  primary: { bar: '#1677FF', iconBg: '#E6F4FF', iconColor: '#1677FF', value: '#1677FF' },
  success: { bar: '#52C41A', iconBg: '#F6FFED', iconColor: '#52C41A', value: '#52C41A' },
  warning: { bar: '#FAAD14', iconBg: '#FFFBE6', iconColor: '#D48806', value: '#D48806' },
  error: { bar: '#FF4D4F', iconBg: '#FFF2F0', iconColor: '#FF4D4F', value: '#FF4D4F' },
  purple: { bar: '#722ED1', iconBg: '#F9F0FF', iconColor: '#722ED1', value: '#722ED1' },
  default: { bar: '#D9D9D9', iconBg: '#FAFAFA', iconColor: '#595959' },
};

export default function MetricCard({
  title,
  value,
  prefix,
  suffix,
  icon,
  valueStyle,
  accent = 'default',
}: MetricCardProps) {
  const { token } = theme.useToken();
  const pal = ACCENT[accent];
  const displayIcon = icon ?? prefix;

  return (
    <Card
      className={`proxy-metric-card proxy-metric-card--${accent}`}
      styles={{ body: { padding: '18px 20px 16px' } }}
      style={{
        height: '100%',
        border: `1px solid ${token.colorBorderSecondary}`,
        boxShadow: token.boxShadowTertiary,
        borderTop: `3px solid ${pal.bar}`,
        borderRadius: token.borderRadiusLG,
      }}
    >
      <Flex justify="space-between" align="flex-start" gap={12}>
        <Statistic
          title={<span style={{ fontSize: 12, fontWeight: 500 }}>{title}</span>}
          value={value}
          prefix={icon ? undefined : prefix}
          suffix={suffix}
          valueStyle={{
            fontWeight: 700,
            fontSize: 28,
            lineHeight: 1.2,
            ...(pal.value ? { color: pal.value } : {}),
            ...valueStyle,
          }}
        />
        {displayIcon && (
          <div
            className="proxy-metric-card__icon"
            style={{
              width: 44,
              height: 44,
              borderRadius: 10,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 20,
              background: pal.iconBg,
              color: pal.iconColor,
              flexShrink: 0,
            }}
          >
            {displayIcon}
          </div>
        )}
      </Flex>
    </Card>
  );
}