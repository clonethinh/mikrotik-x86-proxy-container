import { Badge, Tag } from 'antd';
import {
  CheckCircleOutlined, PauseCircleOutlined, WarningOutlined, SyncOutlined,
} from '@ant-design/icons';

const STATUS_MAP: Record<string, { color: string; badge: 'success' | 'error' | 'warning' | 'processing' | 'default'; icon?: React.ReactNode; label: string }> = {
  running: { color: 'success', badge: 'success', icon: <CheckCircleOutlined />, label: 'RUNNING' },
  stopped: { color: 'default', badge: 'default', icon: <PauseCircleOutlined />, label: 'STOPPED' },
  error: { color: 'error', badge: 'error', icon: <WarningOutlined />, label: 'ERROR' },
  pending: { color: 'processing', badge: 'processing', icon: <SyncOutlined spin />, label: 'PENDING' },
};

interface Props {
  status: string | null | undefined;
  showDot?: boolean;
}

export default function ProxyStatusBadge({ status, showDot = true }: Props) {
  const key = status || 'unknown';
  const m = STATUS_MAP[key] ?? { color: 'default', badge: 'default' as const, label: key.toUpperCase() };

  if (showDot) {
    return (
      <Badge status={m.badge} text={
        <Tag color={m.color} icon={m.icon} bordered={false} style={{ margin: 0 }}>
          {m.label}
        </Tag>
      } />
    );
  }

  return <Tag color={m.color} icon={m.icon} bordered={false}>{m.label}</Tag>;
}