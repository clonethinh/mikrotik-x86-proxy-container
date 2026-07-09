import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Chip } from '@heroui/react';
import { useNavigate } from 'react-router-dom';
import { api, DashboardData, DeviceRoute, DhcpLease } from '../services/api';
import { useWSEvent } from '../services/ws';
import { usePollEffect, usePollInterval } from '../hooks/usePollInterval';
import { useSpeedUnit } from '../hooks/useSpeedUnit';
import { formatBps, formatBytesLabel } from '../lib/format';
import { seriesFromHistory } from '../lib/chartUtils';
import MobileHeader from '../components/layout/MobileHeader';
import PageLayout from '../components/layout/PageLayout';
import LoadingScreen from '../components/ui/LoadingScreen';
import DashboardTop from '../components/dashboard/DashboardTop';
import DashboardQuickActions from '../components/dashboard/DashboardQuickActions';
import { useWideLayout } from '../hooks/useWideLayout';
import CollapsibleSection from '../components/ui/CollapsibleSection';
import ListCard from '../components/ui/ListCard';
import RecordList from '../components/ui/RecordList';
import SparkAreaChart from '../components/charts/SparkAreaChart';
import DualTrafficChart from '../components/charts/DualTrafficChart';
import HorizontalBarChart from '../components/charts/HorizontalBarChart';
import RingGauge from '../components/charts/RingGauge';
import KvList from '../components/ui/KvList';
import { IconDashboard } from '../components/ui/Icons';

