import { useEffect, useState } from 'react';
import {
  Button, Chip, Input, Label, ListBox, NumberField, Select, TextField, toast,
} from '@heroui/react';
import {
  api, AutoProxySettings, ClockSyncResult, MikrotikTestResult, RouterScriptActionResult, RouterScriptStatus,
} from '../services/api';
import { useAuth } from '../services/auth';
import { formatDateTime } from '../lib/format';
import MobileHeader from '../components/layout/MobileHeader';
import PageLayout from '../components/layout/PageLayout';
import CollapsibleSection from '../components/ui/CollapsibleSection';
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
  const [loading, setLoading] = useState(true);

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
    if (user?.role === 'admin') loadRouterScripts();
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
            title="Router Scripts"
            subtitle={`${routerScripts.filter((s) => s.installed).length}/${routerScripts.length} đã cài`}
            defaultOpen={false}
            action={
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" isPending={scriptsLoading} onPress={loadRouterScripts}>↻</Button>
                <Button size="sm" isPending={ensuringScripts} onPress={ensureRouterScripts}>Cài</Button>
              </div>
            }
          >
            <RecordList>
              {routerScripts.map((s) => (
                <ListCard key={s.name}>
                  <ListCard.Body>
                    <ListCard.Row>
                      <ListCard.Main>
                        <ListCard.Title>{s.label}</ListCard.Title>
                        <ListCard.Subtitle>{s.description}</ListCard.Subtitle>
                        <ListCard.Meta>
                          <span>Run {s.runCount}</span>
                          <span>Last {s.lastStarted || '—'}</span>
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
                <p className="font-medium">{routerScriptLastResult.summary}</p>
                <p className="mt-1 text-xs text-muted">
                  {new Date(routerScriptLastResult.at).toLocaleString('vi-VN')} · {routerScriptLastResult.durationMs}ms
                </p>
                {routerScriptLastResult.ipChanges.length > 0 ? (
                  <div className="mt-2 space-y-1 font-mono text-xs">
                    {routerScriptLastResult.ipChanges.slice(0, 5).map((c) => (
                      <div key={c.pppoeName}>{c.pppoeName}: {c.before || '—'} → {c.after || '—'}</div>
                    ))}
                  </div>
                ) : null}
                {(routerScriptLastResult.outputLines.length > 0 || routerScriptLastResult.logLines.length > 0) ? (
                  <pre className="proxy-logs-pre mt-2 max-h-32 text-[10px]">
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