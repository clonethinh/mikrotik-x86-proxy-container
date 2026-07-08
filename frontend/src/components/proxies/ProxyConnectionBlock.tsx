import { useState } from 'react';
import { Button, Tooltip, Typography, theme } from 'antd';
import { CopyOutlined } from '@ant-design/icons';
import type { ProxyUser } from '../../services/api';
import { formatProxy } from '../../lib/proxyUtils';

const { Text } = Typography;

interface Props {
  proxy: ProxyUser;
  onCopy: (text: string, label?: string) => void;
  revealPassword?: (id: number) => Promise<string>;
}

function PortChip({
  kind,
  port,
  proxy,
  onCopy,
  revealPassword,
}: {
  kind: 'http' | 'socks5';
  port: number;
  proxy: ProxyUser;
  onCopy: (text: string, label?: string) => void;
  revealPassword?: (id: number) => Promise<string>;
}) {
  const [loading, setLoading] = useState(false);
  const isHttp = kind === 'http';

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setLoading(true);
    try {
      let password = proxy.password;
      if (!password && revealPassword) password = await revealPassword(proxy.id);
      const url = formatProxy({ ...proxy, password }, kind);
      if (!url) return;
      onCopy(url, `Đã copy ${isHttp ? 'HTTP' : 'SOCKS5'} URL`);
    } catch {
      onCopy('', 'Không lấy được password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Tooltip title={`Copy ${isHttp ? 'HTTP' : 'SOCKS5'} URL`}>
      <button
        type="button"
        className={`px-port-chip ${isHttp ? 'px-port-chip--http' : 'px-port-chip--socks'}`}
        disabled={loading}
        onClick={(e) => void handleCopy(e)}
      >
        <span className="px-port-chip__label">{isHttp ? 'HTTP' : 'SOCKS'}</span>
        :{port}
        <CopyOutlined style={{ fontSize: 10 }} />
      </button>
    </Tooltip>
  );
}

export default function ProxyConnectionBlock({ proxy, onCopy, revealPassword }: Props) {
  const { token } = theme.useToken();

  if (!proxy.publicIp) {
    return <Text type="secondary" style={{ fontSize: 12 }}>Chờ IP WAN</Text>;
  }

  return (
    <div className="px-conn" onClick={(e) => e.stopPropagation()}>
      <div className="px-conn__ip-row">
        <span className="px-conn__ip">{proxy.publicIp}</span>
        <Tooltip title="Copy IP">
          <Button
            type="text"
            size="small"
            icon={<CopyOutlined />}
            onClick={() => onCopy(proxy.publicIp!, 'Đã copy IP')}
          />
        </Tooltip>
      </div>
      <div className="px-conn__ports">
        {proxy.proxyType !== 'socks5' && proxy.extHttpPort && (
          <PortChip kind="http" port={proxy.extHttpPort} proxy={proxy} onCopy={onCopy} revealPassword={revealPassword} />
        )}
        {proxy.proxyType !== 'http' && proxy.extSocksPort && (
          <PortChip kind="socks5" port={proxy.extSocksPort} proxy={proxy} onCopy={onCopy} revealPassword={revealPassword} />
        )}
      </div>
      {!proxy.extHttpPort && !proxy.extSocksPort && (
        <Text type="secondary" style={{ fontSize: 11, color: token.colorTextTertiary }}>
          Chưa có cổng
        </Text>
      )}
    </div>
  );
}