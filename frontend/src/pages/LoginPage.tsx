import { useState, useEffect } from 'react';
import { Form, Input, Button, Card, Typography, Tag, Space, Flex } from 'antd';
import { UserOutlined, LockOutlined, CheckCircleFilled, CloseCircleFilled, ApiOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../services/auth';
import { App } from 'antd';

const { Title, Text, Paragraph } = Typography;

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [serverOk, setServerOk] = useState<boolean | null>(null);
  const [serverMsg, setServerMsg] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/health')
      .then(r => r.ok ? r.json() : Promise.reject('HTTP ' + r.status))
      .then(d => {
        if (cancelled) return;
        setServerOk(true);
        setServerMsg(`RouterOS WebUI · uptime ${Math.round(d.uptime || 0)}s · ${d.deployTarget || 'router'}`);
      })
      .catch(e => {
        if (cancelled) return;
        setServerOk(false);
        setServerMsg(String(e));
      });
    return () => { cancelled = true; };
  }, []);

  const onFinish = async (vals: { username: string; password: string }) => {
    setLoading(true);
    const ok = await login(vals.username, vals.password);
    setLoading(false);
    if (ok) {
      message.success('Đăng nhập thành công');
      navigate('/fleet');
    } else {
      message.error('Sai username hoặc password');
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(145deg, #F5F5F5 0%, #E6F4FF 45%, #F0F5FF 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <Card
        style={{
          width: 440,
          maxWidth: '100%',
          borderRadius: 12,
          boxShadow: '0 6px 16px 0 rgba(0,0,0,0.08), 0 3px 6px -4px rgba(0,0,0,0.12)',
        }}
        styles={{ body: { padding: 32 } }}
      >
        <Flex vertical gap={24}>
          <div style={{ textAlign: 'center' }}>
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: 12,
                margin: '0 auto 16px',
                background: 'linear-gradient(135deg, #1677FF 0%, #0958D9 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <ApiOutlined style={{ fontSize: 28, color: '#fff' }} />
            </div>
            <Title level={3} style={{ margin: 0 }}>MikroTik Proxy Console</Title>
            <Paragraph type="secondary" style={{ margin: '8px 0 0' }}>
              Quản lý proxy fleet · IP động PPPoE
            </Paragraph>
          </div>

          <Tag
            icon={serverOk === true ? <CheckCircleFilled /> : serverOk === false ? <CloseCircleFilled /> : undefined}
            color={serverOk === true ? 'success' : serverOk === false ? 'error' : 'default'}
            style={{ margin: 0, justifyContent: 'center', padding: '6px 12px' }}
          >
            {serverOk === null ? 'Đang kiểm tra API…' : serverMsg}
          </Tag>

          <Form layout="vertical" onFinish={onFinish} size="large" requiredMark={false}>
            <Form.Item name="username" label="Username" rules={[{ required: true, message: 'Nhập username' }]}>
              <Input prefix={<UserOutlined style={{ color: '#8c8c8c' }} />} placeholder="admin" autoComplete="username" />
            </Form.Item>
            <Form.Item name="password" label="Password" rules={[{ required: true, message: 'Nhập password' }]}>
              <Input.Password prefix={<LockOutlined style={{ color: '#8c8c8c' }} />} placeholder="••••••••" autoComplete="current-password" />
            </Form.Item>
            <Form.Item style={{ marginBottom: 0 }}>
              <Button type="primary" htmlType="submit" loading={loading} block size="large">
                Đăng nhập
              </Button>
            </Form.Item>
          </Form>

          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Proxy pool: <Text code>pppoe-out1+</Text> · Quản trị: chỉ dùng host DuckDNS (IP động, không bookmark IP)
            </Text>
          </Space>
        </Flex>
      </Card>
    </div>
  );
}