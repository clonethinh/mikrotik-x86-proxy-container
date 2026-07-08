import { Avatar, Tag, Typography } from 'antd';
import { GlobalOutlined } from '@ant-design/icons';
import type { ProxyUser } from '../../services/api';

const { Text } = Typography;

const STATUS_AVATAR: Record<string, string> = {
  running: '#52C41A',
  stopped: '#BFBFBF',
  error: '#FF4D4F',
  pending: '#1677FF',
};

interface Props {
  proxy: ProxyUser;
}

export default function ProxyWanCell({ proxy }: Props) {
  const color = STATUS_AVATAR[proxy.status || ''] ?? '#D9D9D9';

  return (
    <div className="px-wan">
      <Avatar
        size={36}
        style={{ background: color, flexShrink: 0 }}
        icon={<GlobalOutlined />}
      >
        {proxy.pppoeIdx}
      </Avatar>
      <div className="px-wan__meta">
        <Text strong className="px-wan__name">{proxy.pppoeName}</Text>
        <Tag
          bordered={false}
          color={proxy.proxyType === 'both' ? 'blue' : proxy.proxyType === 'http' ? 'geekblue' : 'magenta'}
          className="px-wan__type"
        >
          {proxy.proxyType.toUpperCase()}
        </Tag>
      </div>
    </div>
  );
}