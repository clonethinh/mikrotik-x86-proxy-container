import { useEffect, useState, useCallback } from 'react';
import { Row, Col, Typography, Skeleton, Space, Button, theme, Flex, Select } from 'antd';
import DismissibleAlert from '../components/ui/DismissibleAlert';
import {
  ApiOutlined, CheckCircleOutlined, StopOutlined, WarningOutlined,
  GlobalOutlined, ThunderboltOutlined, CloudServerOutlined, RiseOutlined,
  RightOutlined, ReloadOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { api, DashboardData, DhcpLease, DeviceRoute } from '../services/api';
import { useWSEvent } from '../services/ws';
import PageHeader from '../components/ui/PageHeader';
import MetricCard from '../components/ui/MetricCard';
import RouterMonitorPanel from '../components/dashboard/RouterMonitorPanel';
import DashboardFleetHero from '../components/dashboard/DashboardFleetHero';
import DashboardHealthCard from '../components/dashboard/DashboardHealthCard';
import DashboardConnectionCard from '../components/dashboard/DashboardConnectionCard';
import DashboardQuickActions from '../components/dashboard/DashboardQuickActions';
import DashboardDhcpClients from '../components/dashboard/DashboardDhcpClients';
import { POLL_INTERVAL_OPTIONS, usePollInterval, usePollEffect, type PollIntervalSec } from '../hooks/usePollInterval';

const { Text } = Typography;

function DashboardSkeleton() {
  return (
    <div className="proxy-page dashboard-page">
      <Skeleton.Input active style={{ width: '100%', height: 88, marginBottom: 20 }} />
      <Skeleton.Input active style={{ width: '100%', height: 120, marginBottom: 16 }} />
      <Row gutter={[16, 16]}>
        {[1, 2, 3, 4].map(i => (
          <Col xs={24} sm={12} lg={6} key={i}>
            <Skeleton.Node active style={{ width: '100%', height: 100 }} />
          </Col>
        ))}
      </Row>
      <Skeleton active paragraph={{ rows: 8 }} style={{ marginTop: 16 }} />
    </div>
  );
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const { token } = theme.useToken();
  const { seconds: pollSec, setSeconds: setPollSec, ms: pollMs } = usePollInterval();
  const [data, setData] = useState<DashboardData | null>(null);
  const [leases, setLeases] = useState<DhcpLease[]>([]);
  const [devices, setDevices] = useState<DeviceRoute[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const [dash, dhcp, devs] = await Promise.all([
        api.get<DashboardData>('/api/dashboard'),
        api.get<DhcpLease[]>('/api/devices/dhcp-leases'),
        api.get<DeviceRoute[]>('/api/devices'),
      ]);
      setData(dash);
      setLeases(dhcp);
      setDevices(devs);
    }
    finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  usePollEffect(() => load(true), pollMs, [load]);

  useWSEvent(
    (msg) => ['wan.sync', 'proxy.status', 'proxy.ip-changed', 'proxy.health', 'wan.bulk', 'device.created', 'device.updated', 'device.deleted'].includes(msg.type),
    () => load(true),
  );

  if (loading || !data) return <DashboardSkeleton />;

  const proxyPct = data.totalProxies > 0 ? Math.round((data.runningProxies / data.totalProxies) * 100) : 0;
  const containerPct = (data.containerProxies || 0) > 0
    ? Math.round(((data.containerHealthy || 0) / (data.containerProxies || 1)) * 100)
    : 0;

  const refreshControl = (
    <Flex align="center" gap={8} wrap="wrap">
      <Text type="secondary" style={{ fontSize: 13 }}>Làm mới</Text>
      <Select
        size="small"
        value={pollSec}
        onChange={(v: PollIntervalSec) => setPollSec(v)}
        options={POLL_INTERVAL_OPTIONS.map(s => ({ value: s, label: `${s}s` }))}
        style={{ width: 72 }}
      />
      <Button size="small" icon={<ReloadOutlined />} loading={refreshing} onClick={() => load()}>
        Ngay
      </Button>
    </Flex>
  );

  return (
    <div className="proxy-page dashboard-page">
      <PageHeader
        title={<><RiseOutlined style={{ marginRight: 10, color: token.colorPrimary }} />Tổng quan fleet</>}
        subtitle="Monitor router, proxy pool và trạng thái WAN — cập nhật theo thời gian thực"
        extra={
          <Space wrap align="center">
            {refreshControl}
            <Button onClick={() => navigate('/wan')}>WAN Control</Button>
            <Button type="primary" icon={<RightOutlined />} onClick={() => navigate('/fleet')}>
              Proxy Fleet
            </Button>
          </Space>
        }
      />

      {data.errorProxies > 0 && (
        <DismissibleAlert
          bannerId="dashboard-error-proxies"
          persist={false}
          type="error"
          showIcon
          message={`${data.errorProxies} proxy lỗi trong DB`}
          style={{ marginBottom: 16 }}
        />
      )}

      {!data.webuiRunning && (
        <DismissibleAlert
          bannerId="dashboard-webui-down"
          persist={false}
          type="warning"
          showIcon
          message="Container webuiproxymikrotik không chạy trên router"
          style={{ marginBottom: 16 }}
        />
      )}

      <DashboardFleetHero data={data} pollSec={pollSec} refreshing={refreshing} />

      <Row gutter={[16, 16]} className="dashboard-section dashboard-metrics-row">
        <Col xs={24} sm={12} lg={6}>
          <MetricCard
            title="PPPoE WAN"
            value={data.totalWan}
            icon={<GlobalOutlined />}
            accent="primary"
            suffix={<Text type="secondary" style={{ fontSize: 13 }}>{data.wanUp} UP</Text>}
          />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <MetricCard
            title="Container 3proxy"
            value={data.containerProxies ?? 0}
            icon={<CloudServerOutlined />}
            accent="purple"
            suffix={<Text style={{ fontSize: 13, color: '#52c41a' }}>{data.containerHealthy ?? 0} OK</Text>}
          />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <MetricCard
            title="Proxy DB"
            value={data.totalProxies}
            icon={<ApiOutlined />}
            accent="primary"
            suffix={<Text type="secondary" style={{ fontSize: 13 }}>{data.runningProxies} run</Text>}
          />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <MetricCard
            title="Client WS"
            value={data.realtimeClients}
            icon={<ThunderboltOutlined />}
            accent="success"
          />
        </Col>
      </Row>

      <Row gutter={[16, 16]} className="dashboard-section">
        <Col span={24}>
          <RouterMonitorPanel monitor={data.routerMonitor} loading={refreshing} refreshSec={pollSec} />
        </Col>
      </Row>

      <Row gutter={[16, 16]} className="dashboard-section">
        <Col xs={24} lg={12}>
          <DashboardHealthCard
            title="Container health"
            percent={containerPct}
            subtitle={`${data.containerHealthy}/${data.containerProxies} container healthy trên router`}
            accent="#722ED1"
            items={[
              { key: 'ok', label: 'healthy', value: data.containerHealthy ?? 0, icon: <CheckCircleOutlined />, color: 'success' },
              { key: 'total', label: 'tổng', value: data.containerProxies ?? 0, icon: <CloudServerOutlined /> },
            ]}
          />
        </Col>
        <Col xs={24} lg={12}>
          <DashboardHealthCard
            title="Proxy DB"
            percent={proxyPct}
            subtitle={`${data.runningProxies}/${data.totalProxies} proxy đang running`}
            items={[
              { key: 'run', label: 'running', value: data.runningProxies, icon: <CheckCircleOutlined />, color: 'success' },
              { key: 'stop', label: 'stopped', value: data.stoppedProxies, icon: <StopOutlined /> },
              { key: 'err', label: 'error', value: data.errorProxies, icon: <WarningOutlined />, color: data.errorProxies ? 'error' : undefined },
            ]}
          />
        </Col>
      </Row>

      <Row gutter={[16, 16]} className="dashboard-section">
        <Col xs={24} md={12}>
          <DashboardConnectionCard data={data} />
        </Col>
        <Col xs={24} md={12}>
          <DashboardQuickActions />
        </Col>
      </Row>

      <Row gutter={[16, 16]} className="dashboard-section">
        <Col span={24}>
          <DashboardDhcpClients
            leases={leases}
            devices={devices}
            loading={refreshing}
            onManageDevices={() => navigate('/devices')}
          />
        </Col>
      </Row>
    </div>
  );
}