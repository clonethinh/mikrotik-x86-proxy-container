import { useMemo } from 'react';
import { Badge, Card, Flex, Segmented, Space, Tag, Typography, theme } from 'antd';
import { Area } from '@ant-design/plots';
import {
  ArrowDownOutlined, ArrowUpOutlined, CloudDownloadOutlined,
  CloudUploadOutlined, ThunderboltOutlined,
} from '@ant-design/icons';
import type { WanTrafficSnapshot } from '../../services/api';
import { formatBytes, formatSpeed, speedToUnit, type SpeedUnit } from '../../lib/proxiesFormat';
import { useSpeedUnit } from '../../hooks/useSpeedUnit';

const { Text, Title } = Typography;

interface Props {
  traffic: WanTrafficSnapshot | null | undefined;
  refreshSec?: number;
}

function TrafficStat({
  kind,
  total,
  totalLabel,
  speed,
  speedUnit,
  active,
}: {
  kind: 'download' | 'upload';
  total: string;
  totalLabel: string;
  speed: number;
  speedUnit: SpeedUnit;
  active: boolean;
}) {
  const isDown = kind === 'download';
  const accent = isDown ? '#1677FF' : '#52C41A';
  const bg = isDown ? '#E6F4FF' : '#F6FFED';
  const Icon = isDown ? CloudDownloadOutlined : CloudUploadOutlined;
  const Arrow = isDown ? ArrowDownOutlined : ArrowUpOutlined;

  return (
    <div
      className={`dashboard-traffic-stat dashboard-traffic-stat--${kind}${active ? ' dashboard-traffic-stat--active' : ''}`}
      style={{ borderColor: `${accent}33`, background: `linear-gradient(135deg, ${bg} 0%, #ffffff 72%)` }}
    >
      <div className="dashboard-traffic-stat__head">
        <span className="dashboard-traffic-stat__icon" style={{ background: bg, color: accent }}>
          <Icon />
        </span>
        <div>
          <Text type="secondary" className="dashboard-traffic-stat__label">
            {isDown ? 'Tổng Download' : 'Tổng Upload'}
          </Text>
          <Title level={3} className="dashboard-traffic-stat__total" style={{ color: accent }}>
            {totalLabel}
          </Title>
        </div>
      </div>
      <div className="dashboard-traffic-stat__speed">
        <Arrow style={{ color: accent }} />
        <div>
          <Text type="secondary" style={{ fontSize: 12 }}>Tốc độ realtime</Text>
          <div className={`dashboard-traffic-stat__bps${active ? ' dashboard-traffic-stat__bps--live' : ''}`}>
            {formatSpeed(speed, speedUnit)}
          </div>
        </div>
        {active && <span className="dashboard-traffic-stat__pulse" style={{ background: accent }} />}
      </div>
      <Text type="secondary" className="dashboard-traffic-stat__raw">
        {formatBytes(total)} tích lũy (MikroTik counters)
      </Text>
    </div>
  );
}

export default function DashboardWanTraffic({ traffic, refreshSec = 30 }: Props) {
  const { token } = theme.useToken();
  const { unit: speedUnit, setUnit: setSpeedUnit } = useSpeedUnit();

  const chartData = useMemo(() => {
    if (!traffic?.history?.length) return [];
    const rows: Array<{ time: string; metric: string; value: number }> = [];
    for (const p of traffic.history) {
      const d = new Date(p.ts);
      const time = d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      if (p.rxBps > 0) {
        rows.push({ time, metric: 'Download', value: speedToUnit(p.rxBps, speedUnit) });
      }
      if (p.txBps > 0) {
        rows.push({ time, metric: 'Upload', value: speedToUnit(p.txBps, speedUnit) });
      }
    }
    return rows;
  }, [traffic?.history, speedUnit]);

  if (!traffic) {
    return (
      <Card className="dashboard-panel-card dashboard-traffic-card">
        <Text type="secondary">Đang thu thập traffic WAN từ MikroTik…</Text>
      </Card>
    );
  }

  const hasSpeed = traffic.rxBps > 0 || traffic.txBps > 0;

  return (
    <Card
      className="dashboard-panel-card dashboard-traffic-card"
      title={
        <Space>
          <span className="router-monitor-card__title-icon">
            <ThunderboltOutlined />
          </span>
          <span>Traffic WAN hệ thống</span>
          <Tag bordered={false} color="blue">MikroTik live</Tag>
          {traffic.live && (
            <Badge status="processing" text={<Text type="secondary" style={{ fontSize: 12 }}>Realtime</Text>} />
          )}
        </Space>
      }
      extra={
        <Flex align="center" gap={12} wrap="wrap" className="dashboard-traffic-extra">
          <Segmented
            size="small"
            className="dashboard-traffic-unit-toggle"
            value={speedUnit}
            onChange={v => setSpeedUnit(v as SpeedUnit)}
            options={[
              { label: 'KB/s', value: 'KB/s' },
              { label: 'MB/s', value: 'MB/s' },
              { label: 'Mbps', value: 'Mbps' },
            ]}
          />
          <Text type="secondary" className="dashboard-traffic-extra__meta">
            {traffic.wanUp}/{traffic.wanTotal} PPPoE UP · poll 5s · UI {refreshSec}s
          </Text>
        </Flex>
      }
      style={{ boxShadow: token.boxShadowTertiary }}
    >
      <div className="dashboard-traffic-body">
        <Flex vertical gap={12} className="dashboard-traffic-stats">
          <TrafficStat
            kind="download"
            total={traffic.rxBytes}
            totalLabel={traffic.rxLabel}
            speed={traffic.rxBps}
            speedUnit={speedUnit}
            active={traffic.live && traffic.rxBps > 0}
          />
          <TrafficStat
            kind="upload"
            total={traffic.txBytes}
            totalLabel={traffic.txLabel}
            speed={traffic.txBps}
            speedUnit={speedUnit}
            active={traffic.live && traffic.txBps > 0}
          />
        </Flex>
        <div className="dashboard-traffic-chart-wrap">
          {chartData.length > 2 ? (
            <Area
              data={chartData}
              xField="time"
              yField="value"
              colorField="metric"
              autoFit
              shapeField="smooth"
              scale={{ color: { range: ['#1677FF', '#52C41A'] } }}
              marginBottom={0}
              marginTop={4}
              axis={{ y: { title: speedUnit }, x: { labelSpacing: 0 } }}
              legend={{ color: { position: 'top' } }}
              style={{ fillOpacity: 0.22 }}
            />
          ) : (
            <div className="dashboard-traffic-chart-empty">
              <Text type="secondary">
                {hasSpeed
                  ? 'Biểu đồ tốc độ sẽ hiện sau vài mẫu thu thập (5s/lần)…'
                  : 'Chưa có traffic — đợi hoạt động trên các cổng PPPoE'}
              </Text>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}