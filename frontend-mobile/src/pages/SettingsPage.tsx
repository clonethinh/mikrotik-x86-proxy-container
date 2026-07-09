import { useEffect, useState } from 'react';
import {
  Button, Chip, Input, Label, ListBox, NumberField, Select, TextField, toast,
} from '@heroui/react';
import {
  api, AutoProxySettings, ClockSyncResult, FirewallReconcileResult, FirewallReconcileStatus,
  MikrotikTestResult, RouterScriptActionResult, RouterScriptStatus,
} from '../services/api';
import { useAuth } from '../services/auth';
import { formatDateTime } from '../lib/format';
import MobileHeader from '../components/layout/MobileHeader';
import PageLayout from '../components/layout/PageLayout';
import CollapsibleSection from '../components/ui/CollapsibleSection';
import DismissibleAlert from '../components/ui/DismissibleAlert';
import ListCard from '../components/ui/ListCard';
import RecordList from '../components/ui/RecordList';
import KvList from '../components/ui/KvList';
import LoadingScreen from '../components/ui/LoadingScreen';
import { IconSettings } from '../components/ui/Icons';

interface DeployInfo {
  target: string;
  mikrotik: { host: string; wanHost?: string | null; managementUrl?: string | null };
  threeProxy: { image: string; tarball: string };
  network: {
    bridgeName?: string;
    vethIpFormula?: string;
    vethNetworkBase?: string;
    maxPppoeIdx?: number;
    portFormula?: string;
    extHttpPortBase?: number;
    extSocksPortBase?: number;
  };
}

