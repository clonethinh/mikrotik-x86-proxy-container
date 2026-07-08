import { useEffect, useMemo, useState } from 'react';
import { Table, Tag, Typography, Card, Input, Select, Button } from 'antd';
import ProxyPageShell from '../components/proxy/ProxyPageShell';
import ProxyStatsRow from '../components/proxy/ProxyStatsRow';
import ProxyToolbar from '../components/ui/ProxyToolbar';
import {
  UserOutlined, FileSearchOutlined, ReloadOutlined,
} from '@ant-design/icons';
import { api, AuditResponse } from '../services/api';
import { useWSEvent } from '../services/ws';

const { Text } = Typography;

function actionColor(action: string): string {
  if (action.includes('delete')) return 'red';
  if (action.includes('create')) return 'green';
  if (action.includes('login') || action.includes('logout')) return 'purple';
  if (action.includes('error') || action.includes('fail')) return 'volcano';
  return 'blue';
}

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

  useEffect(() => {
    const t = setTimeout(() => { setOffset(0); load(); }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  useWSEvent((msg) => msg.type === 'audit.created', () => {
    if (offset === 0) load();
  });

  const actionStats = useMemo(() => {
    const items = data?.items ?? [];
    const users = new Set(items.map(i => i.username)).size;
    const creates = items.filter(i => i.action.includes('create')).length;
    const deletes = items.filter(i => i.action.includes('delete')).length;
    return { users, creates, deletes };
  }, [data?.items]);

  const columns = [
    {
      title: 'Thời gian',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 168,
      render: (v: string) => (
        <Text style={{ fontSize: 12 }}>{new Date(v).toLocaleString('vi-VN')}</Text>
      ),
    },
    {
      title: 'User',
      dataIndex: 'username',
      key: 'username',
      width: 120,
      render: (v: string) => <Tag icon={<UserOutlined />} bordered={false}>{v}</Tag>,
    },
    {
      title: 'Action',
      dataIndex: 'action',
      key: 'action',
      width: 160,
      render: (v: string) => <Tag color={actionColor(v)} className="audit-action-tag" bordered={false}>{v}</Tag>,
    },
    { title: 'Resource', dataIndex: 'resource', key: 'resource', width: 100 },
    { title: 'ID', dataIndex: 'resourceId', key: 'resourceId', width: 56 },
    { title: 'IP', dataIndex: 'ip', key: 'ip', width: 130,
      render: (v: string) => <Text code style={{ fontSize: 11 }}>{v}</Text>,
    },
    {
      title: 'Chi tiết',
      dataIndex: 'details',
      key: 'details',
      render: (v: string | null) => v
        ? <pre className="audit-details-pre">{v}</pre>
        : <Text type="secondary">—</Text>,
    },
  ];

  return (
    <ProxyPageShell
      stats={(
        <ProxyStatsRow
          items={[
            { key: 'total', title: 'Tổng bản ghi', value: data?.total ?? 0, icon: <FileSearchOutlined />, accent: 'primary' },
            { key: 'page', title: 'Trang hiện tại', value: data?.items?.length ?? 0, accent: 'default' },
            { key: 'users', title: 'User (trang)', value: actionStats.users, icon: <UserOutlined />, accent: 'purple' },
            { key: 'mut', title: 'Create / Delete', value: `${actionStats.creates}/${actionStats.deletes}`, accent: 'warning' },
          ]}
        />
      )}
      toolbar={(
        <ProxyToolbar
          filters={(
            <>
              <Input.Search
                placeholder="Tìm theo username…"
                allowClear
                style={{ width: 220, maxWidth: '100%' }}
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              <Select
                allowClear
                placeholder="Lọc action"
                style={{ width: 180 }}
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
            </>
          )}
          actions={(
            <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>Làm mới</Button>
          )}
        />
      )}
    >
      <Card className="proxy-table-card" styles={{ body: { padding: 0 } }}>
        <Table
          rowKey="id"
          loading={loading}
          dataSource={data?.items || []}
          columns={columns}
          size="middle"
          pagination={{
            current: Math.floor(offset / pageSize) + 1,
            pageSize,
            total: data?.total || 0,
            showSizeChanger: true,
            pageSizeOptions: [20, 50, 100, 200],
            showTotal: (t) => `${t} bản ghi`,
            onChange: (page, ps) => { setOffset((page - 1) * ps); setPageSize(ps); },
          }}
        />
      </Card>
    </ProxyPageShell>
  );
}