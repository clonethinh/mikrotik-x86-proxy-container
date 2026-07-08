import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import {
  Card, Tag, Typography, Button, Empty, theme, Flex, Tooltip, Pagination, Segmented,
} from 'antd';
import {
  LaptopOutlined, RightOutlined, ApiOutlined, CheckCircleOutlined,
  ClockCircleOutlined, GlobalOutlined, WifiOutlined, LinkOutlined,
  ArrowDownOutlined, ArrowUpOutlined, CloudDownloadOutlined, CloudUploadOutlined,
} from '@ant-design/icons';
import type { DhcpLease, DeviceRoute } from '../../services/api';
import { formatBytes, formatSpeed, type SpeedUnit } from '../../lib/proxiesFormat';
import { useSpeedUnit } from '../../hooks/useSpeedUnit';

const { Text } = Typography;
const PAGE_SIZE = 10;

const STATUS_META: Record<string, { color: string; label: string; accent: string; icon: ReactNode }> = {
  bound: { color: 'success', label: 'Bound', accent: '#52c41a', icon: <CheckCircleOutlined /> },
  waiting: { color: 'processing', label: 'Waiting', accent: '#1677ff', icon: <ClockCircleOutlined /> },
  offered: { color: 'warning', label: 'Offered', accent: '#faad14', icon: <WifiOutlined /> },
};

function findDeviceRoute(lease: DhcpLease, devices: DeviceRoute[]): DeviceRoute | undefined {
  const mac = lease.macAddress.toUpperCase();
  const host = (lease.hostName || '').toLowerCase();
  return devices.find(d => {
    if (!d.enabled) return false;
    if (d.matchType === 'ip' && d.ipAddress === lease.address) return true;
    if (d.matchType === 'mac' && (d.macAddress || '').toUpperCase() === mac) return true;
    if (d.matchType === 'dhcp' && d.dhcpHostName && host && d.dhcpHostName.toLowerCase() === host) return true;
    if (d.matchType === 'dhcp' && d.ipAddress === lease.address) return true;
    return false;
  });
}

function sortLeases(rows: DhcpLease[]): DhcpLease[] {
  const order = (s: string) => (s === 'bound' ? 0 : s === 'waiting' ? 1 : 2);
  return [...rows].sort((a, b) => {
    const d = order(a.status) - order(b.status);
    if (d !== 0) return d;
    return a.address.localeCompare(b.address, undefined, { numeric: true });
  });
}

function deviceInitial(name: string): string {
  const n = (name || '?').trim();
  return (n[0] || '?').toUpperCase();
}

interface LeaseRowProps {
  lease: DhcpLease;
  route?: DeviceRoute;
  speedUnit: SpeedUnit;
}

function LeaseTraffic({ lease, speedUnit }: { lease: DhcpLease; speedUnit: SpeedUnit }) {
  const live = lease.trafficLive && lease.status === 'bound';
  const rxBps = lease.rxBps ?? 0;
  const txBps = lease.txBps ?? 0;
  const hasTraffic = live || rxBps > 0 || txBps > 0 || Number(lease.rxBytes || 0) > 0 || Number(lease.txBytes || 0) > 0;

  if (!hasTraffic && lease.status !== 'bound') {
    return (
      <div className="dashboard-dhcp-item__traffic dashboard-dhcp-item__traffic--idle">
        <Text type="secondary" style={{ fontSize: 11 }}>—</Text>
      </div>
    );
  }

  return (
    <div className={`dashboard-dhcp-item__traffic${live ? ' dashboard-dhcp-item__traffic--live' : ''}`}>
      <Tooltip title={`Tổng: ${formatBytes(lease.rxBytes || '0')} ↓ · ${formatBytes(lease.txBytes || '0')} ↑`}>
        <div className="dashboard-dhcp-item__traffic-row dashboard-dhcp-item__traffic-row--down">
          <CloudDownloadOutlined className="dashboard-dhcp-item__traffic-icon" />
          <span className="dashboard-dhcp-item__traffic-bps">
            <ArrowDownOutlined />
            {formatSpeed(rxBps, speedUnit)}
          </span>
          <span className="dashboard-dhcp-item__traffic-total">{lease.rxLabel || '—'}</span>
        </div>
      </Tooltip>
      <Tooltip title={`Upload tích lũy: ${formatBytes(lease.txBytes || '0')}`}>
        <div className="dashboard-dhcp-item__traffic-row dashboard-dhcp-item__traffic-row--up">
          <CloudUploadOutlined className="dashboard-dhcp-item__traffic-icon" />
          <span className="dashboard-dhcp-item__traffic-bps">
            <ArrowUpOutlined />
            {formatSpeed(txBps, speedUnit)}
          </span>
          <span className="dashboard-dhcp-item__traffic-total">{lease.txLabel || '—'}</span>
        </div>
      </Tooltip>
    </div>
  );
}

