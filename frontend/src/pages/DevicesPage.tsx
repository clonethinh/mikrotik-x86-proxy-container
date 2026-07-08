import { useEffect, useState } from 'react';
import {
  Table, Button, Space, Tag, Switch, Modal, Form, Select, Input,
  Popconfirm, App, Card, Typography, Alert, Tooltip,
} from 'antd';
import {
  PlusOutlined, ReloadOutlined, EditOutlined, DeleteOutlined,
  LaptopOutlined, ApiOutlined,
} from '@ant-design/icons';
import { api, DeviceRoute, DhcpLease, WanInfo } from '../services/api';
import { useWSEvent } from '../services/ws';
import { useTablePagination } from '../hooks/useTablePagination';

const { Title, Text } = Typography;

export default function DevicesPage() {
  const { message: msgApi } = App.useApp();
  const [devices, setDevices] = useState<DeviceRoute[]>([]);
  const [leases, setLeases] = useState<DhcpLease[]>([]);
  const [wans, setWans] = useState<WanInfo[]>([]);
  const [loading, setLoading] = useState(true);
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
    { title: 'STT', width: 60, render: (_: unknown, __: DeviceRoute, i: number) => i + 1 },
    { title: 'Tên', dataIndex: 'name', ellipsis: true },
    {
      title: 'Loại',
      dataIndex: 'matchType',
      width: 90,
      render: (t: string) => (
        <Tag color={t === 'dhcp' ? 'blue' : t === 'mac' ? 'purple' : 'cyan'}>{t.toUpperCase()}</Tag>
      ),
    },
    {
      title: 'IP / MAC',
      render: (_: unknown, r: DeviceRoute) => (
        <Space direction="vertical" size={0}>
          {r.ipAddress && <Text code>{r.ipAddress}</Text>}
          {r.macAddress && <Text type="secondary" style={{ fontSize: 12 }}>{r.macAddress}</Text>}
        </Space>
      ),
    },
    {
      title: 'WAN / Proxy',
      render: (_: unknown, r: DeviceRoute) => (
        <Space>
          <Tag icon={<ApiOutlined />}>{r.pppoeName}</Tag>
          <Text type="secondary">→ {r.pppoeName}</Text>
        </Space>
      ),
    },
    {
      title: 'Trạng thái',
      width: 120,
      render: (_: unknown, r: DeviceRoute) => (
        <Space direction="vertical" size={0}>
          <Tag color={r.applied && r.enabled ? 'success' : r.enabled ? 'processing' : 'default'}>
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
      title: 'Hành động',
      width: 160,
      render: (_: unknown, r: DeviceRoute) => (
        <Space>
          <Button size="small" icon={<ReloadOutlined />} onClick={() => reapply(r.id)} />
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)} />
          <Popconfirm title="Xóa định tuyến này?" onConfirm={() => remove(r.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <Title level={4} style={{ margin: 0 }}>
              <LaptopOutlined /> Định tuyến thiết bị LAN
            </Title>
            <Text type="secondary">Gán thiết bị (IP/MAC/DHCP) đi ra đúng WAN (pppoe-outX)</Text>
          </div>
          <Space>
            <Button icon={<ReloadOutlined />} onClick={load}>Refresh</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>Thêm thiết bị</Button>
          </Space>
        </div>

        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="Device routing đánh dấu egress traffic của thiết bị LAN qua routing table to_pppoeN. Để dùng HTTP/SOCKS proxy, client vẫn cần cấu hình proxy settings riêng."
        />

        <Table
          rowKey="id"
          loading={loading}
          dataSource={devices}
          columns={columns}
          pagination={tablePagination}
          scroll={{ x: 900 }}
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
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
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
                disabled: false,
              }))}
            />
          </Form.Item>

          <Form.Item name="note" label="Ghi chú">
            <Input.TextArea rows={2} maxLength={255} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}