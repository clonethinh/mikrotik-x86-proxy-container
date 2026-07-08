import { useState, useEffect } from 'react';
import { Form, Input, Button, Card, Typography, Tag, Space, Flex, theme, App } from 'antd';
import {
  UserOutlined, LockOutlined, CheckCircleFilled, CloseCircleFilled,
  ApiOutlined, CloudServerOutlined, GlobalOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../services/auth';
import { isUiPreview } from '../lib/env';

const { Title, Text, Paragraph } = Typography;

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const [loading, setLoading] = useState(false);
  const [serverOk, setServerOk] = useState<boolean | null>(null);
  const [serverMsg, setServerMsg] = useState('');

  useEffect(() => {
    if (isUiPreview) {
      navigate('/fleet', { replace: true });
      return;
    }
    let cancelled = false;
    fetch('/api/health')
      .then(r => r.ok ? r.json() : Promise.reject('HTTP ' + r.status))
      .then(d => {
        if (cancelled) return;
        setServerOk(true);
        setServerMsg(`RouterOS WebUI · uptime ${Math.round(d.uptime || 0)}s`);
      })
      .catch(e => {
        if (cancelled) return;
        setServerOk(false);
        setServerMsg(String(e));
      });
    return () => { cancelled = true; };
  }, [navigate]);

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
    <div className="login-split">
      <div className="login-split__brand">
        <div className="login-split__brand-inner">
          <Flex align="center" gap={14} style={{ marginBottom: 24 }}>
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: 14,
                background: 'rgba(255,255,255,0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backdropFilter: 'blur(4px)',
              }}
            >
              <ApiOutlined style={{ fontSize: 26, color: '#fff' }} />
            </div>
            <div>
              <Title level={2} style={{ margin: 0, color: '#fff', fontWeight: 700 }}>
                MikroTik Proxy
              </Title>
              <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 14 }}>Console v6</Text>
            </div>
          </Flex>
          <Paragraph style={{ color: 'rgba(255,255,255,0.88)', fontSize: 16, marginBottom: 0, lineHeight: 1.6 }}>
            Quản lý fleet proxy PPPoE trên RouterOS Container — mỗi WAN một IP public riêng.
          </Paragraph>
          <ul className="login-brand-features">
            <li><CloudServerOutlined /> Hub 3proxy · multi-slot</li>
            <li><GlobalOutlined /> IP động · DuckDNS · realtime WS</li>
            <li>HTTP <code style={{ background: 'rgba(0,0,0,0.2)', padding: '0 4px', borderRadius: 4 }}>30055+N</code> · SOCKS <code style={{ background: 'rgba(0,0,0,0.2)', padding: '0 4px', borderRadius: 4 }}>31055+N</code></li>
          </ul>
        </div>
      </div>

      <div className="login-split__form">
        <Card className="login-form-card" styles={{ body: { padding: 32 } }}>
          <Flex vertical gap={20}>
            <div>
              <Title level={4} style={{ margin: 0 }}>Đăng nhập</Title>
              <Text type="secondary">Truy cập WebUI quản trị router</Text>
            </div>

            <Tag
              icon={serverOk === true ? <CheckCircleFilled /> : serverOk === false ? <CloseCircleFilled /> : undefined}
              color={serverOk === true ? 'success' : serverOk === false ? 'error' : 'default'}
              style={{ margin: 0, padding: '6px 12px', width: '100%', justifyContent: 'flex-start' }}
            >
              {serverOk === null ? 'Đang kiểm tra API…' : serverMsg}
            </Tag>

            <Form layout="vertical" onFinish={onFinish} size="large" requiredMark={false}>
              <Form.Item name="username" label="Username" rules={[{ required: true, message: 'Nhập username' }]}>
                <Input
                  prefix={<UserOutlined style={{ color: token.colorTextSecondary }} />}
                  placeholder="admin"
                  autoComplete="username"
                />
              </Form.Item>
              <Form.Item name="password" label="Password" rules={[{ required: true, message: 'Nhập password' }]}>
                <Input.Password
                  prefix={<LockOutlined style={{ color: token.colorTextSecondary }} />}
                  placeholder="••••••••"
                  autoComplete="current-password"
                />
              </Form.Item>
              <Form.Item style={{ marginBottom: 0 }}>
                <Button type="primary" htmlType="submit" loading={loading} block size="large" style={{ height: 44 }}>
                  Đăng nhập
                </Button>
              </Form.Item>
            </Form>

            <Space direction="vertical" size={4}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Pool: <Text code>pppoe-out1+</Text> · Quản trị: DuckDNS host
              </Text>
              {isUiPreview && (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Xem UI không login: <Text code>npm run dev:preview</Text>
                </Text>
              )}
            </Space>
          </Flex>
        </Card>
      </div>
    </div>
  );
}