function DhcpLeaseCard({ lease, route, speedUnit }: LeaseRowProps) {
  const meta = STATUS_META[lease.status] ?? {
    color: 'default', label: lease.status || '—', accent: '#8c8c8c', icon: <WifiOutlined />,
  };
  const displayName = lease.hostName || '(không tên)';

  return (
    <div
      className={`dashboard-dhcp-item dashboard-dhcp-item--${lease.status || 'unknown'}`}
      style={{ '--dhcp-accent': meta.accent } as CSSProperties}
    >
      <div className="dashboard-dhcp-item__avatar" aria-hidden>
        {deviceInitial(lease.hostName)}
      </div>

      <div className="dashboard-dhcp-item__main">
        <Flex align="center" gap={8} wrap="wrap" className="dashboard-dhcp-item__title-row">
          <Text strong className="dashboard-dhcp-item__name">{displayName}</Text>
          <Tag
            bordered={false}
            color={meta.color}
            icon={meta.icon}
            className="dashboard-dhcp-item__status"
          >
            {meta.label}
          </Tag>
        </Flex>
        <div className="dashboard-dhcp-item__meta">
          <span className="dashboard-dhcp-item__ip">{lease.address}</span>
          <span className="dashboard-dhcp-item__sep">·</span>
          <Tooltip title={lease.macAddress}>
            <span className="dashboard-dhcp-item__mac">{lease.macAddress}</span>
          </Tooltip>
          {lease.server && (
            <>
              <span className="dashboard-dhcp-item__sep">·</span>
              <span className="dashboard-dhcp-item__server">{lease.server}</span>
            </>
          )}
        </div>
      </div>

      <LeaseTraffic lease={lease} speedUnit={speedUnit} />

      <div className="dashboard-dhcp-item__egress">
        {route ? (
          <Tooltip title={`Egress: ${route.pppoeName} · ${route.name}`}>
            <div className="dashboard-dhcp-item__route dashboard-dhcp-item__route--active">
              <LinkOutlined />
              <span className="dashboard-dhcp-item__route-name">{route.pppoeName}</span>
              <GlobalOutlined className="dashboard-dhcp-item__route-wan" />
            </div>
          </Tooltip>
        ) : (
          <span className="dashboard-dhcp-item__route dashboard-dhcp-item__route--none">
            Chưa route
          </span>
        )}
      </div>
    </div>
  );
}

interface Props {
  leases: DhcpLease[];
  devices: DeviceRoute[];
  loading?: boolean;
  onManageDevices?: () => void;
}

export default function DashboardDhcpClients({
  leases,
  devices,
  loading,
  onManageDevices,
}: Props) {
  const { token } = theme.useToken();
  const { unit: speedUnit, setUnit: setSpeedUnit } = useSpeedUnit();
  const [page, setPage] = useState(1);

  const sorted = useMemo(() => sortLeases(leases), [leases]);

  const stats = useMemo(() => {
    const bound = leases.filter(l => l.status === 'bound').length;
    const waiting = leases.filter(l => l.status === 'waiting').length;
    const routed = leases.filter(l => findDeviceRoute(l, devices)).length;
    return { total: leases.length, bound, waiting, routed };
  }, [leases, devices]);

  const pageRows = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return sorted.slice(start, start + PAGE_SIZE);
  }, [sorted, page]);

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
    if (page > maxPage) setPage(maxPage);
  }, [sorted.length, page]);

  return (
    <Card
      className="dashboard-panel-card dashboard-dhcp-card"
      loading={loading}
      title={(
        <span className="dashboard-dhcp-card__title">
          <span className="router-monitor-card__title-icon">
            <LaptopOutlined />
          </span>
          Thiết bị LAN — DHCP
          <Tag bordered={false} color="blue" style={{ marginLeft: 8 }}>MikroTik live</Tag>
        </span>
      )}
      extra={(
        <Flex align="center" gap={8} wrap="wrap">
          <Segmented
            size="small"
            value={speedUnit}
            onChange={v => setSpeedUnit(v as typeof speedUnit)}
            options={['KB/s', 'MB/s', 'Mbps']}
          />
          {onManageDevices && (
            <Button type="link" size="small" icon={<RightOutlined />} onClick={onManageDevices}>
              Quản lý route
            </Button>
          )}
        </Flex>
      )}
      style={{ boxShadow: token.boxShadowTertiary }}
    >
      <div className="dashboard-dhcp-summary">
        <div className="dashboard-dhcp-stat dashboard-dhcp-stat--total">
          <span className="dashboard-dhcp-stat__value">{stats.total}</span>
          <span className="dashboard-dhcp-stat__label">Lease</span>
        </div>
        <div className="dashboard-dhcp-stat dashboard-dhcp-stat--bound">
          <span className="dashboard-dhcp-stat__value">{stats.bound}</span>
          <span className="dashboard-dhcp-stat__label">Bound</span>
        </div>
        <div className="dashboard-dhcp-stat dashboard-dhcp-stat--wait">
          <span className="dashboard-dhcp-stat__value">{stats.waiting}</span>
          <span className="dashboard-dhcp-stat__label">Waiting</span>
        </div>
        <div className="dashboard-dhcp-stat dashboard-dhcp-stat--route">
          <span className="dashboard-dhcp-stat__value">{stats.routed}</span>
          <span className="dashboard-dhcp-stat__label">Có egress</span>
        </div>
      </div>

      {sorted.length === 0 ? (
        <Empty
          className="dashboard-dhcp-empty"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="Không có DHCP lease — kiểm tra DHCP Server trên bridge LAN"
        />
      ) : (
        <>
          <div className="dashboard-dhcp-list">
            {pageRows.map(lease => (
              <DhcpLeaseCard
                key={lease.id}
                lease={lease}
                route={findDeviceRoute(lease, devices)}
                speedUnit={speedUnit}
              />
            ))}
          </div>
          {sorted.length > PAGE_SIZE && (
            <Flex justify="space-between" align="center" className="dashboard-dhcp-pager">
              <Text type="secondary" style={{ fontSize: 12 }}>
                {stats.routed > 0 && (
                  <Tag bordered={false} color="geekblue" icon={<ApiOutlined />} style={{ marginRight: 8 }}>
                    {stats.routed} thiết bị có egress
                  </Tag>
                )}
                Hiển thị {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, sorted.length)} / {sorted.length}
              </Text>
              <Pagination
                size="small"
                current={page}
                total={sorted.length}
                pageSize={PAGE_SIZE}
                onChange={setPage}
                showSizeChanger={false}
              />
            </Flex>
          )}
        </>
      )}
    </Card>
  );
}