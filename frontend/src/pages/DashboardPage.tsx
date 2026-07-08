import { useEffect, useState, useCallback, useMemo } from 'react';
import { Row, Col, Typography, Skeleton } from 'antd';
import DismissibleAlert from '../components/ui/DismissibleAlert';
import {
  ApiOutlined, CheckCircleOutlined, StopOutlined, WarningOutlined,
  GlobalOutlined, ThunderboltOutlined, CloudServerOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { api, DashboardData } from '../services/api';
import { useWSEvent } from '../services/ws';
import MetricCard from '../components/ui/MetricCard';
import RouterMonitorPanel from '../components/dashboard/RouterMonitorPanel';
import DashboardFleetHero from '../components/dashboard/DashboardFleetHero';
import DashboardHealthCard from '../components/dashboard/DashboardHealthCard';
import DashboardConnectionCard from '../components/dashboard/DashboardConnectionCard';
import DashboardQuickActions from '../components/dashboard/DashboardQuickActions';
import DashboardDhcpClients from '../components/dashboard/DashboardDhcpClients';
import DashboardWanTraffic from '../components/dashboard/DashboardWanTraffic';
import DashboardHeaderToolbar from '../components/dashboard/DashboardHeaderToolbar';
import { usePollInterval, usePollEffect } from '../hooks/usePollInterval';
import { useRegisterPageHeaderActions } from '../contexts/PageHeaderActionsContext';

const { Text } = Typography;

function DashboardSkeleton() {
  return (
    <div className="proxy-page dashboard-page">
      <Skeleton.Input active style={{ width: '100%', height: 140, marginBottom: 16 }} />
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
  const { seconds: pollSec, setSeconds: setPollSec, ms: pollMs } = usePollInterval();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const dash = await api.get<DashboardData>('/api/dashboard');
      setData(dash);
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

  const headerActions = useMemo(() => (
    <DashboardHeaderToolbar
      pollSec={pollSec}
      onPollSecChange={setPollSec}
      refreshing={refreshing}
      onRefresh={() => load()}
      onWan={() => navigate('/wan')}
      onFleet={() => navigate('/fleet')}
    />
  ), [pollSec, refreshing, navigate, setPollSec, load]);

  useRegisterPageHeaderActions(headerActions);

  if (loading || !data) return <DashboardSkeleton />;

  const leases = data.dhcpLeases ?? [];
  const devices = data.deviceRoutes ?? [];

  const proxyPct = data.totalProxies > 0 ? Math.round((data.runningProxies / data.totalProxies) * 100) : 0;
  const containerPct = (data.containerProxies || 0) > 0
    ? Math.round(((data.containerHealthy || 0) / (data.containerProxies || 1)) * 100)
    : 0;

  return (
    <div className="proxy-page dashboard-page">
      <DashboardFleetHero data={data} pollSec={pollSec} refreshing={refreshing} />

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
            title="Proxy container"
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
          <DashboardWanTraffic traffic={data.wanTraffic} refreshSec={pollSec} />
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
            subtitle={`MikroTik live · ${data.containerHealthy}/${data.containerProxies} container healthy`}
            accent="#722ED1"
            items={[
              { key: 'ok', label: 'healthy', value: data.containerHealthy ?? 0, icon: <CheckCircleOutlined />, color: 'success' },
              { key: 'total', label: 'tổng', value: data.containerProxies ?? 0, icon: <CloudServerOutlined /> },
            ]}
          />
        </Col>
        <Col xs={24} lg={12}>
          <DashboardHealthCard
            title="Proxy container"
            percent={proxyPct}
            subtitle={`MikroTik live · ${data.runningProxies}/${data.totalProxies} container đang chạy`}
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