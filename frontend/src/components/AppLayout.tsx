import { Layout, Menu, Button, theme, Avatar, Dropdown, Typography, Flex, Breadcrumb, Badge, Tooltip, Divider } from 'antd';
import DismissibleAlert from './ui/DismissibleAlert';
import { Outlet, useNavigate, useLocation, Link } from 'react-router-dom';
import { LogoutOutlined, UserOutlined, HomeOutlined } from '@ant-design/icons';
import AppSider from './AppSider';
import { useAuth } from '../services/auth';
import { useWebSocket } from '../hooks/useWebSocket';
import { useWSStore } from '../services/ws';
import { isUiPreview } from '../lib/env';
import { PageHeaderActionsProvider, usePageHeaderActionsState } from '../contexts/PageHeaderActionsContext';

const { Header, Content } = Layout;
const { Text } = Typography;

const routeMeta: Record<string, { title: string; parent?: { path: string; title: string } }> = {
  '/dashboard': { title: 'Dashboard' },
  '/fleet': { title: 'Proxy Fleet' },
  '/proxies': { title: 'Proxy chi tiết', parent: { path: '/fleet', title: 'Fleet' } },
  '/wan': { title: 'WAN Control' },
  '/devices': { title: 'Định tuyến thiết bị' },
  '/audit': { title: 'Audit Log' },
  '/settings': { title: 'Settings' },
};

function AppLayoutShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const { token } = theme.useToken();
  const wsConnected = useWSStore(s => s.connected);
  const pageActions = usePageHeaderActionsState();
  useWebSocket();

  const meta = routeMeta[location.pathname];

  const breadcrumbItems = [
    {
      title: (
        <Link to="/dashboard" className="app-breadcrumb-link">
          <HomeOutlined className="app-breadcrumb-home-icon" />
          <span>Console</span>
        </Link>
      ),
    },
    ...(meta?.parent
      ? [{ title: <Link to={meta.parent.path}>{meta.parent.title}</Link> }]
      : []),
  ];

  return (
    <Layout className="app-layout-root">
      <AppSider />
      <Layout>
        <Header className="app-main-header">
          <Flex align="center" justify="space-between" style={{ width: '100%', height: '100%' }}>
            <Flex vertical justify="center" gap={4} className="app-header-left">
              <Text className="app-header-title">{meta?.title || 'Console'}</Text>
              <Breadcrumb className="app-header-breadcrumb" items={breadcrumbItems} />
            </Flex>

            <Flex align="center" gap={12} className="app-header-right">
              {pageActions && (
                <>
                  <div className="app-header-page-actions">{pageActions}</div>
                  <Divider type="vertical" className="app-header-divider" />
                </>
              )}
              <Tooltip title={wsConnected ? 'WebSocket đang kết nối' : 'WebSocket ngắt — dữ liệu có thể chậm'}>
                <Flex align="center" gap={8} className="app-header-ws">
                  <Badge status={wsConnected ? 'processing' : 'error'} />
                  <Text type="secondary" className="app-header-ws-label">
                    {wsConnected ? 'Trực tiếp' : 'Ngắt'}
                  </Text>
                </Flex>
              </Tooltip>

              <Divider type="vertical" className="app-header-divider" />

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
                <Button type="text" className="app-header-user-btn">
                  <Flex align="center" gap={8}>
                    <Avatar size="small" icon={<UserOutlined />} style={{ background: token.colorPrimary }} />
                    <Text strong className="app-header-username">{user?.username}</Text>
                  </Flex>
                </Button>
              </Dropdown>
            </Flex>
          </Flex>
        </Header>
        <Content className="app-content-area" style={{ padding: 24, minHeight: 'calc(100vh - 56px)' }}>
          <div className="app-content-inner">
            {isUiPreview && (
              <DismissibleAlert
                bannerId="ui-preview-mode"
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
                message="Chế độ xem trước (mock data)"
                description="npm run dev:preview — không cần router/backend."
              />
            )}
            <Outlet />
          </div>
        </Content>
      </Layout>
    </Layout>
  );
}

export default function AppLayout() {
  return (
    <PageHeaderActionsProvider>
      <AppLayoutShell />
    </PageHeaderActionsProvider>
  );
}