import { useMemo } from 'react';
import { Badge, Card, Col, Progress, Row, Space, Tag, Typography, theme } from 'antd';
import { Line } from '@ant-design/plots';
import {
  DashboardOutlined, HddOutlined, DatabaseOutlined, ClockCircleOutlined,
  CloudServerOutlined, ThunderboltOutlined,
} from '@ant-design/icons';
import type { RouterMonitorSnapshot } from '../../services/api';

const { Text } = Typography;

function gaugeStatus(pct: number | null | undefined): 'success' | 'normal' | 'exception' {
  if (pct == null) return 'normal';
  if (pct >= 90) return 'exception';
  if (pct >= 70) return 'normal';
  return 'success';
}

function gaugeStroke(pct: number | null | undefined, token: ReturnType<typeof theme.useToken>['token']): string {
  if (pct == null) return token.colorPrimary;
  if (pct >= 90) return token.colorError;
  if (pct >= 70) return token.colorWarning;
  return token.colorSuccess;
}

function gaugeLabel(pct: number | null | undefined): string {
  if (pct == null) return '—';
  if (pct >= 90) return 'Cao';
  if (pct >= 70) return 'TB';
  return 'Thấp';
}

interface GaugeCellProps {
  label: string;
  percent: number | null | undefined;
  detail?: string;
  sub?: string;
}

function GaugeCell({ label, percent, detail, sub }: GaugeCellProps) {
  const { token } = theme.useToken();
  const pct = percent ?? 0;

  return (
    <div className="router-gauge-cell">
      <Progress
        type="dashboard"
        percent={pct}
        size={108}
        strokeWidth={8}
        strokeColor={gaugeStroke(percent, token)}
        status={gaugeStatus(percent)}
        format={p => <span className="router-gauge-cell__value">{p}%</span>}
      />
      <div className="router-gauge-cell__meta">
        <Text strong style={{ fontSize: 13 }}>{label}</Text>
        <Tag bordered={false} className="router-gauge-cell__badge" color={
          (percent ?? 0) >= 90 ? 'error' : (percent ?? 0) >= 70 ? 'warning' : 'success'
        }>
          {gaugeLabel(percent)}
        </Tag>
      </div>
      {detail && <Text type="secondary" className="router-gauge-cell__detail">{detail}</Text>}
      {sub && <Text type="secondary" className="router-gauge-cell__sub">{sub}</Text>}
    </div>
  );
}

interface Props {
  monitor: RouterMonitorSnapshot | null | undefined;
  loading?: boolean;
  refreshSec?: number;
}

export default function RouterMonitorPanel({ monitor, loading, refreshSec = 30 }: Props) {
  const { token } = theme.useToken();

  const chartData = useMemo(() => {
    if (!monitor?.history?.length) return [];
    const rows: Array<{ time: string; metric: string; value: number }> = [];
    for (const p of monitor.history) {
      const d = new Date(p.ts);
      const time = d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
      if (p.cpuLoadPct != null) rows.push({ time, metric: 'CPU %', value: p.cpuLoadPct });
      if (p.memoryUsedPct != null) rows.push({ time, metric: 'RAM %', value: p.memoryUsedPct });
    }
    return rows;
  }, [monitor?.history]);

  if (!monitor) {
    return (
      <Card className="dashboard-panel-card router-monitor-card" loading={loading}>
        <div className="router-monitor-empty">
          <DashboardOutlined style={{ fontSize: 32, color: token.colorTextQuaternary }} />
          <Text type="secondary">Chưa có dữ liệu monitor — collector ghi mẫu mỗi 30s.</Text>
        </div>
      </Card>
    );
  }

  return (
    <Card
      className="dashboard-panel-card router-monitor-card"
      loading={loading}
      title={
        <Space>
          <span className="router-monitor-card__title-icon">
            <DashboardOutlined />
          </span>
          <span>Router Monitor</span>
          {monitor.version && <Tag bordered={false}>{monitor.version}</Tag>}
          <Badge status="processing" text={<Text type="secondary" style={{ fontSize: 12 }}>Live</Text>} />
        </Space>
      }
      extra={
        <Text type="secondary" style={{ fontSize: 12 }}>
          <ThunderboltOutlined style={{ marginRight: 4 }} />
          {refreshSec}s · lịch sử 4h
        </Text>
      }
      style={{ boxShadow: token.boxShadowTertiary }}
    >
      <Row gutter={[16, 16]} align="stretch">
        <Col xs={24} lg={10}>
          <Row gutter={[12, 12]}>
            <Col xs={8}>
              <GaugeCell
                label="CPU"
                percent={monitor.cpuLoadPct}
                detail={monitor.cpuCount != null ? `${monitor.cpuCount} core` : undefined}
                sub={monitor.cpuFrequencyMhz ? `@ ${monitor.cpuFrequencyMhz}MHz` : undefined}
              />
            </Col>
            <Col xs={8}>
              <GaugeCell
                label="RAM"
                percent={monitor.memoryUsedPct}
                detail={`${monitor.freeMemoryLabel} trống`}
                sub={`/ ${monitor.totalMemoryLabel}`}
              />
            </Col>
            <Col xs={8}>
              <GaugeCell
                label="Disk"
                percent={monitor.hddUsedPct}
                detail={`${monitor.freeHddLabel} trống`}
                sub={`/ ${monitor.totalHddLabel}`}
              />
            </Col>
          </Row>

          <div className="router-monitor-facts">
            <div className="router-monitor-fact">
              <ClockCircleOutlined />
              <div>
                <Text type="secondary" className="router-monitor-fact__label">Uptime</Text>
                <Text strong>{monitor.uptimeLabel || '—'}</Text>
              </div>
            </div>
            <div className="router-monitor-fact">
              <CloudServerOutlined />
              <div>
                <Text type="secondary" className="router-monitor-fact__label">Containers</Text>
                <Text strong>{monitor.containerRunning} / {monitor.containerTotal} running</Text>
              </div>
            </div>
            <div className="router-monitor-fact">
              <HddOutlined />
              <div>
                <Text type="secondary" className="router-monitor-fact__label">Board</Text>
                <Text strong>{monitor.boardName || monitor.architecture || '—'}</Text>
              </div>
            </div>
            <div className="router-monitor-fact">
              <DatabaseOutlined />
              <div>
                <Text type="secondary" className="router-monitor-fact__label">CPU model</Text>
                <Text strong ellipsis style={{ maxWidth: 140 }}>
                  {monitor.cpu || '—'}
                </Text>
              </div>
            </div>
          </div>
        </Col>

        <Col xs={24} lg={14}>
          <div className="router-monitor-chart-wrap">
            {chartData.length > 1 ? (
              <Line
                data={chartData}
                xField="time"
                yField="value"
                colorField="metric"
                height={280}
                smooth
                axis={{ y: { title: '%', min: 0, max: 100 } }}
                legend={{ color: { position: 'top' } }}
                style={{ lineWidth: 2 }}
              />
            ) : (
              <div className="router-monitor-chart-empty">
                <Text type="secondary">Biểu đồ CPU/RAM sau vài phút thu thập mẫu…</Text>
              </div>
            )}
          </div>
        </Col>
      </Row>
    </Card>
  );
}