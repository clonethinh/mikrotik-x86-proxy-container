import { useEffect, useMemo, useState } from 'react';
import {
  Button, Chip, Drawer, Input, Label, ListBox, Modal, Select, Switch, TextField, toast,
} from '@heroui/react';
import { api, DeviceRoute, DhcpLease, WanInfo } from '../services/api';
import { useWSEvent } from '../services/ws';
import MobileHeader from '../components/layout/MobileHeader';
import PageLayout from '../components/layout/PageLayout';
import ListPageTop from '../components/ui/ListPageTop';
import PageToolbarInline from '../components/ui/PageToolbarInline';
import ListCard from '../components/ui/ListCard';
import RecordList from '../components/ui/RecordList';
import LoadingScreen from '../components/ui/LoadingScreen';
import EmptyState from '../components/ui/EmptyState';
import ConfirmModal from '../components/ui/ConfirmModal';
import PaginationBar from '../components/ui/PaginationBar';
import DevicesDataTable from '../components/wide/DevicesDataTable';
import { useWideLayout } from '../hooks/useWideLayout';
import { useListPagination } from '../hooks/useListPagination';
import { IconDevices } from '../components/ui/Icons';

type FormState = {
  name: string;
  matchType: 'ip' | 'mac' | 'dhcp';
  ipAddress: string;
  macAddress: string;
  dhcpHostName: string;
  pppoeIdx: number;
  enabled: boolean;
  note: string;
};

const emptyForm = (): FormState => ({
  name: '',
  matchType: 'dhcp',
  ipAddress: '',
  macAddress: '',
  dhcpHostName: '',
  pppoeIdx: 2,
  enabled: true,
  note: '',
});

