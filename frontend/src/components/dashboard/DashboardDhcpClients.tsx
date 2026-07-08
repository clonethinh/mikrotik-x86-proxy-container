import { Card, Table, Tag, Typography, Button, Space, Empty, theme } from 'antd';
import {
  LaptopOutlined, RightOutlined, ApiOutlined, CheckCircleOutlined,
} from '@ant-design/icons';
import type { DhcpLease, DeviceRoute } from '../../services/api';

const { Text } = Typography;

const STATUS_META: Record<string, { color: string; label: string }> = {
  bound: { color: 'success', label: 'Bound' },
  waiting: { color: 'processing', label: 'Waiting' },
  offered: { color: 'warning', label: 'Offered' },
};

interface Props {
  leases: DhcpLease[];
  devices: DeviceRoute[];
  loading?: boolean;
  onManageDevices?: () => void;
}

function findDeviceRoute(lease: DhcpLease, devices: DeviceRoute[]): DeviceRoute | undefined {
  const mac = lease.macAddress.toUpperCase();
  const host = (lease.hostName || '').toLowerCase();
  return devices.find(d => {
    if (!d.enabled) return false;
    if (d.matchType === 'ip' && d.ipAddress === lease.address) return true;
    if (d.matchType === 'mac' && (d.macAddress || '').toUpperCase() === mac) return true;
    if (d.matchType === 'dhcp' && d.dhcpHostName && host && d.dhcpHostName.toLowerCase() === host) return true;
    if (d.matchType === 'dhcp' && d.ipAddress === lease.address) return true;
    return false;
  });
}

function sortLeases(rows: DhcpLease[]): DhcpLease[] {
  const order = (s: string) => (s === 'bound' ? 0 : s === 'waiting' ? 1 : 2);
  return [...rows].sort((a, b) => {
    const d = order(a.status) - order(b.status);
    if (d !== 0) return d;
    return a.address.localeCompare(b.address, undefined, { numeric: true });
  });
}

export default function DashboardDhcpClients({
  leases,
  devices,
  loading,
  onManageDevices,
}: Props) {
  const { token } = theme.useToken();
  const sorted = sortLeases(leases);
  const boundCount = leases.filter(l => l.status === 'bound').length;
  const routedCount = leases.filter(l => findDeviceRoute(l, devices)).length;

  const columns = [
    {
      title: 'Thiết bị',
      key: 'host',
      ellipsis: true,
      render: (_: unknown, r: DhcpLease) => (
        <Space direction="vertical" size={0}>
          <Text strong style={{ fontSize: 13 }}>
            {r.hostName || <Text type="secondary">(không tên)</Text>}
          </Text>
          {r.server && (
            <Text type="secondary" style={{ fontSize: 11 }}>{r.server}</Text>
          )}
        </Space>
      ),
    },
    {
      title: 'IP',
      dataIndex: 'address',
      width: 130,
      render: (v: string) => <Text code style={{ fontSize: 12 }}>{v}</Text>,
    },
    {
      title: 'MAC',
      dataIndex: 'macAddress',
      width: 148,
      ellipsis: true,
      render: (v: string) => <Text type="secondary" style={{ fontSize: 11 }}>{v}</Text>,
    },
    {
      title: 'Lease',
      dataIndex: 'status',
      width: 96,
      render: (s: string) => {
        const m = STATUS_META[s] ?? { color: 'default', label: s || '—' };
        return <Tag color={m.color} bordered={false}>{m.label}</Tag>;
      },
    },
    {
      title: 'Egress route',
      key: 'route',
      width: 140,
      render: (_: unknown, r: DhcpLease) => {
        const dev = findDeviceRoute(r, devices);
        if (!dev) return <Text type="secondary" style={{ fontSize: 12 }}>—</Text>;
        return (
          <Tag icon={<ApiOutlined />} color="geekblue" bordered={false}>
            {dev.pppoeName}
          </Tag>
        );
      },
    },
  ];

  return (
    <Card
      className="dashboard-panel-card dashboard-dhcp-card"
      title={(
        <span>
          <LaptopOutlined style={{ marginRight: 8, color: token.colorPrimary }} />
          Thiết bị LAN — DHCP leases
        </span>
      )}
      extra={onManageDevices && (
        <Button type="link" size="small" icon={<RightOutlined />} onClick={onManageDevices}>
          Định tuyến thiết bị
        </Button>
      )}
      style={{ boxShadow: token.boxShadowTertiary }}
    >
      <Space wrap size={8} style={{ marginBottom: 12 }}>
        <Tag bordered={false} color="blue">{leases.length} lease</Tag>
        <Tag bordered={false} color="success" icon={<CheckCircleOutlined />}>
          {boundCount} bound
        </Tag>
        {routedCount > 0 && (
          <Tag bordered={false} color="geekblue" icon={<ApiOutlined />}>
            {routedCount} có egress route
          </Tag>
        )}
      </Space>

      <Table
        className="dashboard-dhcp-table"
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={sorted}
        columns={columns}
        pagination={leases.length > 12 ? { pageSize: 12, size: 'small', showTotal: t => `${t} thiết bị` } : false}
        scroll={{ x: 640 }}
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="Không có DHCP lease trên router — kiểm tra DHCP Server LAN"
            />
          ),
        }}
      />
    </Card>
  );
}