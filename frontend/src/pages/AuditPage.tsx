import { useEffect, useState } from 'react';
import { Table, Tag, Typography, Card, Input, Select, Space, Empty } from 'antd';
import { api, AuditResponse } from '../services/api';
import { useWSEvent } from '../services/ws';

const { Title, Text } = Typography;

export default function AuditPage() {
  const [data, setData] = useState<AuditResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState<string | undefined>();
  const [pageSize, setPageSize] = useState(50);
  const [offset, setOffset] = useState(0);

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: String(pageSize),
        offset: String(offset),
      });
      if (actionFilter) params.set('action', actionFilter);
      if (search) params.set('username', search);
      const r = await api.get<AuditResponse>(`/api/audit?${params}`);
      setData(r);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [pageSize, offset, actionFilter]);
  // C2: search qua username dùng Enter (debounce)
  useEffect(() => {
    const t = setTimeout(() => { setOffset(0); load(); }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  // B8: realtime audit events
  useWSEvent((msg) => msg.type === 'audit.created', () => {
    if (offset === 0) load();
  });

  const columns = [
    { title: 'Thời gian', dataIndex: 'createdAt', key: 'createdAt', width: 180,
      render: (v: string) => new Date(v).toLocaleString('vi-VN'),
    },
    { title: 'User', dataIndex: 'username', key: 'username', width: 130 },
    { title: 'Action', dataIndex: 'action', key: 'action', width: 180,
      render: (v: string) => {
        const color = v.includes('delete') ? 'red' : v.includes('create') ? 'green' :
                       v.includes('login') || v.includes('logout') ? 'purple' :
                       v.includes('error') || v.includes('fail') ? 'volcano' : 'blue';
        return <Tag color={color}>{v}</Tag>;
      },
    },
    { title: 'Resource', dataIndex: 'resource', key: 'resource', width: 100 },
    { title: 'ID', dataIndex: 'resourceId', key: 'resourceId', width: 60 },
    { title: 'IP', dataIndex: 'ip', key: 'ip', width: 140 },
    { title: 'Chi tiết', dataIndex: 'details', key: 'details',
      render: (v: string | null) => v ? <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 11 }}>{v}</pre> : '—',
    },
  ];

  return (
    <div>
      <Title level={3} style={{ margin: '0 0 12px' }}>Audit log</Title>
      <Space style={{ marginBottom: 12, flexWrap: 'wrap' }}>
        <Input.Search
          placeholder="Tìm theo username..."
          allowClear
          style={{ width: 220 }}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <Select
          allowClear
          placeholder="Lọc theo action"
          style={{ width: 200 }}
          value={actionFilter}
          onChange={setActionFilter}
          options={[
            { value: 'login', label: 'login' },
            { value: 'create', label: 'create' },
            { value: 'update', label: 'update' },
            { value: 'delete', label: 'delete' },
            { value: 'start', label: 'start' },
            { value: 'stop', label: 'stop' },
            { value: 'reload-ip', label: 'reload-ip' },
            { value: 'restart', label: 'restart' },
            { value: 'test', label: 'test' },
            { value: 'reveal-password', label: 'reveal-password' },
            { value: 'export', label: 'export' },
            { value: 'import', label: 'import' },
            { value: 'change-password', label: 'change-password' },
            { value: 'mikrotik-test', label: 'mikrotik-test' },
          ]}
        />
        <Text type="secondary">{data?.total ?? 0} bản ghi</Text>
      </Space>
      <Card styles={{ body: { padding: 0 } }}>
        <Table
          rowKey="id"
          loading={loading}
          dataSource={data?.items || []}
          columns={columns as any}
          size="small"
          pagination={{
            current: Math.floor(offset / pageSize) + 1,
            pageSize,
            total: data?.total || 0,
            showSizeChanger: true,
            pageSizeOptions: [20, 50, 100, 200],
            onChange: (page, ps) => { setOffset((page - 1) * ps); setPageSize(ps); },
          }}
          locale={{
            emptyText: <Empty description="Chưa có audit log" />,
          }}
        />
      </Card>
    </div>
  );
}