export default function DevicesPage() {
  const [devices, setDevices] = useState<DeviceRoute[]>([]);
  const [leases, setLeases] = useState<DhcpLease[]>([]);
  const [wans, setWans] = useState<WanInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [leaseDrawer, setLeaseDrawer] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const wide = useWideLayout();

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
  useWSEvent((msg) => msg.type?.startsWith('device.'), () => load());

  const stats = useMemo(() => ({
    total: devices.length,
    enabled: devices.filter((d) => d.enabled).length,
    applied: devices.filter((d) => d.applied && d.enabled).length,
    pending: devices.filter((d) => d.enabled && !d.applied).length,
  }), [devices]);

  const filtered = useMemo(() => {
    if (!search.trim()) return devices;
    const q = search.toLowerCase();
    return devices.filter((d) =>
      d.name.toLowerCase().includes(q)
      || (d.ipAddress || '').includes(q)
      || (d.macAddress || '').toLowerCase().includes(q)
      || d.pppoeName.toLowerCase().includes(q),
    );
  }, [devices, search]);

  const {
    slice: pageRows, page, setPage, pageSize, setPageSize, total: pageTotal, pageCount,
  } = useListPagination(filtered, wide ? 20 : filtered.length, search);

  const openCreate = () => {
    setEditId(null);
    setForm({ ...emptyForm(), pppoeIdx: wans.find((w) => w.running)?.index || 2 });
    setModalOpen(true);
  };

  const openEdit = (row: DeviceRoute) => {
    setEditId(row.id);
    setForm({
      name: row.name,
      matchType: row.matchType,
      ipAddress: row.ipAddress || '',
      macAddress: row.macAddress || '',
      dhcpHostName: row.dhcpHostName || '',
      pppoeIdx: row.pppoeIdx,
      enabled: row.enabled,
      note: row.note || '',
    });
    setModalOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) { toast.warning('Nhập tên'); return; }
    const body = {
      name: form.name.trim(),
      matchType: form.matchType,
      ipAddress: form.matchType === 'ip' ? form.ipAddress.trim() || null : null,
      macAddress: form.matchType === 'mac' ? form.macAddress.trim() || null : null,
      dhcpHostName: form.matchType === 'dhcp' ? form.dhcpHostName.trim() || null : null,
      pppoeIdx: form.pppoeIdx,
      enabled: form.enabled,
      note: form.note.trim() || null,
    };
    try {
      if (editId) await api.patch(`/api/devices/${editId}`, body);
      else await api.post('/api/devices', body);
      toast.success(editId ? 'Đã cập nhật' : 'Đã tạo route');
      setModalOpen(false);
      load();
    } catch (e) {
      toast.danger(e instanceof Error ? e.message : 'Lỗi');
    }
  };

  const remove = async (id: number) => {
    try {
      await api.del(`/api/devices/${id}`);
      toast.success('Đã xoá');
      load();
    } catch (e) {
      toast.danger(e instanceof Error ? e.message : 'Lỗi');
    }
  };

  const toggleEnabled = async (row: DeviceRoute, enabled: boolean) => {
    try {
      await api.patch(`/api/devices/${row.id}`, { enabled });
      toast.success(enabled ? 'Đã bật' : 'Đã tắt');
      load();
    } catch (e) {
      toast.danger(e instanceof Error ? e.message : 'Lỗi');
    }
  };

  const reapply = async (id: number) => {
    try {
      await api.post(`/api/devices/${id}/apply`);
      toast.success('Đã apply lên router');
      load();
    } catch (e) {
      toast.danger(e instanceof Error ? e.message : 'Lỗi');
    }
  };

  const applyFromLease = (lease: DhcpLease) => {
    setEditId(null);
    setForm({
      name: lease.hostName || lease.address,
      matchType: 'dhcp',
      ipAddress: lease.address,
      macAddress: lease.macAddress,
      dhcpHostName: lease.hostName,
      pppoeIdx: wans.find((w) => w.running)?.index || 2,
      enabled: true,
      note: '',
    });
    setLeaseDrawer(false);
    setModalOpen(true);
  };

  if (loading) return <LoadingScreen />;

  return (
    <div>
      <MobileHeader title="Thiết bị LAN" subtitle={`${stats.applied}/${stats.total} applied`} icon={<IconDevices />} onRefresh={load} />
      <PageLayout>
        <ListPageTop
          eyebrow="Device Routes"
          heroValue={stats.total > 0 ? Math.round((stats.applied / stats.total) * 100) : 0}
          heroSuffix="%"
          summary={`${stats.enabled}/${stats.total} enabled · ${stats.applied} applied · ${stats.pending} pending`}
          metrics={[
            { label: 'Routes', value: stats.total, accent: true, icon: <IconDevices /> },
            { label: 'On', value: stats.enabled },
            { label: 'Applied', value: stats.applied },
            { label: 'Pending', value: stats.pending },
          ]}
          gauges={[
            { label: 'Enabled', value: stats.total > 0 ? Math.round((stats.enabled / stats.total) * 100) : 0, color: 'success' },
            { label: 'Applied', value: stats.total > 0 ? Math.round((stats.applied / stats.total) * 100) : 0, color: 'accent' },
            { label: 'Pending', value: stats.total > 0 ? Math.round((stats.pending / stats.total) * 100) : 0, color: stats.pending > 0 ? 'warning' : 'success' },
          ]}
          toolbar={(
            <PageToolbarInline
              search={{ value: search, onChange: setSearch, placeholder: 'Tìm tên, IP, MAC…' }}
            >
              <div className="mobile-fab-row">
                <Button className="flex-1" onPress={openCreate}>Thêm route</Button>
                <Button className="flex-1" variant="secondary" onPress={() => setLeaseDrawer(true)}>
                  DHCP ({leases.length})
                </Button>
              </div>
            </PageToolbarInline>
          )}
        />
        {filtered.length === 0 ? (
          <EmptyState title="Chưa có device route" description="Thêm route để gán thiết bị LAN ra WAN" />
        ) : wide ? (
          <>
            <DevicesDataTable
              rows={pageRows}
              onToggle={toggleEnabled}
              onApply={reapply}
              onEdit={openEdit}
              onDelete={setDeleteId}
            />
            <PaginationBar
              page={page}
              pageCount={pageCount}
              pageSize={pageSize}
              total={pageTotal}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
            />
          </>
        ) : (
          <RecordList>
            {filtered.map((d) => (
              <ListCard key={d.id}>
                <ListCard.Body>
                  <ListCard.Row>
                    <ListCard.Main>
                      <ListCard.Title>{d.name}</ListCard.Title>
                      <ListCard.Subtitle>{d.matchType.toUpperCase()} → {d.pppoeName}</ListCard.Subtitle>
                      <ListCard.Meta>
                        {d.ipAddress ? <span>{d.ipAddress}</span> : null}
                        {d.macAddress ? <span className="mobile-mono">{d.macAddress}</span> : null}
                        {d.dhcpHostName ? <span>{d.dhcpHostName}</span> : null}
                      </ListCard.Meta>
                    </ListCard.Main>
                    <ListCard.Aside>
                      <Chip size="sm" color={d.enabled ? 'success' : 'default'}>{d.enabled ? 'On' : 'Off'}</Chip>
                      <Chip size="sm" color={d.applied ? 'accent' : 'warning'}>{d.applied ? 'OK' : 'Pending'}</Chip>
                    </ListCard.Aside>
                  </ListCard.Row>
                  <ListCard.Actions>
                    <Switch
                      isSelected={d.enabled}
                      onChange={(v) => toggleEnabled(d, v)}
                    >
                      <Switch.Content>
                        <Switch.Control><Switch.Thumb /></Switch.Control>
                        <span className="text-xs">{d.enabled ? 'On' : 'Off'}</span>
                      </Switch.Content>
                    </Switch>
                    {d.enabled && !d.applied ? (
                      <Button size="sm" variant="outline" onPress={() => reapply(d.id)}>Apply</Button>
                    ) : null}
                    <Button size="sm" variant="secondary" onPress={() => openEdit(d)}>Sửa</Button>
                    <Button size="sm" variant="danger" onPress={() => remove(d.id)}>Xoá</Button>
                  </ListCard.Actions>
                </ListCard.Body>
              </ListCard>
            ))}
          </RecordList>
        )}
      </PageLayout>

      <Drawer isOpen={leaseDrawer} onOpenChange={setLeaseDrawer}>
        <Drawer.Backdrop>
          <Drawer.Content placement="bottom">
            <Drawer.Dialog className="max-h-[85vh]">
              <Drawer.Header><Drawer.Heading>DHCP Leases</Drawer.Heading></Drawer.Header>
              <Drawer.Body className="overflow-y-auto">
                <RecordList>
                  {leases.map((l) => (
                    <ListCard key={l.id}>
                      <ListCard.Body>
                        <ListCard.Row>
                          <ListCard.Main>
                            <ListCard.Title>{l.hostName || l.address}</ListCard.Title>
                            <ListCard.Subtitle>{l.address}</ListCard.Subtitle>
                            <ListCard.Meta><span className="mobile-mono">{l.macAddress}</span></ListCard.Meta>
                          </ListCard.Main>
                          <ListCard.Aside>
                            <Button size="sm" variant="outline" onPress={() => applyFromLease(l)}>Route</Button>
                          </ListCard.Aside>
                        </ListCard.Row>
                      </ListCard.Body>
                    </ListCard>
                  ))}
                </RecordList>
              </Drawer.Body>
            </Drawer.Dialog>
          </Drawer.Content>
        </Drawer.Backdrop>
      </Drawer>

      <Modal isOpen={modalOpen} onOpenChange={setModalOpen}>
        <Modal.Backdrop>
          <Modal.Container>
            <Modal.Dialog className="sm:max-w-md">
              <Modal.CloseTrigger />
              <Modal.Header><Modal.Heading>{editId ? 'Sửa route' : 'Thêm route'}</Modal.Heading></Modal.Header>
              <Modal.Body className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto">
                <TextField value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: String(v) }))}>
                  <Label>Tên</Label>
                  <Input />
                </TextField>
                <Select selectedKey={form.matchType} onSelectionChange={(k) => setForm((f) => ({ ...f, matchType: k as FormState['matchType'] }))}>
                  <Label>Match type</Label>
                  <Select.Trigger><Select.Value /></Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      {(['ip', 'mac', 'dhcp'] as const).map((t) => (
                        <ListBox.Item key={t} id={t} textValue={t}>{t}<ListBox.ItemIndicator /></ListBox.Item>
                      ))}
                    </ListBox>
                  </Select.Popover>
                </Select>
                {form.matchType === 'ip' ? (
                  <TextField value={form.ipAddress} onChange={(v) => setForm((f) => ({ ...f, ipAddress: String(v) }))}>
                    <Label>IP</Label><Input />
                  </TextField>
                ) : null}
                {form.matchType === 'mac' ? (
                  <TextField value={form.macAddress} onChange={(v) => setForm((f) => ({ ...f, macAddress: String(v) }))}>
                    <Label>MAC</Label><Input />
                  </TextField>
                ) : null}
                {form.matchType === 'dhcp' ? (
                  <TextField value={form.dhcpHostName} onChange={(v) => setForm((f) => ({ ...f, dhcpHostName: String(v) }))}>
                    <Label>DHCP hostname</Label><Input />
                  </TextField>
                ) : null}
                <Select
                  selectedKey={String(form.pppoeIdx)}
                  onSelectionChange={(k) => setForm((f) => ({ ...f, pppoeIdx: Number(k) }))}
                >
                  <Label>WAN đích</Label>
                  <Select.Trigger><Select.Value /></Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      {wans.map((w) => (
                        <ListBox.Item key={String(w.index)} id={String(w.index)} textValue={w.name}>
                          {w.name} ({w.publicIp || 'no IP'})
                          <ListBox.ItemIndicator />
                        </ListBox.Item>
                      ))}
                    </ListBox>
                  </Select.Popover>
                </Select>
                <Switch isSelected={form.enabled} onChange={(v) => setForm((f) => ({ ...f, enabled: v }))}>
                  <Switch.Content><Switch.Control><Switch.Thumb /></Switch.Control>Enabled</Switch.Content>
                </Switch>
                <TextField value={form.note} onChange={(v) => setForm((f) => ({ ...f, note: String(v) }))}>
                  <Label>Ghi chú</Label><Input />
                </TextField>
              </Modal.Body>
              <Modal.Footer>
                <Button variant="tertiary" onPress={() => setModalOpen(false)}>Huỷ</Button>
                <Button onPress={save}>Lưu</Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>

      <ConfirmModal
        open={deleteId != null}
        onOpenChange={(open) => !open && setDeleteId(null)}
        title="Xoá device route?"
        message="Route sẽ bị xoá khỏi DB và router. Thao tác không hoàn tác."
        confirmLabel="Xoá"
        onConfirm={() => { if (deleteId != null) remove(deleteId); }}
      />
    </div>
  );
}