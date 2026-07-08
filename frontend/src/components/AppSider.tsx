import type { MenuProps } from 'antd';
import { Layout, Menu, Typography } from 'antd';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  DashboardOutlined, GlobalOutlined, AuditOutlined, SettingOutlined,
  CloudServerOutlined, LaptopOutlined, ApiOutlined, NodeIndexOutlined,
} from '@ant-design/icons';
import { useWSStore } from '../services/ws';

const { Sider } = Layout;
const { Text } = Typography;

const menuItems: MenuProps['items'] = [
  {
    type: 'group',
    label: 'Giám sát',
    children: [
      { key: '/dashboard', icon: <DashboardOutlined />, label: 'Dashboard' },
    ],
  },
  {
    type: 'group',
    label: 'Proxy',
    children: [
      { key: '/fleet', icon: <CloudServerOutlined />, label: 'Proxy Fleet' },
      { key: '/proxies', icon: <ApiOutlined />, label: 'Proxy chi tiết' },
    ],
  },
  {
    type: 'group',
    label: 'Mạng',
    children: [
      { key: '/devices', icon: <LaptopOutlined />, label: 'Thiết bị LAN' },
      { key: '/wan', icon: <GlobalOutlined />, label: 'WAN Control' },
    ],
  },
  {
    type: 'group',
    label: 'Hệ thống',
    children: [
      { key: '/audit', icon: <AuditOutlined />, label: 'Audit' },
      { key: '/settings', icon: <SettingOutlined />, label: 'Settings' },
    ],
  },
];

export default function AppSider() {
  const navigate = useNavigate();
  const location = useLocation();
  const wsConnected = useWSStore(s => s.connected);

  return (
    <Sider
      width={260}
      theme="dark"
      breakpoint="lg"
      collapsedWidth={76}
      className="app-sider"
    >
      <div className="app-sider-inner">
        <div className="app-sider-brand">
          <div className="app-sider-logo" aria-hidden>
            <NodeIndexOutlined />
          </div>
          <div className="app-sider-brand__text">
            <span className="app-sider-brand__title">MikroTik Proxy</span>
            <Text className="app-sider-brand__sub">RouterOS · PPPoE fleet</Text>
          </div>
        </div>

        <nav className="app-sider-nav" aria-label="Điều hướng chính">
          <Menu
            theme="dark"
            mode="inline"
            className="app-sider-menu"
            selectedKeys={[location.pathname]}
            items={menuItems}
            onClick={({ key }) => navigate(key)}
          />
        </nav>

        <div className="app-sider-footer">
          <div className="app-sider-footer-chip">
            <span className={`app-sider-live-dot${wsConnected ? ' app-sider-live-dot--on' : ''}`} />
            <div className="app-sider-footer-chip__body">
              <Text className="app-sider-footer-chip__label">WebSocket</Text>
              <Text className="app-sider-footer-chip__value">
                {wsConnected ? 'Trực tiếp' : 'Ngắt kết nối'}
              </Text>
            </div>
          </div>
        </div>
      </div>
    </Sider>
  );
}