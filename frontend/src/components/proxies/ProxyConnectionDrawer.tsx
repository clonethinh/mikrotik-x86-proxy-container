import { useEffect, useMemo, useState } from 'react';
import {
  Alert, Button, Flex, Input, Skeleton, Space, Tag, Tooltip, Typography,
} from 'antd';
import {
  CopyOutlined, EyeInvisibleOutlined, EyeOutlined, LinkOutlined,
} from '@ant-design/icons';
import type { ProxyUser } from '../../services/api';
import AppDrawer from '../ui/AppDrawer';
import { DrawerSection } from '../ui/DrawerSection';
import { formatProxy, type ProxyFormat } from '../../lib/proxyUtils';

const { Text } = Typography;

interface Props {
  proxy: ProxyUser | null;
  open: boolean;
  onClose: () => void;
  onCopy: (text: string, label?: string) => void;
  revealPassword: (id: number) => Promise<string>;
}

interface FormatRow {
  key: string;
  label: string;
  format: ProxyFormat;
  kind: 'http' | 'socks5';
}

const HTTP_FORMATS: FormatRow[] = [
  { key: 'httpurl', label: 'HTTP URL', format: 'httpurl', kind: 'http' },
  { key: 'ipportuserpass', label: 'ip:port:user:pass', format: 'ipportuserpass', kind: 'http' },
  { key: 'userpassipport', label: 'user:pass@ip:port', format: 'userpassipport', kind: 'http' },
  { key: 'ipport', label: 'ip:port', format: 'ipport', kind: 'http' },
];

const SOCKS_FORMATS: FormatRow[] = [
  { key: 'socks5url', label: 'SOCKS5 URL', format: 'socks5url', kind: 'socks5' },
  { key: 'ipportuserpass', label: 'ip:port:user:pass', format: 'ipportuserpass', kind: 'socks5' },
  { key: 'userpassipport', label: 'user:pass@ip:port', format: 'userpassipport', kind: 'socks5' },
  { key: 'ipport', label: 'ip:port', format: 'ipport', kind: 'socks5' },
];

function maskPassword(value: string, password: string, visible: boolean): string {
  if (visible || !password) return value;
  return value.split(password).join('••••••••');
}

function FormatLine({
  label,
  value,
  masked,
  onCopy,
}: {
  label: string;
  value: string;
  masked: string;
  onCopy: () => void;
}) {
  return (
    <div className="px-conn-drawer__line">
      <Text type="secondary" className="px-conn-drawer__line-label">{label}</Text>
      <Flex gap={8} align="center">
        <Input
          readOnly
          size="small"
          value={masked}
          className="px-conn-drawer__input"
          onFocus={(e) => e.target.select()}
        />
        <Tooltip title={`Copy ${label}`}>
          <Button
            size="small"
            type="primary"
            ghost
            icon={<CopyOutlined />}
            disabled={!value}
            onClick={onCopy}
          />
        </Tooltip>
      </Flex>
    </div>
  );
}

export default function ProxyConnectionDrawer({
  proxy,
  open,
  onClose,
  onCopy,
  revealPassword,
}: Props) {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (!open || !proxy) {
      setPassword('');
      setError(null);
      setShowPassword(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const load = async () => {
      try {
        if (proxy.password) {
          if (!cancelled) setPassword(proxy.password);
          return;
        }
        const pw = await revealPassword(proxy.id);
        if (!cancelled) setPassword(pw);
      } catch (e: unknown) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Không lấy được password');
          setPassword('');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => { cancelled = true; };
  }, [open, proxy?.id, proxy?.password, revealPassword]);

  const row = useMemo(() => {
    if (!proxy) return null;
    return {
      publicIp: proxy.publicIp,
      pppoeIdx: proxy.pppoeIdx,
      index: proxy.pppoeIdx,
      username: proxy.username,
      password,
      extHttpPort: proxy.extHttpPort,
      extSocksPort: proxy.extSocksPort,
      proxyType: proxy.proxyType,
    };
  }, [proxy, password]);

  const buildAllText = () => {
    if (!row) return '';
    const lines: string[] = [];
    if (proxy?.proxyType !== 'socks5') {
      for (const f of HTTP_FORMATS) {
        const v = formatProxy(row, f.kind, f.format);
        if (v) lines.push(v);
      }
    }
    if (proxy?.proxyType !== 'http') {
      for (const f of SOCKS_FORMATS) {
        const v = formatProxy(row, f.kind, f.format);
        if (v) lines.push(v);
      }
    }
    return lines.join('\n');
  };

  const renderSection = (title: string, color: string, formats: FormatRow[]) => {
    if (!row) return null;
    const kind = formats[0].kind;
    const port = kind === 'http' ? row.extHttpPort : row.extSocksPort;
    if (!port) return null;

    return (
      <DrawerSection title={title}>
        <Tag color={color} icon={<LinkOutlined />} bordered={false} style={{ marginBottom: 12 }}>
          {row.publicIp}:{port}
        </Tag>
        <Flex vertical gap={10}>
          {formats.map((f) => {
            const value = formatProxy(row, f.kind, f.format);
            return (
              <FormatLine
                key={`${kind}-${f.key}`}
                label={f.label}
                value={value}
                masked={maskPassword(value, password, showPassword)}
                onCopy={() => onCopy(value, `Đã copy ${f.label}`)}
              />
            );
          })}
        </Flex>
      </DrawerSection>
    );
  };

  const missingIp = !!(proxy && !proxy.publicIp);

  return (
    <AppDrawer
      open={open}
      onClose={onClose}
      width="md"
      icon={<LinkOutlined />}
      title="Connection URL"
      subtitle={proxy ? `${proxy.pppoeName} · ${proxy.username}` : undefined}
      headerExtra={(
        <Space>
          <Button
            size="small"
            icon={showPassword ? <EyeInvisibleOutlined /> : <EyeOutlined />}
            disabled={!password || loading}
            onClick={() => setShowPassword(v => !v)}
          >
            {showPassword ? 'Ẩn pass' : 'Hiện pass'}
          </Button>
          <Button
            size="small"
            type="primary"
            icon={<CopyOutlined />}
            disabled={loading || !!error || missingIp}
            onClick={() => onCopy(buildAllText(), 'Đã copy tất cả định dạng')}
          >
            Copy tất cả
          </Button>
        </Space>
      )}
    >
      {!proxy ? null : loading ? (
        <Skeleton active paragraph={{ rows: 6 }} />
      ) : (
        <>
          {missingIp && (
            <Alert
              type="warning"
              showIcon
              message="Chưa có IP public"
              description="Proxy cần IP WAN trước khi client kết nối được."
              style={{ marginBottom: 16 }}
            />
          )}
          {error && (
            <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />
          )}
          {!missingIp && (
            <>
              {proxy.proxyType !== 'socks5' && renderSection('HTTP Proxy', 'blue', HTTP_FORMATS)}
              {proxy.proxyType !== 'http' && renderSection('SOCKS5 Proxy', 'magenta', SOCKS_FORMATS)}
            </>
          )}
        </>
      )}
    </AppDrawer>
  );
}