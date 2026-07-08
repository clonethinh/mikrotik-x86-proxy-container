import { Button, Descriptions, Space, Switch, Tag, Typography } from 'antd';
import {
  BarChartOutlined, CloseOutlined, CopyOutlined, EditOutlined, EyeOutlined,
  FileTextOutlined, ReloadOutlined, ThunderboltOutlined,
} from '@ant-design/icons';
import type { ProxyUser } from '../../services/api';
import { formatProxy } from '../../lib/proxyUtils';
import type { LiveMetrics } from '../../types/proxies';
import ProxyConnectionBlock from './ProxyConnectionBlock';
import ProxyStatusBadge from './ProxyStatusBadge';
import ProxyTrafficMini from './ProxyTrafficMini';

const { Text, Title } = Typography;

interface Props {
  proxy: ProxyUser;
  metrics?: LiveMetrics | null;
  wanUptime?: string | null;
  busy: boolean;
  onClose: () => void;
  onCopy: (text: string, label?: string) => void;
  onRevealPassword: () => Promise<string>;
  onCopyUserPass: () => Promise<void>;
  onToggle: () => void;
  onTest: () => void;
  onReloadIp: () => void;
  onLogs: () => void;
  onAnalytics: () => void;
  onEdit: () => void;
}

export default function ProxyDetailPanel({
  proxy,
  metrics,
  wanUptime,
  busy,
  onClose,
  onCopy,
  onRevealPassword,
  onCopyUserPass,
  onToggle,
  onTest,
  onReloadIp,
  onLogs,
  onAnalytics,
  onEdit,
}: Props) {
  return (
    <aside className="proxies-detail-panel">
      <div className="proxies-detail-panel__head">
        <div className="proxies-detail-panel__title-row">
          <div>
            <Title level={5} className="proxies-detail-panel__pppoe">{proxy.pppoeName}</Title>
            <div className="proxies-detail-panel__ip">{proxy.publicIp || 'Chưa có IP public'}</div>
          </div>
          <Button type="text" size="small" icon={<CloseOutlined />} onClick={onClose} aria-label="Đóng" />
        </div>
        <Space wrap size={8} style={{ marginTop: 12 }}>
          <ProxyStatusBadge status={proxy.status} showDot={false} />
          <Tag bordered={false}>{proxy.proxyType.toUpperCase()}</Tag>
          <Space size={4}>
            <Text type="secondary" style={{ fontSize: 12 }}>Bật</Text>
            <Switch size="small" checked={proxy.enabled} loading={busy} onChange={onToggle} />
          </Space>
        </Space>
        {proxy.publicIp && (
          <div className="proxies-detail-panel__quick-copy">
            {proxy.proxyType !== 'socks5' && proxy.extHttpPort && (
              <Button
                size="small"
                className="px-port-chip px-port-chip--http"
                icon={<CopyOutlined />}
                onClick={() => onCopy(formatProxy(proxy, 'http'), 'Đã copy HTTP URL')}
              >
                HTTP :{proxy.extHttpPort}
              </Button>
            )}
            {proxy.proxyType !== 'http' && proxy.extSocksPort && (
              <Button
                size="small"
                className="px-port-chip px-port-chip--socks"
                icon={<CopyOutlined />}
                onClick={() => onCopy(formatProxy(proxy, 'socks5'), 'Đã copy SOCKS5 URL')}
              >
                SOCKS :{proxy.extSocksPort}
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="proxies-detail-panel__body">
        <div className="proxies-detail-panel__section">
          <div className="proxies-detail-panel__section-title">Kết nối client</div>
          <ProxyConnectionBlock proxy={proxy} onCopy={onCopy} />
        </div>

        <div className="proxies-detail-panel__section">
          <div className="proxies-detail-panel__section-title">Đăng nhập</div>
          <Space>
            <Text code>{proxy.username}</Text>
            <Button
              size="small"
              icon={<EyeOutlined />}
              onClick={() => {
                void onRevealPassword()
                  .then(pw => onCopy(pw, 'Đã copy password'))
                  .catch(() => {});
              }}
            />
            <Button
              size="small"
              icon={<CopyOutlined />}
              onClick={() => void onCopyUserPass()}
            />
          </Space>
        </div>

        <div className="proxies-detail-panel__section">
          <div className="proxies-detail-panel__section-title">Traffic live</div>
          <ProxyTrafficMini metrics={metrics} />
        </div>

        <div className="proxies-detail-panel__section">
          <div className="proxies-detail-panel__section-title">Container</div>
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label="Container">{proxy.containerName}</Descriptions.Item>
            <Descriptions.Item label="Veth">{proxy.vethName}</Descriptions.Item>
            <Descriptions.Item label="Veth IP"><Text code>{proxy.vethIp}</Text></Descriptions.Item>
            <Descriptions.Item label="WAN uptime">{wanUptime || '—'}</Descriptions.Item>
            <Descriptions.Item label="Latency test">
              {proxy.lastLatencyMs ? `${proxy.lastLatencyMs} ms` : '—'}
            </Descriptions.Item>
          </Descriptions>
        </div>
      </div>

      <div className="proxies-detail-panel__actions">
        <Button type="primary" icon={<BarChartOutlined />} onClick={onAnalytics}>Analytics</Button>
        <Button icon={<ThunderboltOutlined />} loading={busy} onClick={onTest}>Test</Button>
        <Button icon={<ReloadOutlined />} loading={busy} onClick={onReloadIp}>Reload IP</Button>
        <Button icon={<FileTextOutlined />} onClick={onLogs}>Logs</Button>
        <Button icon={<EditOutlined />} onClick={onEdit}>Sửa</Button>
      </div>
    </aside>
  );
}