function findDeviceRoute(lease: DhcpLease, devices: DeviceRoute[]): DeviceRoute | undefined {
  const mac = lease.macAddress.toUpperCase();
  const host = (lease.hostName || '').toLowerCase();
  return devices.find((d) => {
    if (!d.enabled) return false;
    if (d.matchType === 'ip' && d.ipAddress === lease.address) return true;
    if (d.matchType === 'mac' && (d.macAddress || '').toUpperCase() === mac) return true;
    if (d.matchType === 'dhcp' && d.dhcpHostName && host && d.dhcpHostName.toLowerCase() === host) return true;
    if (d.matchType === 'dhcp' && d.ipAddress === lease.address) return true;
    return false;
  });
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const wide = useWideLayout();
  const { seconds: pollSec, setSeconds: setPollSec, ms: pollMs } = usePollInterval();
  const { unit, setUnit } = useSpeedUnit();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      setData(await api.get<DashboardData>('/api/dashboard'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  usePollEffect(() => load(true), pollMs, [load]);

  useWSEvent(
    (msg) => ['wan.sync', 'proxy.status', 'proxy.ip-changed', 'proxy.health', 'wan.bulk', 'device.created', 'device.updated', 'device.deleted'].includes(msg.type),
    () => load(true),
  );

  const rm = data?.routerMonitor;
  const wt = data?.wanTraffic;
  const leases = data?.dhcpLeases ?? [];
  const devices = data?.deviceRoutes ?? [];

  const proxyPct = data && data.totalProxies > 0 ? Math.round((data.runningProxies / data.totalProxies) * 100) : 0;
  const containerPct = data && (data.containerProxies || 0) > 0
    ? Math.round(((data.containerHealthy || 0) / (data.containerProxies || 1)) * 100)
    : 0;

  const cpuHistory = useMemo(
    () => seriesFromHistory(rm?.history ?? [], (p) => p.cpuLoadPct ?? 0),
    [rm?.history],
  );
  const memHistory = useMemo(
    () => seriesFromHistory(rm?.history ?? [], (p) => p.memoryUsedPct ?? 0),
    [rm?.history],
  );
  const hddHistory = useMemo(
    () => seriesFromHistory(rm?.history ?? [], (p) => p.hddUsedPct ?? 0),
    [rm?.history],
  );

  const wanRx = useMemo(() => seriesFromHistory(wt?.history ?? [], (p) => p.rxBps), [wt?.history]);
  const wanTx = useMemo(() => seriesFromHistory(wt?.history ?? [], (p) => p.txBps), [wt?.history]);

  const dhcpBars = useMemo(() => {
    return [...leases]
      .sort((a, b) => (Number(b.rxBps || 0) + Number(b.txBps || 0)) - (Number(a.rxBps || 0) + Number(a.txBps || 0)))
      .slice(0, 6)
      .map((l) => ({
        label: l.hostName || l.address,
        value: Math.round((l.rxBps || 0) + (l.txBps || 0)),
        color: 'accent' as const,
      }));
  }, [leases]);

  const sortedLeases = useMemo(() => {
    const order = (s: string) => (s === 'bound' ? 0 : s === 'waiting' ? 1 : 2);
    return [...leases].sort((a, b) => {
      const d = order(a.status) - order(b.status);
      if (d !== 0) return d;
      return a.address.localeCompare(b.address, undefined, { numeric: true });
    });
  }, [leases]);

  if (loading && !data) return <LoadingScreen />;

  return (
    <div>
      <MobileHeader
        title="Dashboard"
        subtitle={data?.mikrotik?.host}
        icon={<IconDashboard />}
        onRefresh={() => load()}
        refreshing={refreshing}
      />
      <PageLayout
        banner={data?.webuiRunning === false ? (
          <div className="alert-banner">Container webuiproxymikrotik không chạy trên router</div>
        ) : undefined}
      >
        {data ? (
          <DashboardTop
            data={data}
            pollSec={pollSec}
            onPollSecChange={setPollSec}
            unit={unit}
            onUnitChange={setUnit}
            onNavigate={(path) => navigate(path)}
          />
        ) : null}

        {wide ? <DashboardQuickActions /> : null}

        <div className="dashboard-sections-grid">
        <CollapsibleSection
          title="Health overview"
          subtitle="Container & proxy running rate"
          defaultOpen
          badge={
            <span className="text-muted">{proxyPct}% · {containerPct}%</span>
          }
        >
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col items-center rounded-lg border border-border/50 bg-surface/40 p-2">
              <RingGauge label="Running" value={proxyPct} color={proxyPct >= 80 ? 'success' : proxyPct >= 50 ? 'warning' : 'danger'} size="sm" />
              <div className="mt-1 text-center text-[0.625rem] text-muted">
                {data?.runningProxies}/{data?.totalProxies} · {data?.errorProxies} err
              </div>
            </div>
            <div className="flex flex-col items-center rounded-lg border border-border/50 bg-surface/40 p-2">
              <RingGauge label="Healthy" value={containerPct} color={containerPct >= 80 ? 'success' : containerPct >= 50 ? 'warning' : 'danger'} size="sm" />
              <div className="mt-1 text-center text-[0.625rem] text-muted">
                {data?.containerHealthy}/{data?.containerProxies} container
              </div>
            </div>
          </div>
        </CollapsibleSection>

        {rm ? (
          <CollapsibleSection
            title="Router Monitor"
            subtitle="CPU, RAM, HDD · MikroTik"
            defaultOpen
            action={<Chip size="sm" color={rm.live ? 'success' : 'default'}>{rm.live ? 'Live' : 'Cached'}</Chip>}
            badge={<span>{rm.cpuLoadPct ?? '—'}% CPU</span>}
          >
            <KvList
              compact
              grid
              items={[
                { label: 'RAM', value: `${rm.freeMemoryLabel} / ${rm.totalMemoryLabel}` },
                { label: 'HDD', value: `${rm.freeHddLabel} / ${rm.totalHddLabel}` },
                { label: 'CPU', value: rm.cpu || '—' },
                { label: 'Containers', value: `${rm.containerRunning}/${rm.containerTotal}` },
                { label: 'Uptime', value: rm.uptimeLabel || '—' },
                { label: 'Load', value: rm.cpuLoadPct != null ? `${rm.cpuLoadPct}%` : '—' },
              ]}
            />
            {cpuHistory.length > 1 ? (
              <div className="mt-2">
                <div className="mb-1 text-[0.625rem] font-semibold uppercase tracking-wide text-muted">CPU</div>
                <SparkAreaChart data={cpuHistory} color="warning" height={56} showGrid={false} />
              </div>
            ) : null}
            {memHistory.length > 1 ? (
              <div className="mt-2">
                <div className="mb-1 text-[0.625rem] font-semibold uppercase tracking-wide text-muted">RAM</div>
                <SparkAreaChart data={memHistory} color="accent" height={56} showGrid={false} />
              </div>
            ) : null}
            {hddHistory.length > 1 ? (
              <div className="mt-2">
                <div className="mb-1 text-[0.625rem] font-semibold uppercase tracking-wide text-muted">HDD</div>
                <SparkAreaChart data={hddHistory} color="accent" height={56} showGrid={false} />
              </div>
            ) : null}
          </CollapsibleSection>
        ) : null}

        {wt && wanRx.length > 1 ? (
          <CollapsibleSection
            title="WAN Traffic"
            subtitle={`${wt.wanUp}/${wt.wanTotal} WAN up`}
            defaultOpen
            action={<Chip size="sm" color={wt.live ? 'success' : 'default'}>{wt.live ? 'Live' : 'Cached'}</Chip>}
            badge={
              <span className="traffic-pill">↓{formatBps(wt.rxBps, unit)}</span>
            }
          >
            <DualTrafficChart rx={wanRx} tx={wanTx} height={88} />
            <div className="mt-2 flex justify-between text-[0.6875rem] text-muted">
              <span className="traffic-pill">↓ {formatBps(wt.rxBps, unit)} {unit}</span>
              <span className="traffic-pill traffic-pill-tx">↑ {formatBps(wt.txBps, unit)} {unit}</span>
            </div>
            <div className="mt-1 text-[0.625rem] text-muted">
              {wt.rxLabel} ↓ · {wt.txLabel} ↑
            </div>
          </CollapsibleSection>
        ) : null}

        <CollapsibleSection
          title="Kết nối quản trị"
          subtitle={data?.mikrotik.host}
          defaultOpen={false}
          badge={<span>{data?.mikrotik.version || '—'}</span>}
        >
          <KvList
            compact
            grid
            items={[
              { label: 'API host', value: data?.mikrotik.host || '—' },
              { label: 'WAN host', value: data?.mikrotik.wanHost || '—' },
              { label: 'WebUI', value: data?.mikrotik.managementUrl ? (
                <a href={data.mikrotik.managementUrl} target="_blank" rel="noreferrer" className="text-accent underline">
                  {data.mikrotik.wanHost || data.mikrotik.managementUrl}
                </a>
              ) : '—' },
              { label: 'RouterOS', value: data?.mikrotik.version || '—' },
              { label: 'Board', value: data?.mikrotik.boardName || '—' },
              { label: 'Arch', value: data?.mikrotik.architecture || '—' },
              { label: 'Uptime', value: data?.mikrotik.uptime || rm?.uptimeLabel || '—' },
              { label: 'CPU load', value: data?.mikrotik.cpuLoad || (rm?.cpuLoadPct != null ? `${rm.cpuLoadPct}%` : '—') },
            ]}
          />
        </CollapsibleSection>

        <CollapsibleSection
          title="DHCP Clients"
          subtitle={`${leases.length} lease · route WAN`}
          defaultOpen
          action={<Button size="sm" variant="ghost" onPress={() => navigate('/devices')}>Quản lý</Button>}
          badge={<span>{leases.filter((l) => l.status === 'bound').length} bound</span>}
        >
          {dhcpBars.length > 0 ? (
            <HorizontalBarChart items={dhcpBars} />
          ) : null}
          <RecordList className="mt-2">
            {sortedLeases.length === 0 ? (
              <div className="py-2 text-sm text-muted">Chưa có lease</div>
            ) : (
              sortedLeases.slice(0, 16).map((l) => {
                const route = findDeviceRoute(l, devices);
                const traffic = (l.rxBps || l.txBps)
                  ? `↓${formatBps(l.rxBps || 0, unit)} ↑${formatBps(l.txBps || 0, unit)}`
                  : `${formatBytesLabel(l.rxBytes)}↓ · ${formatBytesLabel(l.txBytes)}↑`;
                return (
                  <ListCard key={l.id}>
                    <ListCard.Body>
                      <ListCard.Row>
                        <ListCard.Main>
                          <ListCard.Title>{l.hostName || l.address}</ListCard.Title>
                          <ListCard.Subtitle>
                            {l.address}{route ? ` · → ${route.pppoeName}` : ''}
                          </ListCard.Subtitle>
                          <ListCard.Meta>
                            <span>{traffic}</span>
                            <span className="mobile-mono">{l.macAddress}</span>
                          </ListCard.Meta>
                        </ListCard.Main>
                        <ListCard.Aside>
                          <Chip size="sm" color={l.status === 'bound' ? 'success' : 'default'}>{l.status}</Chip>
                        </ListCard.Aside>
                      </ListCard.Row>
                    </ListCard.Body>
                  </ListCard>
                );
              })
            )}
          </RecordList>
        </CollapsibleSection>
        </div>
      </PageLayout>
    </div>
  );
}