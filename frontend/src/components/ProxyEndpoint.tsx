import { Button, Flex, Tag, Tooltip, Typography } from 'antd';
import { CopyOutlined, LinkOutlined } from '@ant-design/icons';
import { formatProxy, type ProxyEndpointRow } from '../lib/proxyUtils';

const { Text } = Typography;

interface Props {
  row: ProxyEndpointRow;
  kind: 'http' | 'socks5';
  onCopy: (text: string, label?: string) => void;
  compact?: boolean;
}

const KIND_META = {
  http: { label: 'HTTP', color: 'blue' as const, chipClass: 'proxy-endpoint-chip proxy-endpoint-chip--http' },
  socks5: { label: 'SOCKS5', color: 'magenta' as const, chipClass: 'proxy-endpoint-chip proxy-endpoint-chip--socks' },
};

export default function ProxyEndpoint({ row, kind, onCopy, compact }: Props) {
  const ip = row.publicIp;
  const port = kind === 'http' ? row.extHttpPort : row.extSocksPort;
  const meta = KIND_META[kind];

  if (!ip || !port) {
    return <Text type="secondary" style={{ fontSize: 12 }}>Chờ IP</Text>;
  }

  const url = formatProxy(row as Parameters<typeof formatProxy>[0], kind);

  if (compact) {
    return (
      <Tooltip title={url}>
        <Button
          size="small"
          type={kind === 'http' ? 'primary' : 'default'}
          icon={<CopyOutlined />}
          onClick={() => onCopy(url, `Đã copy ${meta.label}`)}
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
        onClick={() => onCopy(url, `Đã copy ${meta.label} URL`)}
        block
      >
        Copy connection URL
      </Button>
    </Flex>
  );
}