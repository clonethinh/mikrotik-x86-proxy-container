import { useEffect, useMemo, useState } from 'react';
import { Button, Chip, Label, ListBox, Select } from '@heroui/react';
import { api, AuditResponse } from '../services/api';
import { useWSEvent } from '../services/ws';
import { formatDateTime } from '../lib/format';
import MobileHeader from '../components/layout/MobileHeader';
import PageLayout from '../components/layout/PageLayout';
import ListPageTop from '../components/ui/ListPageTop';
import PageToolbarInline from '../components/ui/PageToolbarInline';
import ListCard from '../components/ui/ListCard';
import RecordList from '../components/ui/RecordList';
import FilterChip from '../components/ui/FilterChip';
import LoadingScreen from '../components/ui/LoadingScreen';
import EmptyState from '../components/ui/EmptyState';
import AuditDataTable from '../components/wide/AuditDataTable';
import { useWideLayout } from '../hooks/useWideLayout';
import { IconAudit } from '../components/ui/Icons';

const ACTION_FILTERS = [
  'login', 'create', 'update', 'delete', 'start', 'stop',
  'reload-ip', 'restart', 'test', 'reveal-password',
  'export', 'import', 'change-password', 'mikrotik-test',
] as const;

const PAGE_SIZES = [20, 30, 50, 100, 200] as const;

function actionColor(action: string): 'default' | 'success' | 'danger' | 'accent' | 'warning' {
  if (action.includes('delete')) return 'danger';
  if (action.includes('create')) return 'success';
  if (action.includes('login') || action.includes('logout')) return 'accent';
  if (action.includes('error') || action.includes('fail')) return 'warning';
  return 'default';
}

export default function AuditPage() {
  const [data, setData] = useState<AuditResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState<string>('all');
  const [pageSize, setPageSize] = useState<number>(50);
  const [offset, setOffset] = useState(0);

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(pageSize), offset: String(offset) });
      if (actionFilter !== 'all') params.set('action', actionFilter);
      if (search.trim()) params.set('username', search.trim());
      setData(await api.get<AuditResponse>(`/api/audit?${params}`));
    } finally {
      setLoading(false);
    }
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
    return {
      users: new Set(items.map((i) => i.username)).size,
      creates: items.filter((i) => i.action.includes('create')).length,
      deletes: items.filter((i) => i.action.includes('delete')).length,
    };
  }, [data?.items]);

  const wide = useWideLayout();
  const total = data?.total ?? 0;
  const canPrev = offset > 0;
  const canNext = offset + pageSize < total;
  const pageNum = Math.floor(offset / pageSize) + 1;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div>
      <MobileHeader title="Audit Log" subtitle={`${total} bản ghi`} icon={<IconAudit />} onRefresh={load} refreshing={loading} />
      <PageLayout>
        <ListPageTop
          eyebrow="Audit Log"
          heroValue={total}
          summary={`Trang ${pageNum}/${pageCount} · ${data?.items.length ?? 0} mục hiện tại`}
          metrics={[
            { label: 'Trang', value: pageNum, hint: `${pageSize}/trang`, accent: true, icon: <IconAudit /> },
            { label: 'Users', value: actionStats.users, hint: 'trang này' },
            { label: 'Create', value: actionStats.creates },
            { label: 'Delete', value: actionStats.deletes },
          ]}
          toolbar={(
            <PageToolbarInline
              search={{ value: search, onChange: setSearch, placeholder: 'Tìm theo username…' }}
            >
              <div className="filter-scroll">
                <FilterChip label="Tất cả" active={actionFilter === 'all'} onSelect={() => { setOffset(0); setActionFilter('all'); }} />
                {ACTION_FILTERS.map((a) => (
                  <FilterChip
                    key={a}
                    label={a}
                    active={actionFilter === a}
                    onSelect={() => { setOffset(0); setActionFilter(a); }}
                  />
                ))}
              </div>
              <Select selectedKey={String(pageSize)} onSelectionChange={(k) => { setOffset(0); setPageSize(Number(k)); }}>
                <Label className="sr-only">Page size</Label>
                <Select.Trigger><Select.Value /></Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    {PAGE_SIZES.map((s) => (
                      <ListBox.Item key={String(s)} id={String(s)} textValue={`${s}/trang`}>
                        {s}/trang<ListBox.ItemIndicator />
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>
            </PageToolbarInline>
          )}
        />

        {loading && !data ? <LoadingScreen /> : null}
        {!loading && (data?.items.length ?? 0) === 0 ? (
          <EmptyState title="Không có audit log" />
        ) : wide ? (
          <AuditDataTable rows={data?.items ?? []} />
        ) : (
          <RecordList>
            {(data?.items ?? []).map((item) => (
              <ListCard key={item.id}>
                <ListCard.Body>
                  <ListCard.Row>
                    <ListCard.Main>
                      <ListCard.Title>{item.username}</ListCard.Title>
                      <ListCard.Subtitle>
                        {item.resource
                          ? `${item.resource}${item.resourceId != null ? ` #${item.resourceId}` : ''}`
                          : formatDateTime(item.createdAt)}
                      </ListCard.Subtitle>
                      <ListCard.Meta>
                        {item.ip ? <span className="mobile-mono">{item.ip}</span> : null}
                        {item.details ? <span className="max-w-full truncate">{item.details}</span> : null}
                        {item.resource ? <span>{formatDateTime(item.createdAt)}</span> : null}
                      </ListCard.Meta>
                    </ListCard.Main>
                    <ListCard.Aside>
                      <Chip size="sm" color={actionColor(item.action)}>{item.action}</Chip>
                    </ListCard.Aside>
                  </ListCard.Row>
                </ListCard.Body>
              </ListCard>
            ))}
          </RecordList>
        )}

        <div className="flex gap-2">
          <Button className="flex-1" variant="outline" isDisabled={!canPrev} onPress={() => setOffset((o) => Math.max(0, o - pageSize))}>
            Trước
          </Button>
          <Button className="flex-1" variant="outline" isDisabled={!canNext} onPress={() => setOffset((o) => o + pageSize)}>
            Sau
          </Button>
        </div>
      </PageLayout>
    </div>
  );
}