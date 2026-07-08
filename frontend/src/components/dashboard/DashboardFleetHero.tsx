import type { ReactNode } from 'react';
import { Flex, Progress, Space, Tag, Typography, theme } from 'antd';
import {
  CloudServerOutlined, GlobalOutlined,
  ApiOutlined, HeartOutlined, CloseCircleOutlined,
} from '@ant-design/icons';
import type { DashboardData } from '../../services/api';

const { Text, Title } = Typography;

function fleetHealthScore(data: DashboardData): number {
  const parts: number[] = [];
  if (data.totalWan > 0) parts.push((data.wanUp / data.totalWan) * 100);
  if (data.totalProxies > 0) parts.push((data.runningProxies / data.totalProxies) * 100);
  if ((data.containerProxies || 0) > 0) {
    parts.push(((data.containerHealthy || 0) / (data.containerProxies || 1)) * 100);
  }
  parts.push(data.webuiRunning ? 100 : 0);
  return parts.length ? Math.round(parts.reduce((a, b) => a + b, 0) / parts.length) : 0;
}

function healthTone(pct: number, token: ReturnType<typeof theme.useToken>['token']) {
  if (pct >= 90) return { stroke: token.colorSuccess, status: 'success' as const, label: 'Ổn định' };
  if (pct >= 70) return { stroke: token.colorWarning, status: 'normal' as const, label: 'Cần theo dõi' };
  return { stroke: token.colorError, status: 'exception' as const, label: 'Có vấn đề' };
}

interface PillProps {
  icon: ReactNode;
  label: string;
  value: string;
  ok: boolean;
  warn?: boolean;
}

function StatusPill({ icon, label, value, ok, warn }: PillProps) {
  const { token } = theme.useToken();
  const bg = ok ? '#f6ffed' : warn ? '#fffbe6' : '#fff2f0';
  const border = ok ? '#b7eb8f' : warn ? '#ffe58f' : '#ffccc7';
  const color = ok ? token.colorSuccess : warn ? token.colorWarning : token.colorError;

  return (
    <div className="dashboard-hero-pill" style={{ background: bg, borderColor: border }}>
      <span className="dashboard-hero-pill__icon" style={{ color }}>{icon}</span>
      <div className="dashboard-hero-pill__body">
        <Text type="secondary" className="dashboard-hero-pill__label">{label}</Text>
        <Text strong className="dashboard-hero-pill__value" style={{ color: token.colorText }}>{value}</Text>
      </div>
    </div>
  );
}

interface Props {
  data: DashboardData;
  pollSec: number;
  refreshing?: boolean;
}

export default function DashboardFleetHero({ data, pollSec, refreshing }: Props) {
  const { token } = theme.useToken();
  const score = fleetHealthScore(data);
  const tone = healthTone(score, token);
  const wanDown = data.totalWan - data.wanUp;
  const hasContainers = (data.containerProxies ?? 0) > 0;
  const hasProxies = data.totalProxies > 0;

  return (
    <div className="dashboard-fleet-hero">
      <div className="dashboard-fleet-hero__glow" aria-hidden />
      <Flex align="center" justify="space-between" gap={24} wrap="wrap">
        <Flex align="center" gap={20} className="dashboard-fleet-hero__score">
          <Progress
            type="circle"
            percent={score}
            size={96}
            strokeWidth={8}
            strokeColor={tone.stroke}
            status={tone.status}
            format={p => (
              <div className="dashboard-fleet-hero__ring-inner">
                <span className="dashboard-fleet-hero__ring-value">{p}%</span>
                <span className="dashboard-fleet-hero__ring-label">Fleet</span>
              </div>
            )}
          />
          <div>
            <Space size={8} align="center">
              <span className={`dashboard-live-dot${refreshing ? ' dashboard-live-dot--pulse' : ''}`} />
              <Tag bordered={false} color={tone.status === 'success' ? 'success' : tone.status === 'exception' ? 'error' : 'warning'}>
                {tone.label}
              </Tag>
              <Text type="secondary" style={{ fontSize: 12 }}>MikroTik live · {pollSec}s</Text>
            </Space>
            <Title level={4} style={{ margin: '6px 0 4px', fontWeight: 600 }}>
              Tình trạng hệ thống
            </Title>
            <Text type="secondary" style={{ fontSize: 13 }}>
              {data.wanUp} WAN UP · {data.runningProxies} container proxy · {data.containerHealthy ?? 0} OK trên router
            </Text>
          </div>
        </Flex>

        <div className="dashboard-hero-pills">
          <StatusPill
            icon={<GlobalOutlined />}
            label="PPPoE WAN"
            value={`${data.wanUp}/${data.totalWan} UP`}
            ok={wanDown === 0}
            warn={wanDown > 0 && data.wanUp > 0}
          />
          <StatusPill
            icon={<ApiOutlined />}
            label={data.errorProxies > 0 ? 'Proxy lỗi' : 'Proxy container'}
            value={
              data.errorProxies > 0
                ? `${data.errorProxies} lỗi`
                : `${data.runningProxies}/${data.totalProxies}`
            }
            ok={hasProxies && data.errorProxies === 0 && data.runningProxies === data.totalProxies}
            warn={hasProxies && data.errorProxies === 0 && data.runningProxies < data.totalProxies}
          />
          <StatusPill
            icon={<CloudServerOutlined />}
            label="3proxy"
            value={`${data.containerHealthy ?? 0}/${data.containerProxies ?? 0}`}
            ok={hasContainers && (data.containerHealthy ?? 0) === (data.containerProxies ?? 0)}
            warn={!hasContainers || ((data.containerHealthy ?? 0) > 0 && (data.containerHealthy ?? 0) < (data.containerProxies ?? 0))}
          />
          <StatusPill
            icon={<HeartOutlined />}
            label="WebUI"
            value={data.webuiRunning ? 'Đang chạy' : 'Ngừng'}
            ok={!!data.webuiRunning}
          />
        </div>
      </Flex>

      {!data.webuiRunning && (
        <Flex gap={8} wrap="wrap" className="dashboard-fleet-hero__flags">
          <Tag icon={<CloseCircleOutlined />} color="warning" bordered={false}>WebUI container down</Tag>
        </Flex>
      )}
    </div>
  );
}