import { Badge, Progress, Typography } from 'antd';
import { ArrowDownOutlined, ArrowUpOutlined, TeamOutlined } from '@ant-design/icons';
import type { LiveMetrics } from '../../types/proxies';
import { formatBps, formatBytes } from '../../lib/proxiesFormat';

const { Text } = Typography;

interface Props {
  metrics?: LiveMetrics | null;
  compact?: boolean;
}

export default function ProxyTrafficMini({ metrics, compact = false }: Props) {
  if (!metrics) {
    return <Text type="secondary" style={{ fontSize: 12 }}>—</Text>;
  }

  const used = metrics.usedBytes
    ?? (BigInt(metrics.rxBytes || '0') + BigInt(metrics.txBytes || '0')).toString();
  const hasTraffic = (metrics.rxBps ?? 0) > 0 || (metrics.txBps ?? 0) > 0;
  const quotaPct = metrics.quotaPct;

  if (compact) {
    return (
      <div className="px-traffic px-traffic--compact">
        <Badge
          count={metrics.clients}
          showZero
          size="small"
          color={metrics.clients > 0 ? '#1677FF' : '#D9D9D9'}
          style={{ marginRight: 4 }}
        >
          <TeamOutlined style={{ fontSize: 14, color: 'var(--ant-color-text-secondary)' }} />
        </Badge>
        <span className={`px-traffic__speed${hasTraffic ? ' px-traffic__speed--active' : ''}`}>
          <ArrowUpOutlined className="px-traffic__up" />
          {formatBps(metrics.txBps)}
        </span>
        <span className={`px-traffic__speed${hasTraffic ? ' px-traffic__speed--active' : ''}`}>
          <ArrowDownOutlined className="px-traffic__down" />
          {formatBps(metrics.rxBps)}
        </span>
      </div>
    );
  }

  return (
    <div className="px-traffic">
      <div className="px-traffic__row">
        <TeamOutlined style={{ fontSize: 12, color: 'var(--ant-color-text-secondary)' }} />
        <span className="px-traffic__label">Clients</span>
        <span className="px-traffic__val">{metrics.clients}</span>
      </div>
      <div className="px-traffic__row">
        <ArrowUpOutlined className="px-traffic__up" />
        <span className="px-traffic__label">Upload</span>
        <span className={`px-traffic__val${hasTraffic ? ' px-traffic__val--active' : ''}`}>
          {formatBps(metrics.txBps)}
        </span>
      </div>
      <div className="px-traffic__row">
        <ArrowDownOutlined className="px-traffic__down" />
        <span className="px-traffic__label">Download</span>
        <span className={`px-traffic__val${hasTraffic ? ' px-traffic__val--active' : ''}`}>
          {formatBps(metrics.rxBps)}
        </span>
      </div>
      <div className="px-traffic__row">
        <span className="px-traffic__label">Used</span>
        <span className="px-traffic__val">{formatBytes(used)}</span>
      </div>
      {quotaPct != null && (
        <Progress
          percent={Math.min(100, quotaPct)}
          size="small"
          showInfo={false}
          strokeColor={quotaPct >= 90 ? '#FF4D4F' : quotaPct >= 70 ? '#FAAD14' : '#1677FF'}
          className="px-traffic__quota"
        />
      )}
    </div>
  );
}