export default function SettingsPage() {
  const { user } = useAuth();
  const [info, setInfo] = useState<DeployInfo | null>(null);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [test, setTest] = useState<MikrotikTestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [autoProxy, setAutoProxy] = useState<AutoProxySettings | null>(null);
  const [savingAuto, setSavingAuto] = useState(false);
  const [routerScripts, setRouterScripts] = useState<RouterScriptStatus[]>([]);
  const [scriptsLoading, setScriptsLoading] = useState(false);
  const [ensuringScripts, setEnsuringScripts] = useState(false);
  const [runningScript, setRunningScript] = useState<string | null>(null);
  const [routerScriptLastResult, setRouterScriptLastResult] = useState<RouterScriptActionResult | null>(null);
  const [fwReconcile, setFwReconcile] = useState<FirewallReconcileStatus | null>(null);
  const [fwLoading, setFwLoading] = useState(false);
  const [fwRunning, setFwRunning] = useState(false);
  const [fwLastResult, setFwLastResult] = useState<FirewallReconcileResult | null>(null);
  const [loading, setLoading] = useState(true);

  const loadFirewallReconcile = async () => {
    setFwLoading(true);
    try {
      const r = await api.get<FirewallReconcileStatus>('/api/system/firewall/reconcile');
      setFwReconcile(r);
      if (r.lastResult) setFwLastResult(r.lastResult);
    } catch { /* ignore */ }
    finally { setFwLoading(false); }
  };

  const runFirewallReconcile = async (opts: { dryRun?: boolean; repairAll?: boolean }) => {
    setFwRunning(true);
    try {
      const r = await api.post<{ ok: boolean } & FirewallReconcileResult>('/api/system/firewall/reconcile', {
        dryRun: opts.dryRun === true,
        repair: opts.dryRun !== true,
        repairAll: opts.repairAll === true,
      });
      setFwLastResult(r);
      await loadFirewallReconcile();
      const { audit, removed, repaired } = r;
      if (opts.dryRun) {
        toast.info(`Audit: ${audit.orphans.length} orphan · ${audit.missing.length} thiếu · ${audit.duplicates.length} trùng`);
      } else {
        toast.success(
          `Xong: xóa ${removed.nat + removed.filter + removed.mangle} rule · repair ${repaired.ok}/${repaired.attempted} slot`,
        );
      }
    } catch (e) {
      toast.danger(e instanceof Error ? e.message : 'Lỗi');
    } finally {
      setFwRunning(false);
    }
  };

  const loadRouterScripts = async () => {
    setScriptsLoading(true);
    try {
      const r = await api.get<{ scripts: RouterScriptStatus[] }>('/api/system/router-scripts');
      setRouterScripts(r.scripts || []);
    } catch { /* ignore */ }
    finally { setScriptsLoading(false); }
  };

  useEffect(() => {
    Promise.all([
      api.get<DeployInfo>('/api/deploy-info').catch(() => null),
      api.get<AutoProxySettings>('/api/settings/auto-proxy').catch(() => null),
    ]).then(([deploy, auto]) => {
      setInfo(deploy);
      setAutoProxy(auto);
      setLoading(false);
    });
    if (user?.role === 'admin') {
      loadRouterScripts();
      loadFirewallReconcile();
    }
  }, [user?.role]);

  const changePassword = async () => {
    if (!oldPassword || !newPassword || newPassword.length < 6) {
      toast.warning('Mật khẩu mới ≥ 6 ký tự');
      return;
    }
    try {
      await api.post('/api/auth/change-password', { oldPassword, newPassword });
      toast.success('Đã đổi mật khẩu');
      setOldPassword('');
      setNewPassword('');
    } catch (e) {
      toast.danger(e instanceof Error ? e.message : 'Lỗi');
    }
  };

  const testConn = async () => {
    setTesting(true);
    setTest(null);
    try {
      const r = await api.post<MikrotikTestResult>('/api/mikrotik/test');
      setTest(r);
      if (r.rest && r.ssh) toast.success('Mikrotik OK');
      else toast.warning('Có lỗi kết nối');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Lỗi';
      toast.danger(msg);
      setTest({ rest: false, ssh: false, restError: msg, sshError: msg });
    } finally {
      setTesting(false);
    }
  };

  const syncTime = async () => {
    setSyncing(true);
    try {
      const r = await api.post<ClockSyncResult>('/api/mikrotik/sync-time');
      if (r.skipped) toast.info(`Đồng hồ đã sync gần đây (${formatDateTime(r.syncedAt)})`);
      else toast.success(`Đã sync time · ${r.containers?.length ?? 0} container`);
    } catch (e) {
      toast.danger(e instanceof Error ? e.message : 'Lỗi');
    } finally {
      setSyncing(false);
    }
  };

  const saveAutoProxy = async () => {
    if (!autoProxy) return;
    setSavingAuto(true);
    try {
      const r = await api.patch<AutoProxySettings>('/api/settings/auto-proxy', autoProxy);
      setAutoProxy(r);
      toast.success('Đã lưu auto-proxy');
    } catch (e) {
      toast.danger(e instanceof Error ? e.message : 'Lỗi');
    } finally {
      setSavingAuto(false);
    }
  };

  const ensureRouterScripts = async () => {
    setEnsuringScripts(true);
    try {
      const r = await api.post<RouterScriptActionResult>('/api/system/router-scripts/ensure');
      setRouterScripts(r.scripts || []);
      setRouterScriptLastResult(r);
      toast.success(r.summary || 'Đã cài script trên router');
    } catch (e) {
      toast.danger(e instanceof Error ? e.message : 'Lỗi');
    } finally {
      setEnsuringScripts(false);
    }
  };

  const runRouterScript = async (name: string) => {
    setRunningScript(name);
    try {
      const r = await api.post<RouterScriptActionResult>(`/api/system/router-scripts/${name}/run`);
      setRouterScripts(r.scripts || []);
      setRouterScriptLastResult(r);
      toast.success(r.summary || `Đã chạy ${name}`);
    } catch (e) {
      toast.danger(e instanceof Error ? e.message : 'Lỗi');
    } finally {
      setRunningScript(null);
    }
  };

  if (loading) return <LoadingScreen />;

  return (
    <div>
      <MobileHeader title="Cài đặt" subtitle={user?.username} icon={<IconSettings />} />
      <PageLayout>
        <CollapsibleSection title="Tài khoản" subtitle="Đổi mật khẩu đăng nhập" defaultOpen>
          <KvList
            compact
            grid
            items={[
              { label: 'Username', value: user?.username || '—' },
              { label: 'Role', value: <Chip size="sm">{user?.role}</Chip> },
            ]}
          />
          <div className="mt-3 flex flex-col gap-2.5">
            <TextField type="password" value={oldPassword} onChange={(v) => setOldPassword(String(v))}>
              <Label>Mật khẩu cũ</Label><Input />
            </TextField>
            <TextField type="password" value={newPassword} onChange={(v) => setNewPassword(String(v))}>
              <Label>Mật khẩu mới</Label><Input />
            </TextField>
            <Button onPress={changePassword}>Đổi mật khẩu</Button>
          </div>
        </CollapsibleSection>

        <CollapsibleSection
          title="MikroTik"
          subtitle="Test kết nối và đồng bộ thời gian"
          defaultOpen
          badge={test ? (
            <Chip size="sm" color={test.rest && test.ssh ? 'success' : 'warning'}>
              {test.rest && test.ssh ? 'OK' : 'Lỗi'}
            </Chip>
          ) : undefined}
        >
          <div className="mobile-fab-row">
            <Button className="flex-1" isPending={testing} onPress={testConn}>Test REST/SSH</Button>
            <Button className="flex-1" variant="secondary" isPending={syncing} onPress={syncTime}>Sync time</Button>
          </div>
          {test ? (
            <div className="mt-2">
              <KvList
                compact
                grid
                items={[
                  { label: 'REST', value: test.rest ? <Chip size="sm" color="success">{test.restLatencyMs}ms</Chip> : <Chip size="sm" color="danger">{test.restError}</Chip> },
                  { label: 'SSH', value: test.ssh ? <Chip size="sm" color="success">{test.sshLatencyMs}ms</Chip> : <Chip size="sm" color="danger">{test.sshError}</Chip> },
                ]}
              />
            </div>
          ) : null}
        </CollapsibleSection>

        {autoProxy ? (
          <CollapsibleSection title="Auto-proxy" subtitle={autoProxy.mode} defaultOpen={false}>
            <div className="flex flex-col gap-2.5">
              <Select
                selectedKey={autoProxy.mode}
                onSelectionChange={(k) => setAutoProxy((a) => a ? { ...a, mode: k as AutoProxySettings['mode'] } : a)}
              >
                <Label>Chế độ</Label>
                <Select.Trigger><Select.Value /></Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    <ListBox.Item id="semi" textValue="semi">Semi — đếm ngược<ListBox.ItemIndicator /></ListBox.Item>
                    <ListBox.Item id="full" textValue="full">Full — tự động ngay<ListBox.ItemIndicator /></ListBox.Item>
                    <ListBox.Item id="off" textValue="off">Off — chỉ discovery<ListBox.ItemIndicator /></ListBox.Item>
                  </ListBox>
                </Select.Popover>
              </Select>
              <NumberField value={autoProxy.maxConcurrent} onChange={(v) => setAutoProxy((a) => a ? { ...a, maxConcurrent: Number(v) } : a)} minValue={1} maxValue={50}>
                <Label>Max concurrent</Label>
                <NumberField.Group><NumberField.Input /></NumberField.Group>
              </NumberField>
              <NumberField value={autoProxy.pollIntervalMs} onChange={(v) => setAutoProxy((a) => a ? { ...a, pollIntervalMs: Number(v) } : a)} minValue={5000} step={1000}>
                <Label>Poll interval (ms)</Label>
                <NumberField.Group><NumberField.Input /></NumberField.Group>
              </NumberField>
              <NumberField value={autoProxy.countdownMs} onChange={(v) => setAutoProxy((a) => a ? { ...a, countdownMs: Number(v) } : a)} minValue={0} step={1000}>
                <Label>Countdown (ms)</Label>
                <NumberField.Group><NumberField.Input /></NumberField.Group>
              </NumberField>
              <NumberField value={autoProxy.ipWaitTimeoutMs} onChange={(v) => setAutoProxy((a) => a ? { ...a, ipWaitTimeoutMs: Number(v) } : a)} minValue={1000} step={1000}>
                <Label>IP wait timeout (ms)</Label>
                <NumberField.Group><NumberField.Input /></NumberField.Group>
              </NumberField>
              <NumberField value={autoProxy.warnConcurrent} onChange={(v) => setAutoProxy((a) => a ? { ...a, warnConcurrent: Number(v) } : a)} minValue={1}>
                <Label>Warn concurrent</Label>
                <NumberField.Group><NumberField.Input /></NumberField.Group>
              </NumberField>
              <NumberField value={autoProxy.staleTtlMs} onChange={(v) => setAutoProxy((a) => a ? { ...a, staleTtlMs: Number(v) } : a)} minValue={60000} step={60000}>
                <Label>Stale TTL (ms)</Label>
                <NumberField.Group><NumberField.Input /></NumberField.Group>
              </NumberField>
              <NumberField value={autoProxy.goneDebouncePolls} onChange={(v) => setAutoProxy((a) => a ? { ...a, goneDebouncePolls: Number(v) } : a)} minValue={1}>
                <Label>Gone debounce polls</Label>
                <NumberField.Group><NumberField.Input /></NumberField.Group>
              </NumberField>
              <Button isPending={savingAuto} onPress={saveAutoProxy}>Lưu auto-proxy</Button>
            </div>
          </CollapsibleSection>
        ) : null}

        {user?.role === 'admin' ? (
          <CollapsibleSection
            title="Phục hồi Firewall"
            subtitle={fwReconcile?.enabled ? `Tự động · ${Math.round((fwReconcile.intervalMs || 0) / 60000)} phút` : 'Audit & repair hub firewall'}
            defaultOpen={false}
            action={
              <Button size="sm" variant="ghost" isPending={fwLoading} onPress={loadFirewallReconcile}>↻</Button>
            }
          >
            <DismissibleAlert bannerId="settings-firewall-reconcile-info" title="Reconcile hub firewall">
              Kiểm tra rule trùng/mồ côi (slot không còn trong DB), dọn hub-wan IP cũ, repair từng batch slot — tránh spike CPU trên router.
            </DismissibleAlert>
            <div className="mt-3 flex flex-col gap-2">
              <Button variant="secondary" isPending={fwRunning} onPress={() => runFirewallReconcile({ dryRun: true })}>
                Kiểm tra (dry-run)
              </Button>
              <Button isPending={fwRunning} onPress={() => runFirewallReconcile({})}>
                Phục hồi batch
              </Button>
              <Button variant="danger" isPending={fwRunning} onPress={() => runFirewallReconcile({ repairAll: true })}>
                Repair toàn bộ
              </Button>
            </div>
            {fwReconcile ? (
              <div className="mt-3">
              <KvList
                compact
                grid
                items={[
                  { label: 'Tự động', value: <Chip size="sm" color={fwReconcile.enabled ? 'success' : 'default'}>{fwReconcile.enabled ? 'Bật' : 'Tắt'}</Chip> },
                  { label: 'Chu kỳ', value: `${Math.round(fwReconcile.intervalMs / 60000)} phút` },
                  { label: 'Batch', value: `${fwReconcile.maxSlotsPerPass} slot` },
                ]}
              />
              </div>
            ) : null}
            {fwLastResult ? (
              <div className="mt-3">
              <KvList
                compact
                grid
                items={[
                  { label: 'Lần chạy cuối', value: `${formatDateTime(fwLastResult.at)} (${fwLastResult.durationMs}ms)` },
                  { label: 'Orphan / thiếu / trùng', value: `${fwLastResult.audit.orphans.length} / ${fwLastResult.audit.missing.length} / ${fwLastResult.audit.duplicates.length}` },
                  { label: 'Đã xóa', value: `NAT ${fwLastResult.removed.nat} · filter ${fwLastResult.removed.filter} · mangle ${fwLastResult.removed.mangle}` },
                  {
                    label: 'Repair',
                    value: `${fwLastResult.repaired.ok}/${fwLastResult.repaired.attempted} slot${fwLastResult.repaired.failed > 0 ? ` · ${fwLastResult.repaired.failed} lỗi` : ''}`,
                  },
                ]}
              />
              </div>
            ) : null}
          </CollapsibleSection>
        ) : null}

        {user?.role === 'admin' ? (
          <CollapsibleSection
            title="Router Scripts"
            subtitle={`${routerScripts.filter((s) => s.installed).length}/${routerScripts.length} đã cài · quayip · DuckDNS · protect`}
            defaultOpen={false}
            action={
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" isPending={scriptsLoading} onPress={loadRouterScripts}>↻</Button>
                <Button size="sm" isPending={ensuringScripts} onPress={ensureRouterScripts}>Cài</Button>
              </div>
            }
          >
            <DismissibleAlert bannerId="settings-router-scripts-info" title="Script hệ thống trên MikroTik">
              quayip: quay IP pool pppoe-out · duckdns: cập nhật DDNS từ pppoe-wan · protect: bảo vệ pppoe-wan
            </DismissibleAlert>
            <RecordList>
              {routerScripts.map((s) => (
                <ListCard key={s.name}>
                  <ListCard.Body>
                    <ListCard.Row>
                      <ListCard.Main>
                        <ListCard.Title>{s.label}</ListCard.Title>
                        <ListCard.Subtitle>{s.name} · {s.description}</ListCard.Subtitle>
                        <ListCard.Meta>
                          <span>Run {s.runCount}</span>
                          <span>Scheduler {s.scheduler?.interval || '—'}</span>
                          <span>Last {s.lastStarted ? formatDateTime(s.lastStarted) : '—'}</span>
                        </ListCard.Meta>
                      </ListCard.Main>
                      <ListCard.Aside>
                        <Chip size="sm" color={s.installed ? 'success' : 'danger'}>{s.installed ? 'OK' : 'Thiếu'}</Chip>
                      </ListCard.Aside>
                    </ListCard.Row>
                    <ListCard.Actions>
                      <Button
                        size="sm"
                        variant="outline"
                        isDisabled={!s.installed}
                        isPending={runningScript === s.name}
                        onPress={() => runRouterScript(s.name)}
                      >
                        Chạy
                      </Button>
                    </ListCard.Actions>
                  </ListCard.Body>
                </ListCard>
              ))}
            </RecordList>
            {routerScriptLastResult ? (
              <div className="mt-3 rounded-lg border border-border/60 bg-surface-secondary/40 p-3 text-sm">
                <KvList
                  compact
                  items={[
                    {
                      label: 'Hành động',
                      value: routerScriptLastResult.action === 'ensure'
                        ? 'Cài đặt script'
                        : `Chạy ${routerScriptLastResult.script || '—'}`,
                    },
                    { label: 'Tóm tắt', value: routerScriptLastResult.summary },
                    {
                      label: 'Thời gian',
                      value: `${formatDateTime(routerScriptLastResult.at)} · ${routerScriptLastResult.durationMs}ms`,
                    },
                  ]}
                />
                {routerScriptLastResult.installChanges.length > 0 ? (
                  <div className="mt-3">
                    <p className="mb-1 text-xs font-medium text-muted">Script thay đổi</p>
                    <div className="flex flex-wrap gap-1">
                      {routerScriptLastResult.installChanges.map((c) => (
                        <Chip key={c.name} size="sm" color={c.nowInstalled ? 'success' : 'default'}>
                          {c.label}: {c.wasInstalled ? 'có' : 'thiếu'} → {c.nowInstalled ? 'OK' : 'thiếu'}
                        </Chip>
                      ))}
                    </div>
                  </div>
                ) : null}
                {routerScriptLastResult.ipChanges.length > 0 ? (
                  <div className="mt-3">
                    <p className="mb-1 text-xs font-medium text-muted">IP đổi</p>
                    <div className="space-y-1 font-mono text-xs">
                      {routerScriptLastResult.ipChanges.slice(0, 8).map((c) => (
                        <div key={c.pppoeName}>{c.pppoeName}: {c.before || '—'} → {c.after || '—'}</div>
                      ))}
                    </div>
                    {routerScriptLastResult.ipChanges.length > 8 ? (
                      <p className="mt-1 text-xs text-muted">+{routerScriptLastResult.ipChanges.length - 8} WAN khác</p>
                    ) : null}
                  </div>
                ) : null}
                {(routerScriptLastResult.outputLines.length > 0 || routerScriptLastResult.logLines.length > 0) ? (
                  <pre className="proxy-logs-pre mt-3 max-h-44 text-[10px]">
                    {[...routerScriptLastResult.outputLines, ...routerScriptLastResult.logLines].join('\n')}
                  </pre>
                ) : null}
              </div>
            ) : null}
          </CollapsibleSection>
        ) : null}

        {info ? (
          <CollapsibleSection
            title="Deploy info"
            subtitle={info.mikrotik.host}
            defaultOpen={false}
            badge={<Chip size="sm" color={info.target === 'router' ? 'success' : 'warning'}>{info.target}</Chip>}
          >
            <KvList
              compact
              grid
              items={[
                { label: 'Host', value: info.mikrotik.host },
                { label: 'WAN host', value: info.mikrotik.wanHost || '—' },
                { label: 'Management', value: info.mikrotik.managementUrl || '—' },
                { label: '3proxy image', value: info.threeProxy.image },
                { label: '3proxy tarball', value: info.threeProxy.tarball },
                { label: 'Bridge', value: info.network.bridgeName || '—' },
                { label: 'Veth IP', value: info.network.vethIpFormula || '—' },
                { label: 'Veth network', value: info.network.vethNetworkBase || '—' },
                { label: 'Max PPPoE', value: info.network.maxPppoeIdx ?? '—' },
                { label: 'HTTP port', value: info.network.portFormula || `${info.network.extHttpPortBase}+N` },
                { label: 'SOCKS base', value: info.network.extSocksPortBase ?? '—' },
              ]}
            />
          </CollapsibleSection>
        ) : null}
      </PageLayout>
    </div>
  );
}