import { Button, Chip, Label, ListBox, Select } from '@heroui/react';
import type { DashboardData } from '../../services/api';
import { POLL_INTERVAL_OPTIONS, type PollIntervalSec } from '../../hooks/usePollInterval';
import type { SpeedUnit } from '../../lib/format';
import ListPageTop from '../ui/ListPageTop';
import { IconProxy, IconWan, IconFleet } from '../ui/Icons';

interface DashboardTopProps {
  data: DashboardData;
  pollSec: number;
  onPollSecChange: (sec: PollIntervalSec) => void;
  unit: SpeedUnit;
  onUnitChange: (unit: SpeedUnit) => void;
  onNavigate: (path: string) => void;
}

function gaugeColor(pct: number | null): 'accent' | 'success' | 'warning' | 'danger' {
  if (pct == null) return 'accent';
  if (pct >= 85) return 'danger';
  if (pct >= 65) return 'warning';
  return 'success';
}

export default function DashboardTop({
  data,
  pollSec,
  onPollSecChange,
  unit,
  onUnitChange,
  onNavigate,
}: DashboardTopProps) {
  const rm = data.routerMonitor;
  const healthPct = data.totalProxies
    ? Math.round((data.runningProxies / data.totalProxies) * 100)
    : 0;

  const gauges = rm ? [
    { label: 'CPU', value: rm.cpuLoadPct ?? null, color: gaugeColor(rm.cpuLoadPct ?? null) },
    { label: 'RAM', value: rm.memoryUsedPct ?? null, color: gaugeColor(rm.memoryUsedPct ?? null) },
    { label: 'HDD', value: rm.hddUsedPct ?? null, color: 'default' as const },
  ] : [];

  return (
    <ListPageTop
      glow
      eyebrow="Fleet Health"
      heroValue={healthPct}
      heroSuffix="%"
      summary={`${data.runningProxies}/${data.totalProxies} proxy · ${data.wanUp}/${data.totalWan} WAN`}
      badge={(
        <Chip size="sm" color={data.live ? 'success' : 'default'} className="shrink-0">
          {data.live ? 'Live' : 'Cached'}
        </Chip>
      )}
      gauges={gauges}
      metrics={[
        { label: 'Proxy', value: data.totalProxies ?? 0, hint: `${data.runningProxies ?? 0} run`, accent: true, icon: <IconProxy /> },
        { label: 'WAN', value: data.wanUp ?? 0, hint: `/ ${data.totalWan ?? 0}`, icon: <IconWan /> },
        { label: 'Clients', value: data.realtimeClients ?? 0, hint: 'realtime', icon: <IconFleet /> },
        { label: 'Error', value: data.errorProxies ?? 0, hint: 'proxy' },
        { label: 'Container', value: data.containerProxies ?? 0, hint: `${data.containerHealthy ?? 0} ok` },
        { label: 'Stopped', value: data.stoppedProxies ?? 0, hint: 'proxy' },
        { label: 'WAN down', value: data.wanDown ?? 0, hint: 'link' },
      ]}
      meta={`${data.mikrotik.boardName || 'RouterOS'} · ${data.mikrotik.version || '—'}${rm?.uptimeLabel ? ` · ${rm.uptimeLabel}` : ''}`}
      toolbar={(
        <div className="dashboard-top-controls">
          <Select
            className="dashboard-top-select"
            selectedKey={String(pollSec)}
            onSelectionChange={(k) => onPollSecChange(Number(k) as PollIntervalSec)}
            aria-label="Poll interval"
          >
            <Label className="sr-only">Poll</Label>
            <Select.Trigger><Select.Value /></Select.Trigger>
            <Select.Popover>
              <ListBox>
                {POLL_INTERVAL_OPTIONS.map((s) => (
                  <ListBox.Item key={String(s)} id={String(s)} textValue={`${s}s`}>
                    {s}s<ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>
          <Select
            className="dashboard-top-select"
            selectedKey={unit}
            onSelectionChange={(k) => onUnitChange(k as SpeedUnit)}
            aria-label="Speed unit"
          >
            <Label className="sr-only">Đơn vị tốc độ</Label>
            <Select.Trigger><Select.Value /></Select.Trigger>
            <Select.Popover>
              <ListBox>
                {(['KB/s', 'MB/s', 'Mbps'] as const).map((u) => (
                  <ListBox.Item key={u} id={u} textValue={u}>
                    {u}<ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>
          <Button size="sm" variant="outline" onPress={() => onNavigate('/wan')}>WAN</Button>
          <Button size="sm" variant="outline" onPress={() => onNavigate('/fleet')}>Fleet</Button>
          <Button size="sm" variant="outline" onPress={() => onNavigate('/devices')}>Devices</Button>
        </div>
      )}
    />
  );
}