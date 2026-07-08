import { Layout, Menu, Button, theme, Avatar, Dropdown, Badge, Typography, Flex } from 'antd';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
  DashboardOutlined, GlobalOutlined, AuditOutlined,
  SettingOutlined, LogoutOutlined, UserOutlined,
  CloudServerOutlined, LaptopOutlined, ApiOutlined,
} from '@ant-design/icons';
import { useAuth } from '../services/auth';
import { useWebSocket } from '../hooks/useWebSocket';
import { useWSStore } from '../services/ws';

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

const routeTitles: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/fleet': 'Proxy Fleet',
  '/proxies': 'Proxy chi tiết',
  '/wan': 'WAN Control',
  '/devices': 'Định tuyến thiết bị',
  '/audit': 'Audit Log',
  '/settings': 'Settings',
};

export default function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const { token } = theme.useToken();
  const wsConnected = useWSStore(s => s.connected);
  useWebSocket();

  const menuItems = [
    { key: '/dashboard', icon: <DashboardOutlined />, label: 'Dashboard' },
    { key: '/fleet', icon: <CloudServerOutlined />, label: 'Proxy Fleet' },
    { key: '/proxies', icon: <ApiOutlined />, label: 'Proxy chi tiết' },
    { key: '/devices', icon: <LaptopOutlined />, label: 'Thiết bị LAN' },
    { key: '/wan', icon: <GlobalOutlined />, label: 'WAN Control' },
    { key: '/audit', icon: <AuditOutlined />, label: 'Audit' },
    { key: '/settings', icon: <SettingOutlined />, label: 'Settings' },
  ];

  const title = routeTitles[location.pathname] || '';
  const isProxyRoute = location.pathname === '/fleet' || location.pathname === '/proxies';

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider width={232} theme="dark" breakpoint="lg" collapsedWidth={64}>
        <Flex
          align="center"
          gap={12}
          style={{
            height: 56,
            padding: '0 20px',
            borderBottom: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: 'linear-gradient(135deg, #1677FF 0%, #0958D9 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <ApiOutlined style={{ color: '#fff', fontSize: 16 }} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: '#fff', fontWeight: 600, fontSize: 14, lineHeight: 1.25 }}>
              MikroTik Proxy
            </div>
            <Text style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11 }}>RouterOS · IP động</Text>
          </div>
        </Flex>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[location.pathname]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
          style={{ border: 'none', padding: '8px 0' }}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            background: token.colorBgContainer,
            padding: '0 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
            height: 56,
            position: 'sticky',
            top: 0,
            zIndex: 10,
          }}
        >
          <Flex align="center" gap={12}>
            <span style={{ fontSize: 16, fontWeight: 600, color: token.colorText }}>{title}</span>
            {isProxyRoute && (
              <Badge
                count="Live pool"
                style={{ backgroundColor: '#E6F4FF', color: '#0958D9', fontWeight: 500 }}
              />
            )}
          </Flex>
          <Flex align="center" gap={16}>
            <Badge
              status={wsConnected ? 'processing' : 'error'}
              text={
                <Text type="secondary" style={{ fontSize: 13 }}>
                  {wsConnected ? 'Realtime' : 'Offline'}
                </Text>
              }
            />
            <Dropdown
              menu={{
                items: [{
                  key: 'logout',
                  icon: <LogoutOutlined />,
                  label: 'Đăng xuất',
                  onClick: async () => {
                    await logout();
                    navigate('/login');
                  },
                }],
              }}
            >
              <Button type="text" style={{ height: 40, paddingInline: 8 }}>
                <Flex align="center" gap={8}>
                  <Avatar size="small" icon={<UserOutlined />} style={{ background: '#1677FF' }} />
                  <Text>{user?.username}</Text>
                </Flex>
              </Button>
            </Dropdown>
          </Flex>
        </Header>
        <Content style={{ padding: 24, background: token.colorBgLayout, minHeight: 'calc(100vh - 56px)' }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}