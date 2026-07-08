import { Button, Card, Col, Row, Typography, theme } from 'antd';
import {
  CloudServerOutlined, GlobalOutlined, ApiOutlined, SettingOutlined,
  RightOutlined, ThunderboltOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';

const { Text } = Typography;

const ACTIONS = [
  {
    key: 'fleet',
    path: '/fleet',
    label: 'Proxy Fleet',
    desc: 'Pool pppoe-out, provision',
    icon: <CloudServerOutlined />,
    color: '#1677FF',
    bg: '#E6F4FF',
  },
  {
    key: 'wan',
    path: '/wan',
    label: 'WAN Control',
    desc: 'Bật/tắt PPPoE, quay IP',
    icon: <GlobalOutlined />,
    color: '#13C2C2',
    bg: '#E6FFFB',
  },
  {
    key: 'proxies',
    path: '/proxies',
    label: 'Proxy chi tiết',
    desc: 'Credential, analytics, bulk',
    icon: <ApiOutlined />,
    color: '#722ED1',
    bg: '#F9F0FF',
  },
  {
    key: 'settings',
    path: '/settings',
    label: 'Cài đặt',
    desc: 'Auto-proxy, script router',
    icon: <SettingOutlined />,
    color: '#FA8C16',
    bg: '#FFF7E6',
  },
] as const;

export default function DashboardQuickActions() {
  const navigate = useNavigate();
  const { token } = theme.useToken();

  return (
    <Card
      className="dashboard-panel-card dashboard-quick-actions"
      title={
        <span>
          <ThunderboltOutlined style={{ marginRight: 8, color: token.colorPrimary }} />
          Truy cập nhanh
        </span>
      }
      style={{ boxShadow: token.boxShadowTertiary, height: '100%' }}
    >
      <Row gutter={[12, 12]}>
        {ACTIONS.map(action => (
          <Col xs={12} key={action.key}>
            <button
              type="button"
              className="dashboard-quick-action"
              onClick={() => navigate(action.path)}
            >
              <span className="dashboard-quick-action__icon" style={{ background: action.bg, color: action.color }}>
                {action.icon}
              </span>
              <span className="dashboard-quick-action__text">
                <Text strong style={{ display: 'block', fontSize: 13 }}>{action.label}</Text>
                <Text type="secondary" style={{ fontSize: 11 }}>{action.desc}</Text>
              </span>
              <RightOutlined className="dashboard-quick-action__arrow" />
            </button>
          </Col>
        ))}
      </Row>
      <Button type="link" size="small" style={{ marginTop: 8, padding: 0 }} onClick={() => navigate('/fleet')}>
        Mở Fleet →
      </Button>
    </Card>
  );
}