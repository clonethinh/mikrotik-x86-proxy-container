import { useEffect, useState } from 'react';
import { Row, Col, Card, Statistic, Tag, Typography, Spin, Alert, Progress, Space, Button } from 'antd';
import {
  ApiOutlined, CheckCircleOutlined, StopOutlined, WarningOutlined,
  GlobalOutlined, ThunderboltOutlined, CloudServerOutlined, HeartOutlined,
  RightOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { api, DashboardData } from '../services/api';
import { useWSEvent } from '../services/ws';

const { Title, Text } = Typography;

export default function DashboardPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try { setData(await api.get<DashboardData>('/api/dashboard')); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);
  useWSEvent(
    (msg) => ['wan.sync', 'proxy.status', 'proxy.ip-changed', 'proxy.health', 'wan.bulk'].includes(msg.type),
    () => load(),
  );

  if (loading || !data) return <Spin size="large" style={{ display: 'block', margin: 80 }} />;

  const pct = data.totalProxies > 0 ? Math.round((data.runningProxies / data.totalProxies) * 100) : 0;
  const containerPct = (data.containerProxies || 0) > 0
    ? Math.round(((data.containerHealthy || 0) / (data.containerProxies || 1)) * 100)
    : 0;

  return (
    <div>
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Col>
          <Title level={3} style={{ margin: 0 }}>Dashboard</Title>
          <Text type="secondary">MikroTik Proxy Fleet · Realtime WebSocket</Text>
        </Col>
        <Col>
          <Button type="primary" icon={<RightOutlined />} onClick={() => navigate('/fleet')}>
            Mở Proxy Fleet
          </Button>
        </Col>
      </Row>

      {data.errorProxies > 0 && (
        <Alert type="error" showIcon message={`${data.errorProxies} proxy lỗi trong DB`} style={{ marginBottom: 16 }} />
      )}

      {!data.webuiRunning && (
        <Alert type="warning" showIcon message="Container webuiproxymikrotik không chạy trên router" style={{ marginBottom: 16 }} />
      )}

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <Card><Statistic title="PPPoE WAN" value={data.totalWan} prefix={<GlobalOutlined />} suffix={<Text type="secondary" style={{ fontSize: 14 }}>{data.wanUp} UP</Text>} /></Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card><Statistic title="Container 3proxy" value={data.containerProxies ?? 0} prefix={<CloudServerOutlined />} valueStyle={{ color: '#1677ff' }} suffix={<Text type="success" style={{ fontSize: 14 }}>{data.containerHealthy ?? 0} OK</Text>} /></Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card><Statistic title="Proxy DB" value={data.totalProxies} prefix={<ApiOutlined />} /></Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card><Statistic title="Realtime WS" value={data.realtimeClients} prefix={<ThunderboltOutlined />} /></Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} md={12}>
          <Card title="Container health trên router">
            <Progress percent={containerPct} status={containerPct >= 90 ? 'success' : 'active'} />
            <Text type="secondary">{data.containerHealthy}/{data.containerProxies} container healthy</Text>
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card title="Proxy DB running">
            <Progress percent={pct} status={pct === 100 ? 'success' : 'active'} />
            <Space wrap style={{ marginTop: 8 }}>
              <Tag icon={<CheckCircleOutlined />} color="success">{data.runningProxies} running</Tag>
              <Tag icon={<StopOutlined />} color="default">{data.stoppedProxies} stopped</Tag>
              <Tag icon={<WarningOutlined />} color="error">{data.errorProxies} error</Tag>
            </Space>
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} md={12}>
          <Card title="Router MikroTik">
            <Space direction="vertical">
              <div><Text type="secondary">API host: </Text><Text code>{data.mikrotik.host}</Text></div>
              {data.mikrotik.managementUrl && (
                <div><Text type="secondary">WebUI: </Text>
                  <a href={data.mikrotik.managementUrl} target="_blank" rel="noreferrer">{data.mikrotik.wanHost}</a>
                </div>
              )}
              <div><Text type="secondary">Version: </Text><Tag>{data.mikrotik.version || '—'}</Tag></div>
              <div><Text type="secondary">CPU: </Text><Tag color="blue">{data.mikrotik.cpuLoad || '—'}%</Tag></div>
              <div><Text type="secondary">WebUI: </Text>
                <Tag icon={<HeartOutlined />} color={data.webuiRunning ? 'success' : 'error'}>
                  {data.webuiRunning ? 'Running' : 'Stopped'}
                </Tag>
              </div>
            </Space>
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card title="Lưu ý vận hành">
            <ul style={{ margin: 0, paddingLeft: 20, color: 'rgba(255,255,255,0.65)' }}>
              <li>Mỗi PPPoE có <b>IP public riêng</b> — client connect qua IP đó</li>
              <li>HTTP port = <code>30055 + N</code>, SOCKS = <code>31055 + N</code></li>
              <li><code>pppoe-wan</code> chỉ quản trị (WebUI/SSH) — không dùng làm proxy</li>
              <li>Proxy bắt đầu từ <code>pppoe-out1</code> → <code>pppoe-outX</code> — client kết nối qua IP public của từng out</li>
              <li>Proxy bắt đầu từ <code>pppoe-out1</code></li>
              <li>Bật WAN từ Fleet → tự tạo container + routing</li>
            </ul>
          </Card>
        </Col>
      </Row>
    </div>
  );
}