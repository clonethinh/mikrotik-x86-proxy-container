import { useState } from 'react';
import { Button, Flex, Tag, Tooltip, Typography } from 'antd';
import { CopyOutlined, LinkOutlined } from '@ant-design/icons';
import { formatProxy, type ProxyEndpointRow } from '../lib/proxyUtils';

const { Text } = Typography;

interface Props {
  row: ProxyEndpointRow;
  kind: 'http' | 'socks5';
  onCopy: (text: string, label?: string) => void;
  /** Khi API list không trả password — fetch qua /api/proxies/:id/password */
  proxyId?: number;
  revealPassword?: (id: number) => Promise<string>;
  compact?: boolean;
  /** Mở drawer connection URL thay vì copy trực tiếp */
  onOpenConnection?: () => void;
}

const KIND_META = {
  http: { label: 'HTTP', color: 'blue' as const, chipClass: 'proxy-endpoint-chip proxy-endpoint-chip--http' },
  socks5: { label: 'SOCKS5', color: 'magenta' as const, chipClass: 'proxy-endpoint-chip proxy-endpoint-chip--socks' },
};

async function resolveProxyUrl(
  row: ProxyEndpointRow,
  kind: 'http' | 'socks5',
  proxyId?: number,
  revealPassword?: (id: number) => Promise<string>,
): Promise<string> {
  let password = row.password;
  if (!password && proxyId != null && revealPassword) {
    password = await revealPassword(proxyId);
  }
  return formatProxy({ ...row, password }, kind);
}

export default function ProxyEndpoint({
  row,
  kind,
  onCopy,
  proxyId,
  revealPassword,
  compact,
  onOpenConnection,
}: Props) {
  const [copying, setCopying] = useState(false);
  const ip = row.publicIp;
  const port = kind === 'http' ? row.extHttpPort : row.extSocksPort;
  const meta = KIND_META[kind];

  const handleCopy = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!ip || !port) return;
    setCopying(true);
    try {
      const url = await resolveProxyUrl(row, kind, proxyId, revealPassword);
      if (!url) {
        onCopy('', 'Thiếu thông tin proxy');
        return;
      }
      onCopy(url, `Đã copy ${meta.label} URL`);
    } catch {
      onCopy('', 'Không lấy được password');
    } finally {
      setCopying(false);
    }
  };

  if (!ip || !port) {
    return <Text type="secondary" style={{ fontSize: 12 }}>Chờ IP</Text>;
  }

  if (compact) {
    return (
      <Tooltip title={onOpenConnection ? 'Connection URL' : 'Copy connection URL'}>
        <Button
          size="small"
          type={kind === 'http' ? 'primary' : 'default'}
          icon={<CopyOutlined />}
          loading={copying}
          onClick={(e) => {
            e.stopPropagation();
            if (onOpenConnection) onOpenConnection();
            else void handleCopy(e);
          }}
          style={
            kind === 'socks5'
              ? { borderColor: '#EB2F96', color: '#C41D7F' }
              : undefined
          }
        >
          :{port}
        </Button>
      </Tooltip>
    );
  }

  return (
    <Flex vertical gap={8} style={{ maxWidth: '100%' }}>
      <Flex align="center" gap={8} wrap="wrap">
        <Tag color={meta.color} icon={<LinkOutlined />}>
          {meta.label}
        </Tag>
        <span className={meta.chipClass} style={{ padding: '2px 8px', borderRadius: 4 }}>
          {ip}:{port}
        </span>
      </Flex>
      <Button
        size="small"
        type="default"
        icon={<CopyOutlined />}
        loading={copying}
        onClick={() => void handleCopy()}
        block
      >
        Copy connection URL
      </Button>
    </Flex>
  );
}