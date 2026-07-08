import { Card, Descriptions, Flex, Tag, Typography, theme } from 'antd';
import {
  ApiOutlined, CloudOutlined, HeartOutlined, LinkOutlined,
} from '@ant-design/icons';
import type { DashboardData } from '../../services/api';

const { Text } = Typography;

interface Props {
  data: DashboardData;
}

export default function DashboardConnectionCard({ data }: Props) {
  const { token } = theme.useToken();
  const m = data.mikrotik;

  return (
    <Card
      className="dashboard-panel-card dashboard-connection-card"
      title={
        <span>
          <ApiOutlined style={{ marginRight: 8, color: token.colorPrimary }} />
          Kết nối quản trị
        </span>
      }
      style={{ boxShadow: token.boxShadowTertiary, height: '100%' }}
    >
      <Descriptions
        column={1}
        size="small"
        className="dashboard-connection-desc"
        items={[
          {
            key: 'host',
            label: 'API host',
            children: <Text code className="dashboard-connection-code">{m.host}</Text>,
          },
          ...(m.wanHost ? [{
            key: 'wan',
            label: 'WAN host',
            children: <Text>{m.wanHost}</Text>,
          }] : []),
          ...(m.managementUrl ? [{
            key: 'webui',
            label: 'WebUI',
            children: (
              <a href={m.managementUrl} target="_blank" rel="noreferrer" className="dashboard-connection-link">
                <LinkOutlined style={{ marginRight: 4 }} />
                {m.wanHost || m.managementUrl}
              </a>
            ),
          }] : []),
          ...(m.version ? [{
            key: 'ver',
            label: 'RouterOS',
            children: <Tag bordered={false}>{m.version}</Tag>,
          }] : []),
          ...(m.uptime ? [{
            key: 'up',
            label: 'Uptime',
            children: m.uptime,
          }] : []),
        ]}
      />

      <Flex gap={8} wrap="wrap" style={{ marginTop: 16 }}>
        <Tag
          icon={<HeartOutlined />}
          color={data.webuiRunning ? 'success' : 'error'}
          bordered={false}
        >
          {data.webuiRunning ? 'WebUI container OK' : 'WebUI container down'}
        </Tag>
        {m.boardName && (
          <Tag icon={<CloudOutlined />} bordered={false}>{m.boardName}</Tag>
        )}
      </Flex>
    </Card>
  );
}