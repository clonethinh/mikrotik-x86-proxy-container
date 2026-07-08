import { Tooltip, Typography } from 'antd';
import { UserOutlined } from '@ant-design/icons';
import type { ProxyUser } from '../../services/api';

const { Text } = Typography;

interface Props {
  proxy: ProxyUser;
}

export default function ProxyAuthCell({ proxy }: Props) {
  return (
    <Tooltip title={`User: ${proxy.username}`}>
      <div className="px-auth" onClick={(e) => e.stopPropagation()}>
        <UserOutlined style={{ fontSize: 12, color: 'var(--ant-color-text-tertiary, rgba(0,0,0,0.45))' }} />
        <Text className="px-auth__user" code>{proxy.username}</Text>
      </div>
    </Tooltip>
  );
}