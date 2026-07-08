import { Tag, Tooltip } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, SyncOutlined, HeartOutlined } from '@ant-design/icons';
import { containerStatusColor, containerStatusLabel } from '../lib/proxyUtils';

interface Props {
  status: string | null | undefined;
  containerName?: string | null;
  hasContainer?: boolean;
}

export default function ContainerStatusTag({ status, containerName, hasContainer }: Props) {
  if (!hasContainer && !status) {
    return <Tag color="default">Chưa deploy</Tag>;
  }

  const color = containerStatusColor(status);
  const label = containerStatusLabel(status);
  const icon = color === 'success'
    ? <HeartOutlined />
    : color === 'error'
      ? <CloseCircleOutlined />
      : color === 'processing'
        ? <SyncOutlined spin />
        : undefined;

  return (
    <Tooltip title={containerName || undefined}>
      <Tag color={color} icon={icon}>{label}</Tag>
    </Tooltip>
  );
}