import { useEffect, useMemo, useState } from 'react';
import {
  Table, Button, Space, Tag, Switch, Modal, Form, Select, Input,
  Popconfirm, App, Card, Typography, Tooltip,
} from 'antd';
import ProxyToolbar from '../components/ui/ProxyToolbar';
import ProxyPageShell, { ProxyCode } from '../components/proxy/ProxyPageShell';
import ProxyStatsRow from '../components/proxy/ProxyStatsRow';
import {
  PlusOutlined, ReloadOutlined, EditOutlined, DeleteOutlined,
  LaptopOutlined, ApiOutlined, CheckCircleOutlined, ClockCircleOutlined,
} from '@ant-design/icons';
import { api, DeviceRoute, DhcpLease, WanInfo } from '../services/api';
import { useWSEvent } from '../services/ws';
import { useTablePagination } from '../hooks/useTablePagination';

const { Text } = Typography;

export default function DevicesPage() {
  const { message: msgApi } = App.useApp();
  const [devices, setDevices] = useState<DeviceRoute[]>([]);
  const [leases, setLeases] = useState<DhcpLease[]>([]);
  const [wans, setWans] = useState<WanInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<DeviceRoute | null>(null);
  const [form] = Form.useForm();
  const matchType = Form.useWatch('matchType', form);
  const { pagination: tablePagination } = useTablePagination(20, ['10', '20', '50', '100']);

  const load = async () => {
    try {
      const [d, l, w] = await Promise.all([
        api.get<DeviceRoute[]>('/api/devices'),
        api.get<DhcpLease[]>('/api/devices/dhcp-leases'),
        api.get<WanInfo[]>('/api/wan'),
      ]);
      setDevices(d);
      setLeases(l);
      setWans(w);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  useWSEvent(
    (msg) => msg.type?.startsWith('device.'),
    () => load(),
  );

  const stats = useMemo(() => ({
    total: devices.length,
    enabled: devices.filter(d => d.enabled).length,
    applied: devices.filter(d => d.applied && d.enabled).length,
    pending: devices.filter(d => d.enabled && !d.applied).length,
  }), [devices]);

  const filtered = useMemo(() => {
    if (!search.trim()) return devices;
    const q = search.toLowerCase();
    return devices.filter(d =>
      d.name.toLowerCase().includes(q)
      || (d.ipAddress || '').includes(q)
      || (d.macAddress || '').toLowerCase().includes(q)
      || d.pppoeName.toLowerCase().includes(q),
    );
  }, [devices, search]);

  const openCreate = () => {
    setEditTarget(null);
    form.resetFields();
    form.setFieldsValue({ matchType: 'dhcp', pppoeIdx: wans.find(w => w.running)?.index || 2 });
    setModalOpen(true);
  };

  const openEdit = (row: DeviceRoute) => {
    setEditTarget(row);
    form.setFieldsValue(row);
    setModalOpen(true);
  };

  const onLeaseSelect = (leaseId: string) => {
    const lease = leases.find(l => l.id === leaseId);
    if (!lease) return;
    form.setFieldsValue({
      name: lease.hostName || `device-${lease.address}`,
      ipAddress: lease.address,
      macAddress: lease.macAddress,
      dhcpHostName: lease.hostName,
    });
  };

  const submit = async () => {
    const values = await form.validateFields();
    try {
      if (editTarget) {
        await api.patch(`/api/devices/${editTarget.id}`, values);
        msgApi.success('Đã cập nhật định tuyến thiết bị');
      } else {
        await api.post('/api/devices', values);
        msgApi.success('Đã tạo định tuyến thiết bị');
      }
      setModalOpen(false);
      load();
    } catch (e: any) {
      msgApi.error(e.message);
    }
  };

  const toggleEnabled = async (row: DeviceRoute, enabled: boolean) => {
    try {
      await api.patch(`/api/devices/${row.id}`, { enabled });
      msgApi.success(enabled ? 'Đã bật' : 'Đã tắt');
      load();
    } catch (e: any) {
      msgApi.error(e.message);
    }
  };

  const remove = async (id: number) => {
    try {
      await api.del(`/api/devices/${id}`);
      msgApi.success('Đã xóa');
      load();
    } catch (e: any) {
      msgApi.error(e.message);
    }
  };

  const reapply = async (id: number) => {
    try {
      await api.post(`/api/devices/${id}/apply`);
      msgApi.success('Đã apply lên router');
      load();
    } catch (e: any) {
      msgApi.error(e.message);
    }
  };

  const columns = [
    { title: '#', width: 52, render: (_: unknown, __: DeviceRoute, i: number) => (
      <Text type="secondary" style={{ fontSize: 12 }}>{i + 1}</Text>
    ) },
    { title: 'Tên', dataIndex: 'name', ellipsis: true,
      render: (v: string) => <Text strong style={{ fontSize: 13 }}>{v}</Text>,
    },
    {
      title: 'Loại',
      dataIndex: 'matchType',
      width: 90,
      render: (t: string) => (
        <Tag color={t === 'dhcp' ? 'blue' : t === 'mac' ? 'purple' : 'cyan'} bordered={false}>{t.toUpperCase()}</Tag>
      ),
    },
    {
      title: 'IP / MAC',
      render: (_: unknown, r: DeviceRoute) => (
        <Space direction="vertical" size={0}>
          {r.ipAddress && <Text code style={{ fontSize: 12 }}>{r.ipAddress}</Text>}
          {r.macAddress && <Text type="secondary" style={{ fontSize: 11 }}>{r.macAddress}</Text>}
        </Space>
      ),
    },
    {
      title: 'Egress WAN',
      render: (_: unknown, r: DeviceRoute) => (
        <Tag icon={<ApiOutlined />} color="geekblue" bordered={false}>{r.pppoeName}</Tag>
      ),
    },
    {
      title: 'Trạng thái',
      width: 120,
      render: (_: unknown, r: DeviceRoute) => (
        <Space direction="vertical" size={0}>
          <Tag color={r.applied && r.enabled ? 'success' : r.enabled ? 'processing' : 'default'} bordered={false}>
            {r.enabled ? (r.applied ? 'Applied' : 'Pending') : 'Off'}
          </Tag>
          {r.statusMessage && r.statusMessage !== 'applied' && (
            <Tooltip title={r.statusMessage}>
              <Text type="danger" style={{ fontSize: 11 }} ellipsis>{r.statusMessage}</Text>
            </Tooltip>
          )}
        </Space>
      ),
    },
    {
      title: 'Bật/Tắt',
      width: 80,
      render: (_: unknown, r: DeviceRoute) => (
        <Switch checked={r.enabled} onChange={(v) => toggleEnabled(r, v)} size="small" />
      ),
    },
    {
      title: '',
      width: 140,
      render: (_: unknown, r: DeviceRoute) => (
        <Space size={4}>
          <Tooltip title="Apply lại lên router">
            <Button size="small" icon={<ReloadOutlined />} onClick={() => reapply(r.id)} />
          </Tooltip>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)} />
          <Popconfirm title="Xóa định tuyến này?" onConfirm={() => remove(r.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <ProxyPageShell
      title={<><LaptopOutlined style={{ marginRight: 8, color: '#1677FF' }} />Định tuyến thiết bị</>}
      subtitle={(
        <>
          Gán thiết bị LAN (IP/MAC/DHCP) egress qua <ProxyCode>to_pppoeN</ProxyCode> — proxy HTTP/SOCKS cấu hình riêng trên client
        </>
      )}
      policy={{
        id: 'devices-routing-info',
        message: 'Device routing vs proxy client',
        description: 'Routing table đánh dấu traffic egress của thiết bị qua WAN chỉ định. Client vẫn cần cấu hình proxy settings nếu dùng HTTP/SOCKS.',
      }}
      stats={(
        <ProxyStatsRow
          items={[
            { key: 'all', title: 'Thiết bị', value: stats.total, icon: <LaptopOutlined />, accent: 'primary' },
            { key: 'on', title: 'Đang bật', value: stats.enabled, icon: <CheckCircleOutlined />, accent: 'success' },
            { key: 'ok', title: 'Applied', value: stats.applied, icon: <ApiOutlined />, accent: 'purple' },
            { key: 'pend', title: 'Pending', value: stats.pending, icon: <ClockCircleOutlined />, accent: 'warning', valueStyle: stats.pending ? { color: '#D48806' } : undefined },
          ]}
        />
      )}
      toolbar={(
        <ProxyToolbar
          filters={(
            <Input.Search
              placeholder="Tìm tên, IP, MAC, pppoe-out…"
              allowClear
              style={{ width: 280, maxWidth: '100%' }}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          )}
          actions={(
            <>
              <Button icon={<ReloadOutlined />} onClick={load}>Làm mới</Button>
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>Thêm thiết bị</Button>
            </>
          )}
        />
      )}
    >
      <Card className="proxy-table-card" styles={{ body: { padding: 0 } }}>
        <Table
          rowKey="id"
          loading={loading}
          dataSource={filtered}
          columns={columns}
          pagination={tablePagination}
          scroll={{ x: 960 }}
          size="middle"
        />
      </Card>

      <Modal
        title={editTarget ? 'Sửa định tuyến thiết bị' : 'Thêm định tuyến thiết bị'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={submit}
        okText={editTarget ? 'Lưu' : 'Tạo'}
        width={520}
        destroyOnHidden
        className="app-modal"
      >
        <Form form={form} layout="vertical" style={{ marginTop: 8 }}>
          <Form.Item name="matchType" label="Kiểu match" rules={[{ required: true }]}>
            <Select options={[
              { value: 'dhcp', label: 'DHCP lease (IP + MAC)' },
              { value: 'ip', label: 'IP cố định' },
              { value: 'mac', label: 'MAC address' },
            ]} />
          </Form.Item>

          {matchType === 'dhcp' && (
            <Form.Item label="Chọn từ DHCP lease">
              <Select
                showSearch
                placeholder="Chọn lease..."
                optionFilterProp="label"
                onChange={onLeaseSelect}
                options={leases.map(l => ({
                  value: l.id,
                  label: `${l.hostName || l.address} — ${l.address} (${l.macAddress})`,
                }))}
              />
            </Form.Item>
          )}

          <Form.Item name="name" label="Tên hiển thị" rules={[{ required: true, max: 64 }]}>
            <Input placeholder="VD: PC-Kế toán" />
          </Form.Item>

          {(matchType === 'ip' || matchType === 'dhcp') && (
            <Form.Item
              name="ipAddress"
              label="IP address"
              rules={[{ required: matchType === 'ip', message: 'Nhập IP' }]}
            >
              <Input placeholder="192.168.88.100" />
            </Form.Item>
          )}

          {(matchType === 'mac' || matchType === 'dhcp') && (
            <Form.Item
              name="macAddress"
              label="MAC address"
              rules={[{ required: matchType === 'mac', message: 'Nhập MAC' }]}
            >
              <Input placeholder="AA:BB:CC:DD:EE:FF" />
            </Form.Item>
          )}

          <Form.Item name="pppoeIdx" label="WAN (pppoe-outX)" rules={[{ required: true }]}>
            <Select
              options={wans.map(w => ({
                value: w.index,
                label: `${w.name} — ${w.publicIp || 'no IP'} ${w.running ? '(up)' : '(down)'}`,
              }))}
            />
          </Form.Item>

          <Form.Item name="note" label="Ghi chú">
            <Input.TextArea rows={2} maxLength={255} />
          </Form.Item>
        </Form>
      </Modal>
    </ProxyPageShell>
  );
}