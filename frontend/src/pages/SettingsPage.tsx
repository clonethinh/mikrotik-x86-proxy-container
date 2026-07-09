import { useEffect, useState } from 'react';
import { Form, Input, Button, Typography, Descriptions, Tag, App, Divider, Space, Select, InputNumber, Table, Row, Col } from 'antd';
import DismissibleAlert from '../components/ui/DismissibleAlert';
import SettingsSectionCard from '../components/ui/SettingsSectionCard';
import ProxyPageShell from '../components/proxy/ProxyPageShell';
import {
  ApiOutlined, CheckCircleFilled, CloseCircleFilled, ClockCircleOutlined, SyncOutlined,
  PlayCircleOutlined, ReloadOutlined, UserOutlined, LockOutlined,
  ThunderboltOutlined, CodeOutlined, InfoCircleOutlined, SafetyCertificateOutlined,
} from '@ant-design/icons';
import {
  api, AutoProxySettings, ClockSyncResult, FirewallReconcileResult, FirewallReconcileStatus,
  MikrotikTestResult, RouterScriptStatus,
} from '../services/api';
import { useAuth } from '../services/auth';

const { Text } = Typography;

interface DeployInfo {
  target: string;
  mikrotik: { host: string; wanHost?: string | null; managementUrl?: string | null };
  threeProxy: { image: string; tarball: string };
  network: any;
}

export default function SettingsPage() {
  const { message } = App.useApp();
  const { user } = useAuth();
  const [info, setInfo] = useState<DeployInfo | null>(null);
  const [pwForm] = Form.useForm();
  const [test, setTest] = useState<MikrotikTestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [autoProxy, setAutoProxy] = useState<AutoProxySettings | null>(null);
  const [autoForm] = Form.useForm();
  const [savingAuto, setSavingAuto] = useState(false);
  const [routerScripts, setRouterScripts] = useState<RouterScriptStatus[]>([]);
  const [scriptsLoading, setScriptsLoading] = useState(false);
  const [ensuringScripts, setEnsuringScripts] = useState(false);
  const [runningScript, setRunningScript] = useState<string | null>(null);
  const [fwReconcile, setFwReconcile] = useState<FirewallReconcileStatus | null>(null);
  const [fwLoading, setFwLoading] = useState(false);
  const [fwRunning, setFwRunning] = useState(false);
  const [fwLastResult, setFwLastResult] = useState<FirewallReconcileResult | null>(null);

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
      message.loading({ content: opts.dryRun ? 'Đang kiểm tra firewall…' : 'Đang phục hồi firewall…', key: 'fw-reconcile', duration: 0 });
      const r = await api.post<{ ok: boolean } & FirewallReconcileResult>('/api/system/firewall/reconcile', {
        dryRun: opts.dryRun === true,
        repair: opts.dryRun !== true,
        repairAll: opts.repairAll === true,
      });
      setFwLastResult(r);
      await loadFirewallReconcile();
      message.destroy('fw-reconcile');
      const { audit, removed, repaired } = r;
      if (opts.dryRun) {
        message.info(`Audit: ${audit.orphans.length} orphan · ${audit.missing.length} thiếu · ${audit.duplicates.length} trùng`);
      } else {
        message.success(
          `Xong: xóa ${removed.nat + removed.filter + removed.mangle} rule · repair ${repaired.ok}/${repaired.attempted} slot`,
        );
      }
    } catch (e: any) {
      message.destroy('fw-reconcile');
      message.error(e.message);
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
    api.get<DeployInfo>('/api/deploy-info').then(setInfo).catch(() => {});
    api.get<AutoProxySettings>('/api/settings/auto-proxy').then(r => {
      setAutoProxy(r);
      autoForm.setFieldsValue(r);
    }).catch(() => {});
    if (user?.role === 'admin') {
      loadRouterScripts();
      loadFirewallReconcile();
    }
  }, [user?.role]);

  const ensureRouterScripts = async () => {
    setEnsuringScripts(true);
    try {
      const r = await api.post<{ ok: boolean; scripts: RouterScriptStatus[] }>('/api/system/router-scripts/ensure');
      setRouterScripts(r.scripts || []);
      message.success('Đã cài đặt/cập nhật script trên router');
    } catch (e: any) { message.error(e.message); }
    finally { setEnsuringScripts(false); }
  };

  const runRouterScript = async (name: string) => {
    setRunningScript(name);
    try {
      message.loading({ content: `Đang chạy ${name}…`, key: 'run-script', duration: 0 });
      const r = await api.post<{ ok: boolean; scripts: RouterScriptStatus[] }>(`/api/system/router-scripts/${name}/run`);
      setRouterScripts(r.scripts || []);
      message.destroy('run-script');
      message.success(name === 'quayip' ? 'Quay IP xong — xem WAN Status' : `Đã chạy ${name}`);
    } catch (e: any) {
      message.destroy('run-script');
      message.error(e.message);
    } finally { setRunningScript(null); }
  };

  const changePassword = async (vals: { oldPassword: string; newPassword: string }) => {
    try {
      await api.post('/api/auth/change-password', vals);
      message.success('Đã đổi mật khẩu');
      pwForm.resetFields();
    } catch (e: any) { message.error(e.message); }
  };

  const testConn = async () => {
    setTesting(true);
    setTest(null);
    try {
      const r = await api.post<MikrotikTestResult>('/api/mikrotik/test');
      setTest(r);
      if (r.rest && r.ssh) message.success('Mikrotik OK');
      else message.warning('Có lỗi — xem chi tiết bên dưới');
    } catch (e: any) {
      message.error(e.message);
      setTest({ rest: false, ssh: false, restError: e.message, sshError: e.message });
    } finally {
      setTesting(false);
    }
  };

  const syncTime = async () => {
    setSyncing(true);
    try {
      const r = await api.post<ClockSyncResult>('/api/mikrotik/sync-time');
      if (r.skipped) {
        message.info(`Đồng hồ đã sync gần đây (${new Date(r.syncedAt).toLocaleString('vi-VN')})`);
        return;
      }
      const when = r.router ? `${r.router.date} ${r.router.time}` : new Date(r.syncedAt).toISOString().slice(0, 19).replace('T', ' ');
      const n = r.containers?.length ?? 0;
      const tz = r.timezone === 'Asia/Ho_Chi_Minh' ? 'Giờ VN (UTC+7)' : (r.timezone || 'local');
      message.success(`Đã sync time: ${when} ${tz} · ${n} container · NTP ${r.ntpEnabled ? 'bật' : 'tắt'}`);
    } catch (e: any) { message.error(e.message); }
    finally { setSyncing(false); }
  };

  const saveAutoProxy = async (vals: AutoProxySettings) => {
    setSavingAuto(true);
    try {
      const r = await api.patch<AutoProxySettings>('/api/settings/auto-proxy', vals);
      setAutoProxy(r);
      message.success('Đã lưu cấu hình auto-proxy');
    } catch (e: any) { message.error(e.message); }
    finally { setSavingAuto(false); }
  };

  return (
    <ProxyPageShell className="settings-page">
      <Row gutter={[16, 0]}>
        <Col xs={24} lg={12}>
          <SettingsSectionCard
            title="Tài khoản"
            description="Thông tin đăng nhập và đổi mật khẩu"
            icon={<UserOutlined />}
            accent="#1677FF"
          >
            <div className="settings-account-meta">
              <div className="settings-account-chip">
                <span className="settings-account-chip__label">Username</span>
                <Text strong>{user?.username}</Text>
              </div>
              <div className="settings-account-chip">
                <span className="settings-account-chip__label">Role</span>
                <Tag color="blue" bordered={false}>{user?.role}</Tag>
              </div>
            </div>
            <Divider style={{ margin: '12px 0 16px' }} />
            <Form form={pwForm} layout="vertical" onFinish={changePassword}>
              <Form.Item name="oldPassword" label="Mật khẩu cũ" rules={[{ required: true }]}>
                <Input.Password prefix={<LockOutlined />} />
              </Form.Item>
              <Form.Item name="newPassword" label="Mật khẩu mới" rules={[{ required: true, min: 6, message: '≥ 6 ký tự' }]}>
                <Input.Password prefix={<LockOutlined />} />
              </Form.Item>
              <Button type="primary" htmlType="submit">Đổi mật khẩu</Button>
            </Form>
          </SettingsSectionCard>
        </Col>

        <Col xs={24} lg={12}>
          <SettingsSectionCard
            title="MikroTik"
            description="Test REST/SSH và đồng bộ thời gian"
            icon={<ApiOutlined />}
            accent="#13C2C2"
          >
            <Space wrap>
              <Button icon={<ApiOutlined />} loading={testing} onClick={testConn}>Test kết nối</Button>
              <Button icon={<ClockCircleOutlined />} loading={syncing} onClick={syncTime}>Sync time</Button>
            </Space>
            {test && (
              <div style={{ marginTop: 14 }}>
                <DismissibleAlert
                  bannerId="settings-mikrotik-test"
                  persist={false}
                  type={test.rest && test.ssh ? 'success' : 'warning'}
                  showIcon
                  message={test.rest && test.ssh ? 'Kết nối OK' : 'Có lỗi'}
                  description={(
                    <Space direction="vertical" size={4}>
                      <div>
                        REST:&nbsp;
                        {test.rest ? <Tag icon={<CheckCircleFilled />} color="success">{test.restLatencyMs}ms</Tag>
                          : <Tag icon={<CloseCircleFilled />} color="error">{test.restError}</Tag>}
                      </div>
                      <div>
                        SSH:&nbsp;
                        {test.ssh ? <Tag icon={<CheckCircleFilled />} color="success">{test.sshLatencyMs}ms</Tag>
                          : <Tag icon={<CloseCircleFilled />} color="error">{test.sshError}</Tag>}
                      </div>
                    </Space>
                  )}
                />
              </div>
            )}
          </SettingsSectionCard>
        </Col>
      </Row>

      <SettingsSectionCard
        title="Auto-proxy"
        description="Pool rotation — tự nhận pppoe-outX và provision proxy"
        icon={<ThunderboltOutlined />}
        accent="#722ED1"
      >
        <DismissibleAlert
          bannerId="settings-auto-proxy-info"
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="Pool rotation: pppoe-outX xuất hiện → WebUI tự nhận → tạo proxy"
          description="semi = đếm ngược 8s rồi tự provision (có thể hủy) · full = tự động ngay · off = chỉ hiển thị, không tạo proxy"
        />
        {autoProxy && (
          <Form form={autoForm} layout="vertical" onFinish={saveAutoProxy} initialValues={autoProxy}>
            <Row gutter={16}>
              <Col xs={24} md={12}>
                <Form.Item name="mode" label="Chế độ" rules={[{ required: true }]}>
                  <Select options={[
                    { value: 'semi', label: 'Semi — đếm ngược 8s' },
                    { value: 'full', label: 'Full — tự động ngay' },
                    { value: 'off', label: 'Off — chỉ discovery' },
                  ]} />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item name="maxConcurrent" label="Max proxy đồng thời" rules={[{ required: true }]}>
                  <InputNumber min={1} max={50} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item name="pollIntervalMs" label="Poll interval (ms)" rules={[{ required: true }]}>
                  <InputNumber min={5000} max={120000} step={1000} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item name="staleTtlMs" label="Stale TTL (ms)" rules={[{ required: true }]}>
                  <InputNumber min={60000} max={3600000} step={60000} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            </Row>
            <Button type="primary" htmlType="submit" icon={<SyncOutlined />} loading={savingAuto}>
              Lưu auto-proxy
            </Button>
          </Form>
        )}
      </SettingsSectionCard>

      {user?.role === 'admin' && (
        <SettingsSectionCard
          title="Phục hồi Firewall"
          description="Audit & sửa filter · NAT · mangle khi chạy proxy quy mô lớn"
          icon={<SafetyCertificateOutlined />}
          accent="#EB2F96"
          extra={(
            <Button icon={<ReloadOutlined />} loading={fwLoading} onClick={loadFirewallReconcile}>Refresh</Button>
          )}
        >
          <DismissibleAlert
            bannerId="settings-firewall-reconcile-info"
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message="Reconcile hub firewall"
            description="Kiểm tra rule trùng/mồ côi (slot không còn trong DB), dọn hub-wan IP cũ, repair từng batch slot — tránh spike CPU trên router."
          />
          <Space wrap style={{ marginBottom: 12 }}>
            <Button loading={fwRunning} onClick={() => runFirewallReconcile({ dryRun: true })}>
              Kiểm tra (dry-run)
            </Button>
            <Button type="primary" loading={fwRunning} icon={<SyncOutlined />} onClick={() => runFirewallReconcile({})}>
              Phục hồi batch
            </Button>
            <Button danger loading={fwRunning} onClick={() => runFirewallReconcile({ repairAll: true })}>
              Repair toàn bộ
            </Button>
          </Space>
          {fwReconcile && (
            <Descriptions column={{ xs: 1, sm: 2 }} bordered size="small" style={{ marginBottom: 12 }}>
              <Descriptions.Item label="Tự động">
                <Tag color={fwReconcile.enabled ? 'success' : 'default'} bordered={false}>
                  {fwReconcile.enabled ? 'Bật' : 'Tắt'}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Chu kỳ">
                {Math.round(fwReconcile.intervalMs / 60000)} phút · batch {fwReconcile.maxSlotsPerPass} slot
              </Descriptions.Item>
            </Descriptions>
          )}
          {fwLastResult && (
            <Descriptions column={{ xs: 1, sm: 2 }} bordered size="small">
              <Descriptions.Item label="Lần chạy cuối">
                {new Date(fwLastResult.at).toLocaleString('vi-VN')} ({fwLastResult.durationMs}ms)
              </Descriptions.Item>
              <Descriptions.Item label="Orphan / thiếu / trùng">
                {fwLastResult.audit.orphans.length} / {fwLastResult.audit.missing.length} / {fwLastResult.audit.duplicates.length}
              </Descriptions.Item>
              <Descriptions.Item label="Đã xóa">
                NAT {fwLastResult.removed.nat} · filter {fwLastResult.removed.filter} · mangle {fwLastResult.removed.mangle}
              </Descriptions.Item>
              <Descriptions.Item label="Repair">
                {fwLastResult.repaired.ok}/{fwLastResult.repaired.attempted} slot
                {fwLastResult.repaired.failed > 0 ? ` · ${fwLastResult.repaired.failed} lỗi` : ''}
              </Descriptions.Item>
            </Descriptions>
          )}
        </SettingsSectionCard>
      )}

      {user?.role === 'admin' && (
        <SettingsSectionCard
          title="Router Scripts"
          description="quayip · DuckDNS · protect trên MikroTik"
          icon={<CodeOutlined />}
          accent="#FA8C16"
          extra={(
            <Space>
              <Button icon={<ReloadOutlined />} loading={scriptsLoading} onClick={loadRouterScripts}>Refresh</Button>
              <Button type="primary" icon={<SyncOutlined />} loading={ensuringScripts} onClick={ensureRouterScripts}>
                Cài đặt
              </Button>
            </Space>
          )}
        >
          <DismissibleAlert
            bannerId="settings-router-scripts-info"
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message="Script hệ thống trên MikroTik"
            description="quayip: quay IP pool pppoe-out · duckdns: cập nhật DDNS từ pppoe-wan · protect: bảo vệ pppoe-wan"
          />
          <Table
            size="small"
            rowKey="name"
            loading={scriptsLoading}
            dataSource={routerScripts}
            pagination={false}
            className="proxy-table-card"
            columns={[
              { title: 'Script', dataIndex: 'label', key: 'label', render: (v: string, r: RouterScriptStatus) => (
                <Space direction="vertical" size={0}>
                  <Text strong>{v}</Text>
                  <Text type="secondary" style={{ fontSize: 11 }}>{r.name}</Text>
                </Space>
              )},
              { title: 'Cài đặt', key: 'installed', width: 90,
                render: (_: unknown, r: RouterScriptStatus) => (
                  r.installed ? <Tag color="success" bordered={false}>OK</Tag> : <Tag color="error" bordered={false}>Thiếu</Tag>
                )},
              { title: 'Scheduler', key: 'sched', width: 120,
                render: (_: unknown, r: RouterScriptStatus) => r.scheduler
                  ? <Tag bordered={false}>{r.scheduler.interval || '—'}</Tag> : <Tag bordered={false}>—</Tag> },
              { title: 'Run count', dataIndex: 'runCount', key: 'runCount', width: 90 },
              { title: 'Lần chạy cuối', dataIndex: 'lastStarted', key: 'lastStarted', width: 160,
                render: (v: string | null) => v || '—' },
              { title: '', key: 'act', width: 100,
                render: (_: unknown, r: RouterScriptStatus) => (
                  <Button size="small" icon={<PlayCircleOutlined />}
                    loading={runningScript === r.name}
                    disabled={!r.installed || !!runningScript}
                    onClick={() => runRouterScript(r.name)}>
                    Chạy
                  </Button>
                )},
            ]}
          />
        </SettingsSectionCard>
      )}

      {info && (
        <SettingsSectionCard
          title="Thông tin deploy"
          description="Target, network formula và 3proxy image"
          icon={<InfoCircleOutlined />}
          accent="#52C41A"
        >
          <Descriptions column={{ xs: 1, sm: 2 }} bordered size="small">
            <Descriptions.Item label="Deploy target">
              <Tag color={info.target === 'router' ? 'success' : 'warning'} bordered={false}>{info.target}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="Mikrotik host">{info.mikrotik.host}</Descriptions.Item>
            <Descriptions.Item label="Quản trị (host)">
              {info.mikrotik.managementUrl
                ? <a href={info.mikrotik.managementUrl} target="_blank" rel="noreferrer">{info.mikrotik.wanHost || info.mikrotik.managementUrl}</a>
                : (info.mikrotik.wanHost || '—')}
            </Descriptions.Item>
            <Descriptions.Item label="3proxy image">{info.threeProxy.image}</Descriptions.Item>
            <Descriptions.Item label="3proxy tarball">{info.threeProxy.tarball}</Descriptions.Item>
            <Descriptions.Item label="Bridge">{info.network.bridgeName}</Descriptions.Item>
            <Descriptions.Item label="Veth IP">{info.network.vethIpFormula || `${info.network.vethNetworkBase}.N.2/30`}</Descriptions.Item>
            <Descriptions.Item label="Max pppoe-out">{info.network.maxPppoeIdx ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="HTTP port">{info.network.portFormula || `${info.network.extHttpPortBase}+N`}</Descriptions.Item>
            <Descriptions.Item label="SOCKS port">{info.network.extSocksPortBase}+N</Descriptions.Item>
            <Descriptions.Item label="Ghi chú" span={2}>
              IP PPPoE động — truy cập WebUI qua host (DuckDNS), không dùng IP tĩnh.
            </Descriptions.Item>
          </Descriptions>
        </SettingsSectionCard>
      )}
    </ProxyPageShell>
  );
}