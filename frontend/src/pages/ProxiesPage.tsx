import { useEffect, useState, useMemo, type ReactNode } from 'react';
import {
  Table, Button, Space, Tag, Switch, Input, Modal, Form, Select, Tooltip,
  Dropdown, Card, Typography, Popconfirm, App, Empty, Skeleton, Drawer,
  Alert, Segmented, Flex, Divider, Progress, InputNumber, DatePicker,
} from 'antd';
import {
  PlusOutlined, ReloadOutlined, ThunderboltOutlined, CopyOutlined,
  EyeOutlined, EditOutlined, DeleteOutlined, DownloadOutlined,
  MoreOutlined, ImportOutlined, FileTextOutlined, ApiOutlined,
  CheckCircleOutlined, PauseCircleOutlined, WarningOutlined, KeyOutlined,
} from '@ant-design/icons';
import { api, ProxyUser, WanInfo } from '../services/api';
import { useWSEvent } from '../services/ws';
import ProxyPageShell, { ProxyCode } from '../components/proxy/ProxyPageShell';
import ProxyStatsRow from '../components/proxy/ProxyStatsRow';
import ProxyTrafficChart, { type TrafficHistoryPoint } from '../components/proxy/ProxyTrafficChart';
import { HTTP_PORT_BASE, SOCKS_PORT_BASE } from '../lib/proxyUtils';
import { copyText } from '../lib/clipboard';
import { useTablePagination } from '../hooks/useTablePagination';
import dayjs from 'dayjs';

const { Text } = Typography;

interface LiveMetrics {
  clients: number;
  rxBps: number;
  txBps: number;
  rxBytes: string;
  txBytes: string;
  usedBytes?: string;
  quotaPct: number | null;
  sampledAt?: string;
  source?: 'admin' | 'logs';
}

interface ProxyRequestLogRow {
  id: number;
  ts: string;
  clientIp: string;
  destHost: string | null;
  destPort: number | null;
  rxBytes: string;
  txBytes: string;
  errorCode: number;
  durationMs: number | null;
  service: string | null;
}

interface ProxyDomainStatRow {
  domain: string;
  hits: number;
  rxBytes: string;
  txBytes: string;
  totalBytes: string;
}

interface ProxyLimitConfig {
  enabled: boolean;
  quotaDailyMb?: number | null;
  quotaWeeklyMb?: number | null;
  quotaMonthlyMb?: number | null;
  speedDownKbps?: number | null;
  speedUpKbps?: number | null;
  maxConnections?: number | null;
  allowedHours?: { weekdays?: string; periods?: string[] } | null;
  expiresAt?: string | null;
}

function formatBps(bps: number): string {
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(1)} Mbps`;
  if (bps >= 1_000) return `${(bps / 1_000).toFixed(0)} Kbps`;
  return `${bps} bps`;
}

const PROXY_LIST_RELOAD = new Set([
  'proxy.created', 'proxy.updated', 'proxy.deleted',
  'proxy.status', 'proxy.applied', 'proxy.reloading',
]);

function formatBytes(n: string | number): string {
  const v = typeof n === 'string' ? Number(n) : n;
  if (!v || Number.isNaN(v)) return '0 B';
  if (v >= 1_073_741_824) return `${(v / 1_073_741_824).toFixed(2)} GB`;
  if (v >= 1_048_576) return `${(v / 1_048_576).toFixed(1)} MB`;
  if (v >= 1024) return `${(v / 1024).toFixed(0)} KB`;
  return `${v} B`;
}

export default function ProxiesPage() {
  const { message: msgApi, modal } = App.useApp();
  const [proxies, setProxies] = useState<ProxyUser[]>([]);
  const [wans, setWans] = useState<WanInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selected, setSelected] = useState<number[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ProxyUser | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [logsTarget, setLogsTarget] = useState<ProxyUser | null>(null);
  const [logsText, setLogsText] = useState('');
  const [logsLoading, setLogsLoading] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [credsOpen, setCredsOpen] = useState(false);
  const [credsMode, setCredsMode] = useState<'same' | 'lines'>('same');
  const [credsText, setCredsText] = useState('');
  const [credsBusy, setCredsBusy] = useState(false);
  const [createForm] = Form.useForm();
  const [editForm] = Form.useForm();
  const [exportForm] = Form.useForm();
  const [credsForm] = Form.useForm();
  const [metricsMap, setMetricsMap] = useState<Record<number, LiveMetrics>>({});
  const [analyticsTarget, setAnalyticsTarget] = useState<ProxyUser | null>(null);
  const [analyticsLive, setAnalyticsLive] = useState<LiveMetrics | null>(null);
  const [analyticsTab, setAnalyticsTab] = useState<'overview' | 'limits' | 'logs'>('overview');
  const [analyticsUptime, setAnalyticsUptime] = useState<{ uptimePct: number | null; samples: number } | null>(null);
  const [historyPeriod, setHistoryPeriod] = useState<'hour' | 'day' | 'week' | 'month'>('hour');
  const [historyData, setHistoryData] = useState<TrafficHistoryPoint[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [limitsLoading, setLimitsLoading] = useState(false);
  const [limitsSaving, setLimitsSaving] = useState(false);
  const [limitsForm] = Form.useForm();
  const [logRequests, setLogRequests] = useState<ProxyRequestLogRow[]>([]);
  const [logDomains, setLogDomains] = useState<ProxyDomainStatRow[]>([]);
  const [requestLogsLoading, setRequestLogsLoading] = useState(false);
  const [logHostFilter, setLogHostFilter] = useState('');

  const loadMetrics = async () => {
    try {
      const rows = await api.get<Array<LiveMetrics & { proxyId: number }>>('/api/proxies/metrics/live-all');
      const map: Record<number, LiveMetrics> = {};
      for (const r of rows) {
        if (r?.proxyId) map[r.proxyId] = r;
      }
      setMetricsMap(map);
      if (analyticsTarget?.id && map[analyticsTarget.id]) {
        setAnalyticsLive(map[analyticsTarget.id]);
      }
    } catch {
      // keep previous metrics on transient errors
    }
  };

  const load = async () => {
    try {
      const [p, w] = await Promise.all([
        api.get<ProxyUser[]>('/api/proxies'),
        api.get<WanInfo[]>('/api/wan'),
      ]);
      setProxies(p);
      setWans(w);
      loadMetrics();
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    const t = setInterval(() => {
      setMetricsMap(prev => {
        let changed = false;
        const next: Record<number, LiveMetrics> = { ...prev };
        for (const [id, m] of Object.entries(prev)) {
          if ((m.rxBps ?? 0) <= 0 && (m.txBps ?? 0) <= 0) continue;
          next[+id] = {
            ...m,
            rxBps: Math.round((m.rxBps ?? 0) * 0.9),
            txBps: Math.round((m.txBps ?? 0) * 0.9),
          };
          changed = true;
        }
        return changed ? next : prev;
      });
      setAnalyticsLive(prev => {
        if (!prev || ((prev.rxBps ?? 0) <= 0 && (prev.txBps ?? 0) <= 0)) return prev;
        return {
          ...prev,
          rxBps: Math.round((prev.rxBps ?? 0) * 0.9),
          txBps: Math.round((prev.txBps ?? 0) * 0.9),
        };
      });
    }, 1000);
    return () => clearInterval(t);
  }, []);

  useWSEvent(
    (msg) => PROXY_LIST_RELOAD.has(msg.type) || msg.type === 'wan.sync',
    () => load(),
  );

  useWSEvent(
    (msg) => msg.type === 'proxy.metrics',
    (msg) => {
      const p = msg.payload as { proxyId: number } & Partial<LiveMetrics>;
      if (!p?.proxyId) return;
      const merge = (cur?: LiveMetrics): LiveMetrics => ({
        clients: p.clients ?? cur?.clients ?? 0,
        rxBps: p.rxBps ?? cur?.rxBps ?? 0,
        txBps: p.txBps ?? cur?.txBps ?? 0,
        rxBytes: p.rxBytes ?? cur?.rxBytes ?? '0',
        txBytes: p.txBytes ?? cur?.txBytes ?? '0',
        usedBytes: p.usedBytes ?? cur?.usedBytes,
        quotaPct: p.quotaPct ?? cur?.quotaPct ?? null,
        source: p.source ?? cur?.source ?? 'logs',
        sampledAt: p.sampledAt ?? new Date().toISOString(),
      });
      setMetricsMap(prev => ({ ...prev, [p.proxyId]: merge(prev[p.proxyId]) }));
      if (analyticsTarget?.id === p.proxyId) {
        setAnalyticsLive(prev => merge(prev ?? undefined));
      }
    },
  );

  useWSEvent(
    (msg) => msg.type === 'proxy.log',
    (msg) => {
      const p = msg.payload as {
        proxyId: number;
        clientIp?: string;
        rxBytes?: string;
        txBytes?: string;
        durationMs?: number | null;
        rxBps?: number;
        txBps?: number;
      };
      if (!p?.proxyId) return;
      const rx = Number(p.rxBytes || 0);
      const tx = Number(p.txBytes || 0);
      const durMs = Math.max(200, p.durationMs || 1000);
      const snapRxBps = p.rxBps ?? Math.round(rx * 1000 / durMs);
      const snapTxBps = p.txBps ?? Math.round(tx * 1000 / durMs);
      const livePatch: LiveMetrics = {
        clients: 0,
        rxBps: snapRxBps,
        txBps: snapTxBps,
        rxBytes: '0',
        txBytes: '0',
        usedBytes: '0',
        quotaPct: null,
        source: 'logs',
        sampledAt: new Date().toISOString(),
      };
      setMetricsMap(prev => {
        const cur = prev[p.proxyId];
        const used = BigInt(cur?.usedBytes || '0') + BigInt(rx) + BigInt(tx);
        const hasClient = !!(p.clientIp && p.clientIp !== '-' && p.clientIp !== '0.0.0.0');
        livePatch.clients = Math.max(cur?.clients ?? 0, hasClient ? 1 : 0);
        livePatch.rxBps = snapRxBps;
        livePatch.txBps = snapTxBps;
        livePatch.usedBytes = used.toString();
        livePatch.quotaPct = cur?.quotaPct ?? null;
        return { ...prev, [p.proxyId]: { ...cur, ...livePatch } as LiveMetrics };
      });
      if (analyticsTarget?.id === p.proxyId) {
        setAnalyticsLive(prev => {
          const cur = prev || livePatch;
          const used = BigInt(cur.usedBytes || '0') + BigInt(rx) + BigInt(tx);
          const hasClient = !!(p.clientIp && p.clientIp !== '-' && p.clientIp !== '0.0.0.0');
          return {
            ...cur,
            clients: Math.max(cur.clients ?? 0, hasClient ? 1 : 0),
            rxBps: snapRxBps,
            txBps: snapTxBps,
            usedBytes: used.toString(),
            source: 'logs',
            sampledAt: new Date().toISOString(),
          };
        });
      }
    },
  );

  useWSEvent(
    (msg) => msg.type === 'proxy.log',
    (msg) => {
      const p = msg.payload as { proxyId: number } & ProxyRequestLogRow;
      if (!p?.proxyId) return;

      if (logsTarget?.id === p.proxyId) {
        const line = `${p.ts}  ${p.clientIp}  ${p.destHost || '-'}:${p.destPort ?? '-'}  ↓${p.rxBytes} ↑${p.txBytes}  err=${p.errorCode ?? 0}`;
        setLogsText(prev => (prev ? `${line}\n${prev}` : line).slice(0, 120_000));
        setLogsLoading(false);
      }

      if (analyticsTarget?.id !== p.proxyId || analyticsTab !== 'logs') return;
      const hostQ = logHostFilter.trim().toLowerCase();
      if (hostQ && !(p.destHost || '').toLowerCase().includes(hostQ)) return;
      setLogRequests(prev => {
        const row: ProxyRequestLogRow = {
          id: Date.now(),
          ts: p.ts,
          clientIp: p.clientIp,
          destHost: p.destHost,
          destPort: p.destPort,
          rxBytes: p.rxBytes,
          txBytes: p.txBytes,
          errorCode: p.errorCode,
          durationMs: p.durationMs,
          service: p.service,
        };
        return [row, ...prev].slice(0, 100);
      });
      if (p.destHost) {
        setLogDomains(prev => {
          const idx = prev.findIndex(d => d.domain === p.destHost);
          const rx = BigInt(p.rxBytes || '0');
          const tx = BigInt(p.txBytes || '0');
          const add = rx + tx;
          if (idx >= 0) {
            const cur = prev[idx];
            const next = [...prev];
            next[idx] = {
              ...cur,
              hits: cur.hits + 1,
              rxBytes: (BigInt(cur.rxBytes) + rx).toString(),
              txBytes: (BigInt(cur.txBytes) + tx).toString(),
              totalBytes: (BigInt(cur.totalBytes) + add).toString(),
            };
            return next.sort((a, b) => b.hits - a.hits);
          }
          return [{
            domain: p.destHost!,
            hits: 1,
            rxBytes: rx.toString(),
            txBytes: tx.toString(),
            totalBytes: add.toString(),
          }, ...prev].slice(0, 20);
        });
      }
    },
    [analyticsTarget?.id, analyticsTab, logHostFilter, logsTarget?.id],
  );

  const loadLogs = async (proxyId: number, host?: string) => {
    setRequestLogsLoading(true);
    try {
      const hostQ = (host ?? logHostFilter).trim();
      const qs = new URLSearchParams({ limit: '50' });
      if (hostQ) qs.set('host', hostQ);
      const [reqs, domains] = await Promise.all([
        api.get<ProxyRequestLogRow[]>(`/api/proxies/${proxyId}/logs/requests?${qs}`),
        api.get<ProxyDomainStatRow[]>(`/api/proxies/${proxyId}/logs/domains?limit=15`),
      ]);
      setLogRequests(reqs);
      setLogDomains(domains);
    } catch {
      setLogRequests([]);
      setLogDomains([]);
    } finally {
      setRequestLogsLoading(false);
    }
  };

  const loadHistory = async (proxyId: number, period: typeof historyPeriod) => {
    setHistoryLoading(true);
    try {
      const rows = await api.get<TrafficHistoryPoint[]>(
        `/api/proxies/${proxyId}/metrics/history?period=${period}`,
      );
      setHistoryData(rows);
    } catch {
      setHistoryData([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  const openAnalytics = async (p: ProxyUser) => {
    setAnalyticsTarget(p);
    setAnalyticsTab('overview');
    setAnalyticsLive(metricsMap[p.id] || null);
    setAnalyticsUptime(null);
    setHistoryData([]);
    setHistoryPeriod('hour');
    setLogHostFilter('');
    setLogRequests([]);
    setLogDomains([]);
    setLimitsLoading(true);
    limitsForm.resetFields();
    try {
      const [live, uptime, limits] = await Promise.all([
        api.get<LiveMetrics & { proxyId: number }>(`/api/proxies/${p.id}/metrics/live`).catch(() => null),
        api.get<{ uptimePct: number | null; samples: number }>(`/api/proxies/${p.id}/uptime`).catch(() => null),
        api.get<ProxyLimitConfig>(`/api/proxies/${p.id}/limits`).catch(() => ({ enabled: false } as ProxyLimitConfig)),
        loadHistory(p.id, 'hour'),
      ]);
      if (live) {
        setAnalyticsLive(live);
        setMetricsMap(prev => ({ ...prev, [p.id]: live }));
      }
      if (uptime) setAnalyticsUptime(uptime);
      const lim = limits as ProxyLimitConfig;
      limitsForm.setFieldsValue({
        enabled: lim.enabled ?? false,
        quotaDailyGb: lim.quotaDailyMb ? lim.quotaDailyMb / 1024 : undefined,
        quotaWeeklyGb: lim.quotaWeeklyMb ? lim.quotaWeeklyMb / 1024 : undefined,
        quotaMonthlyGb: lim.quotaMonthlyMb ? lim.quotaMonthlyMb / 1024 : undefined,
        speedDownMbps: lim.speedDownKbps ? lim.speedDownKbps / 1000 : undefined,
        speedUpMbps: lim.speedUpKbps ? lim.speedUpKbps / 1000 : undefined,
        maxConnections: lim.maxConnections ?? undefined,
        weekdays: lim.allowedHours?.weekdays ?? '1-7',
        periods: lim.allowedHours?.periods?.join(', ') ?? '',
        expiresAt: lim.expiresAt ? dayjs(lim.expiresAt) : undefined,
      });
    } finally {
      setLimitsLoading(false);
    }
  };

  const saveLimits = async (vals: Record<string, unknown>) => {
    if (!analyticsTarget) return;
    setLimitsSaving(true);
    try {
      const periods = String(vals.periods || '').split(',').map(s => s.trim()).filter(Boolean);
      await api.patch(`/api/proxies/${analyticsTarget.id}/limits`, {
        enabled: vals.enabled,
        quotaDailyMb: vals.quotaDailyGb ? Math.round(Number(vals.quotaDailyGb) * 1024) : null,
        quotaWeeklyMb: vals.quotaWeeklyGb ? Math.round(Number(vals.quotaWeeklyGb) * 1024) : null,
        quotaMonthlyMb: vals.quotaMonthlyGb ? Math.round(Number(vals.quotaMonthlyGb) * 1024) : null,
        speedDownKbps: vals.speedDownMbps ? Math.round(Number(vals.speedDownMbps) * 1000) : null,
        speedUpKbps: vals.speedUpMbps ? Math.round(Number(vals.speedUpMbps) * 1000) : null,
        maxConnections: vals.maxConnections ?? null,
        allowedHours: periods.length || vals.weekdays
          ? { weekdays: vals.weekdays || '1-7', periods: periods.length ? periods : ['00:00:00-24:00:00'] }
          : null,
        expiresAt: vals.expiresAt ? (vals.expiresAt as { toISOString: () => string }).toISOString() : null,
      });
      msgApi.success('Đã lưu giới hạn và reload hub config');
    } catch (e: unknown) {
      msgApi.error(e instanceof Error ? e.message : 'Lỗi lưu giới hạn');
    } finally {
      setLimitsSaving(false);
    }
  };

  const stats = useMemo(() => ({
    total: proxies.length,
    running: proxies.filter(p => p.status === 'running').length,
    stopped: proxies.filter(p => p.status === 'stopped').length,
    error: proxies.filter(p => p.status === 'error').length,
  }), [proxies]);

  const filtered = useMemo(() => {
    return proxies.filter(p => {
      if (statusFilter !== 'all' && p.status !== statusFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!p.pppoeName.toLowerCase().includes(q) &&
            !p.username.toLowerCase().includes(q) &&
            !(p.publicIp || '').includes(search)) return false;
      }
      return true;
    });
  }, [proxies, search, statusFilter]);

  const wanByIdx = useMemo(() => new Map(wans.map(w => [w.index, w])), [wans]);

  const { pagination: tablePagination } = useTablePagination(
    20,
    ['10', '20', '50', '100'],
    total => `${total} proxy`,
    [search, statusFilter],
  );

  const reloadOne = async (id: number) => {
    setBusy(id);
    try {
      await api.post(`/api/proxies/${id}/reload-ip`);
      msgApi.success('Đã trigger reload IP');
    } catch (e: unknown) {
      msgApi.error(e instanceof Error ? e.message : 'Lỗi');
    } finally {
      setBusy(null);
      load();
    }
  };

  const testOne = async (id: number) => {
    setBusy(id);
    try {
      const r = await api.post<{ ok: boolean; latencyMs: number; exitIp: string | null; error: string | null }>(`/api/proxies/${id}/test`);
      if (r.ok) msgApi.success(`Container OK · ${r.latencyMs}ms · egress ${r.exitIp}`);
      else msgApi.error(r.error || 'Test fail');
    } catch (e: unknown) {
      msgApi.error(e instanceof Error ? e.message : 'Lỗi');
    } finally {
      setBusy(null);
      load();
    }
  };

  const restartOne = async (id: number) => {
    setBusy(id);
    try {
      await api.post(`/api/proxies/${id}/restart`);
      msgApi.success('Đã gửi lệnh restart');
    } catch (e: unknown) {
      msgApi.error(e instanceof Error ? e.message : 'Lỗi');
    } finally {
      setBusy(null);
      setTimeout(load, 3000);
    }
  };

  const toggleOne = async (p: ProxyUser) => {
    setBusy(p.id);
    try {
      if (p.enabled) await api.post(`/api/proxies/${p.id}/stop`);
      else await api.post(`/api/proxies/${p.id}/start`);
      msgApi.success('Đã cập nhật trạng thái');
    } catch (e: unknown) {
      msgApi.error(e instanceof Error ? e.message : 'Lỗi');
    } finally {
      setBusy(null);
      load();
    }
  };

  const removeOne = async (id: number) => {
    try {
      await api.del(`/api/proxies/${id}`);
      msgApi.success('Đã xoá proxy');
      load();
    } catch (e: unknown) {
      msgApi.error(e instanceof Error ? e.message : 'Lỗi');
    }
  };

  const revealPassword = async (id: number): Promise<string> => {
    const r = await api.get<{ password: string }>(`/api/proxies/${id}/password`);
    return r.password;
  };

  const copyToClipboard = async (text: string, label = 'Đã copy') => {
    try {
      await copyText(text);
      msgApi.success(label);
    } catch {
      msgApi.error('Copy thất bại — thử chọn text và Ctrl+C');
    }
  };

  const buildProxyString = (p: ProxyUser, kind: 'http' | 'socks5') => {
    const ip = p.publicIp;
    if (!ip) return '';
    const port = kind === 'http' ? p.extHttpPort : p.extSocksPort;
    if (!port) return '';
    const scheme = kind === 'http' ? 'http' : 'socks5';
    return `${scheme}://${p.username}:${p.password}@${ip}:${port}`;
  };

  const handleCreate = async (vals: Record<string, unknown>) => {
    try {
      await api.post('/api/proxies', vals);
      msgApi.success(`Đã tạo proxy cho pppoe-out${vals.pppoeIdx}`);
      setCreateOpen(false);
      createForm.resetFields();
      load();
    } catch (e: unknown) {
      msgApi.error(e instanceof Error ? e.message : 'Lỗi');
    }
  };

  const handleEdit = async (vals: Record<string, unknown>) => {
    if (!editTarget) return;
    try {
      await api.patch(`/api/proxies/${editTarget.id}`, vals);
      msgApi.success('Đã cập nhật');
      setEditTarget(null);
      load();
    } catch (e: unknown) {
      msgApi.error(e instanceof Error ? e.message : 'Lỗi');
    }
  };

  const bulk = async (action: 'start' | 'stop' | 'reload-ip' | 'test' | 'delete') => {
    setBulkBusy(true);
    try {
      const r = await api.post<{ results: Array<{ id: number; ok: boolean; error?: string }> }>('/api/proxies/bulk', { ids: selected, action });
      const failed = r.results.filter(x => !x.ok);
      if (failed.length === 0) msgApi.success(`Bulk ${action}: ${r.results.length}/${r.results.length} OK`);
      else msgApi.warning(`Bulk ${action}: ${r.results.length - failed.length} OK, ${failed.length} FAIL`);
      setSelected([]);
      load();
    } catch (e: unknown) {
      msgApi.error(e instanceof Error ? e.message : 'Lỗi');
    } finally {
      setBulkBusy(false);
    }
  };

  const handleExport = async (vals: Record<string, unknown>) => {
    try {
      const body = {
        ids: selected.length > 0 ? selected : undefined,
        format: vals.format,
        template: vals.template,
        includeSocks: vals.includeSocks,
        fileFormat: vals.fileFormat || undefined,
      };
      if (vals.fileFormat) {
        const r = await api.postExport(body);
        if ('downloaded' in r) {
          msgApi.success(`Đã tải ${r.filename}`);
        }
      } else {
        const r = await api.postExport(body) as { text: string; count: number };
        if (!r.text?.trim()) {
          msgApi.warning('Không có proxy nào có IP public để export');
          return;
        }
        await copyToClipboard(r.text, `Đã copy ${r.count} proxy (${vals.format})`);
      }
      setExportOpen(false);
    } catch (e: unknown) {
      msgApi.error(e instanceof Error ? e.message : 'Lỗi');
    }
  };

  const regenerateCreds = async () => {
    try {
      await api.post('/api/proxies/regenerate-credentials', {
        ids: selected.length > 0 ? selected : proxies.map(p => p.id),
      });
      msgApi.success('Đã regenerate password');
      load();
    } catch (e: unknown) {
      msgApi.error(e instanceof Error ? e.message : 'Lỗi');
    }
  };

  const credsTargetIds = selected.length > 0 ? selected : proxies.map(p => p.id);

  const openBulkCreds = () => {
    credsForm.resetFields();
    setCredsText('');
    setCredsMode('same');
    setCredsOpen(true);
  };

  const submitBulkCreds = async () => {
    setCredsBusy(true);
    try {
      if (credsMode === 'same') {
        const vals = await credsForm.validateFields();
        if (!vals.username?.trim() && !vals.password?.trim()) {
          msgApi.warning('Nhập username và/hoặc password');
          return;
        }
        if (credsTargetIds.length === 0) {
          msgApi.warning('Không có proxy nào');
          return;
        }
        const r = await api.post<{ updated: number; errors?: string[] }>('/api/proxies/bulk-update-credentials', {
          mode: 'same',
          ids: credsTargetIds,
          username: vals.username?.trim() || undefined,
          password: vals.password?.trim() || undefined,
        });
        msgApi.success(`Đã đổi credential cho ${r.updated} proxy`);
        if (r.errors?.length) {
          modal.warning({
            title: `Một số dòng bỏ qua (${r.errors.length})`,
            content: <pre className="proxy-logs-pre" style={{ maxHeight: 200, overflow: 'auto' }}>{r.errors.join('\n')}</pre>,
          });
        }
      } else {
        if (!credsText.trim()) {
          msgApi.warning('Dán danh sách idx:user:pass');
          return;
        }
        const r = await api.post<{ updated: number; errors?: string[] }>('/api/proxies/bulk-update-credentials', {
          mode: 'lines',
          text: credsText,
        });
        msgApi.success(`Đã đổi credential cho ${r.updated} proxy`);
        if (r.errors?.length) {
          modal.warning({
            title: `Một số dòng lỗi (${r.errors.length})`,
            content: <pre className="proxy-logs-pre" style={{ maxHeight: 200, overflow: 'auto' }}>{r.errors.join('\n')}</pre>,
          });
        }
      }
      setCredsOpen(false);
      load();
    } catch (e: unknown) {
      msgApi.error(e instanceof Error ? e.message : 'Lỗi');
    } finally {
      setCredsBusy(false);
    }
  };

  const showLogs = async (p: ProxyUser) => {
    setLogsTarget(p);
    setLogsLoading(true);
    setLogsText('');
    try {
      const r = await api.get<{ lines: string[] }>(`/api/proxies/${p.id}/logs/tail?lines=80`);
      setLogsText((r.lines || []).join('\n') || '(chờ request log realtime…)');
    } catch (e: unknown) {
      setLogsText(`[error: ${e instanceof Error ? e.message : 'unknown'}]\n(chờ WebSocket proxy.log…)`);
    } finally {
      setLogsLoading(false);
    }
  };

  const handleImport = async (text: string) => {
    try {
      const r = await api.post<{ created: number; skipped: number; errors: string[] }>('/api/proxies/import', { text });
      msgApi.success(`Đã tạo ${r.created}, bỏ qua ${r.skipped}`);
      if (r.errors.length > 0) {
        modal.warning({
          title: `Một số dòng lỗi (${r.errors.length})`,
          content: <pre className="proxy-logs-pre" style={{ maxHeight: 200, overflow: 'auto' }}>{r.errors.join('\n')}</pre>,
        });
      }
      setImportOpen(false);
      load();
    } catch (e: unknown) {
      msgApi.error(e instanceof Error ? e.message : 'Lỗi');
    }
  };

  const statusTag = (status: string | null | undefined) => {
    const map: Record<string, { color: string; icon?: ReactNode }> = {
      running: { color: 'success', icon: <CheckCircleOutlined /> },
      stopped: { color: 'default', icon: <PauseCircleOutlined /> },
      error: { color: 'error', icon: <WarningOutlined /> },
      pending: { color: 'processing' },
    };
    const m = map[status || ''] || { color: 'default' };
    return <Tag color={m.color} icon={m.icon} bordered={false}>{(status || 'unknown').toUpperCase()}</Tag>;
  };

  const columns = [
    {
      title: '#',
      key: 'idx',
      width: 48,
      render: (_: unknown, __: ProxyUser, i: number) => (
        <Text type="secondary" style={{ fontSize: 12 }}>{i + 1}</Text>
      ),
    },
    {
      title: 'PPPoE',
      dataIndex: 'pppoeName',
      key: 'pppoeName',
      width: 120,
      render: (v: string) => <Tag color="geekblue" bordered={false}>{v}</Tag>,
      sorter: (a: ProxyUser, b: ProxyUser) => a.pppoeIdx - b.pppoeIdx,
      defaultSortOrder: 'ascend' as const,
    },
    {
      title: 'Loại',
      dataIndex: 'proxyType',
      key: 'proxyType',
      width: 96,
      render: (v: string) => (
        <Tag color={v === 'both' ? 'cyan' : v === 'http' ? 'blue' : 'magenta'} bordered={false}>
          {v.toUpperCase()}
        </Tag>
      ),
    },
    {
      title: 'IP động',
      dataIndex: 'publicIp',
      key: 'publicIp',
      width: 140,
      render: (v: string | null) => (
        v
          ? <span className="proxy-endpoint-chip proxy-endpoint-chip--http" style={{ padding: '2px 8px', borderRadius: 4 }}>{v}</span>
          : <Text type="secondary">Chờ IP</Text>
      ),
    },
    {
      title: 'Cổng WAN',
      key: 'port',
      width: 160,
      render: (_: unknown, r: ProxyUser) => (
        <Flex vertical gap={4}>
          {r.proxyType !== 'socks5' && r.extHttpPort && (
            <Flex align="center" gap={6}>
              <Tag color="blue" bordered={false} style={{ margin: 0 }}>HTTP</Tag>
              <Text code style={{ fontSize: 12 }}>:{r.extHttpPort}</Text>
            </Flex>
          )}
          {r.proxyType !== 'http' && r.extSocksPort && (
            <Flex align="center" gap={6}>
              <Tag color="magenta" bordered={false} style={{ margin: 0 }}>SOCKS</Tag>
              <Text code style={{ fontSize: 12 }}>:{r.extSocksPort}</Text>
            </Flex>
          )}
        </Flex>
      ),
    },
    {
      title: 'Copy URL',
      key: 'quick',
      width: 120,
      render: (_: unknown, r: ProxyUser) => (
        <Space size={4}>
          {r.proxyType !== 'socks5' && r.extHttpPort && (
            <Tooltip title="Copy HTTP URL">
              <Button size="small" type="primary" icon={<CopyOutlined />}
                onClick={() => copyToClipboard(buildProxyString(r, 'http'), 'Đã copy HTTP URL')} />
            </Tooltip>
          )}
          {r.proxyType !== 'http' && r.extSocksPort && (
            <Tooltip title="Copy SOCKS5 URL">
              <Button size="small" icon={<CopyOutlined />}
                style={{ borderColor: '#EB2F96', color: '#C41D7F' }}
                onClick={() => copyToClipboard(buildProxyString(r, 'socks5'), 'Đã copy SOCKS5 URL')} />
            </Tooltip>
          )}
        </Space>
      ),
    },
    {
      title: 'User',
      dataIndex: 'username',
      key: 'username',
      width: 108,
      render: (v: string) => <Text code style={{ fontSize: 12 }}>{v}</Text>,
    },
    {
      title: 'Pass',
      key: 'password',
      width: 64,
      render: (_: unknown, r: ProxyUser) => (
        <Tooltip title="Copy password">
          <Button size="small" icon={<EyeOutlined />} onClick={async () => {
            try {
              const pw = await revealPassword(r.id);
              copyToClipboard(pw, 'Đã copy password');
            } catch (e: unknown) {
              msgApi.error(e instanceof Error ? e.message : 'Lỗi');
            }
          }} />
        </Tooltip>
      ),
    },
    {
      title: 'Clients',
      key: 'clients',
      width: 72,
      render: (_: unknown, r: ProxyUser) => {
        const m = metricsMap[r.id];
        const n = m?.clients ?? 0;
        return (
          <Tooltip title={m?.source === 'logs' ? 'Thiết bị có request qua proxy (5 phút gần nhất)' : 'Kết nối đang mở (admin)'}>
            <Text style={{ fontSize: 13 }}>{m ? n : '—'}</Text>
          </Tooltip>
        );
      },
    },
    {
      title: '↑ / ↓',
      key: 'speed',
      width: 130,
      render: (_: unknown, r: ProxyUser) => {
        const m = metricsMap[r.id];
        if (!m) return <Text type="secondary">—</Text>;
        return (
          <Tooltip title={m.source === 'logs' ? 'Tốc độ trung bình từ request log (2 phút gần nhất)' : 'Tốc độ realtime (admin)'}>
            <Flex vertical gap={2}>
              <Text style={{ fontSize: 11 }}>↑ {formatBps(m.txBps)}</Text>
              <Text style={{ fontSize: 11 }}>↓ {formatBps(m.rxBps)}</Text>
            </Flex>
          </Tooltip>
        );
      },
    },
    {
      title: 'Used',
      key: 'used',
      width: 100,
      render: (_: unknown, r: ProxyUser) => {
        const m = metricsMap[r.id];
        if (!m) return <Text type="secondary">—</Text>;
        const used = m.usedBytes
          ?? (BigInt(m.rxBytes || '0') + BigInt(m.txBytes || '0')).toString();
        return (
          <Tooltip title={m.source === 'logs' ? 'Tổng traffic hôm nay (từ request log)' : 'Active bytes (admin)'}>
            <Text style={{ fontSize: 12 }}>{formatBytes(used)}</Text>
          </Tooltip>
        );
      },
    },
    {
      title: 'Trạng thái',
      key: 'status',
      width: 108,
      render: (_: unknown, r: ProxyUser) => statusTag(r.status),
    },
    {
      title: 'Uptime',
      key: 'uptime',
      width: 96,
      render: (_: unknown, r: ProxyUser) => {
        const u = wanByIdx.get(r.pppoeIdx)?.uptime;
        return (
          <Text type={u ? undefined : 'secondary'} style={{ fontSize: 12 }}>
            {u || '—'}
          </Text>
        );
      },
    },
    {
      title: 'Latency',
      key: 'latency',
      width: 88,
      render: (_: unknown, r: ProxyUser) => (
        <Tooltip title={r.lastCheckAt ? `Kiểm tra: ${new Date(r.lastCheckAt).toLocaleString('vi-VN')}` : 'Chưa test'}>
          <Text style={{ fontSize: 13 }}>{r.lastLatencyMs ? `${r.lastLatencyMs} ms` : '—'}</Text>
        </Tooltip>
      ),
    },
    {
      title: 'Bật',
      key: 'enable',
      width: 64,
      render: (_: unknown, r: ProxyUser) => (
        <Switch checked={r.enabled} loading={busy === r.id} onChange={() => toggleOne(r)} size="small" />
      ),
    },
    {
      title: '',
      key: 'actions',
      width: 148,
      fixed: 'right' as const,
      render: (_: unknown, r: ProxyUser) => (
        <Space size={4}>
          <Tooltip title="Reload IP"><Button size="small" icon={<ReloadOutlined />} loading={busy === r.id} onClick={() => reloadOne(r.id)} /></Tooltip>
          <Tooltip title="Test"><Button size="small" icon={<ThunderboltOutlined />} loading={busy === r.id} onClick={() => testOne(r.id)} /></Tooltip>
          <Dropdown menu={{ items: [
            { key: 'restart', label: 'Restart container', icon: <ReloadOutlined />, onClick: () => restartOne(r.id) },
            { key: 'logs', label: 'Xem logs', icon: <FileTextOutlined />, onClick: () => showLogs(r) },
            { key: 'analytics', label: 'Analytics', icon: <ApiOutlined />, onClick: () => openAnalytics(r) },
            { key: 'copy_userpass', label: 'Copy user:pass', onClick: () => copyToClipboard(`${r.username}:${r.password}`, 'Đã copy user:pass') },
            { type: 'divider' },
            { key: 'edit', label: 'Sửa', icon: <EditOutlined />, onClick: () => { setEditTarget(r); editForm.setFieldsValue(r); } },
            { type: 'divider' },
            { key: 'del', label: 'Xoá', danger: true, icon: <DeleteOutlined />, onClick: () => {
              modal.confirm({
                title: `Xoá proxy ${r.pppoeName}?`,
                content: 'Container, veth và NAT sẽ bị xoá. PPPoE giữ nguyên.',
                okText: 'Xoá',
                okButtonProps: { danger: true },
                cancelText: 'Huỷ',
                onOk: () => removeOne(r.id),
              });
            }},
          ]}}>
            <Button size="small" icon={<MoreOutlined />} />
          </Dropdown>
        </Space>
      ),
    },
  ];

  const pppoeOptions = wans.map(w => ({ value: w.index, label: `${w.name} (${w.publicIp || 'chưa có IP'})` }));
  const statusOptions = [
    { label: 'Tất cả', value: 'all' },
    { label: 'Running', value: 'running' },
    { label: 'Stopped', value: 'stopped' },
    { label: 'Error', value: 'error' },
    { label: 'Pending', value: 'pending' },
  ];

  if (loading) {
    return (
      <ProxyPageShell
        title={<><ApiOutlined style={{ marginRight: 8, color: '#1677FF' }} />Quản lý Proxy</>}
        subtitle="Đang tải danh sách proxy…"
      >
        <Skeleton active paragraph={{ rows: 10 }} />
      </ProxyPageShell>
    );
  }

  return (
    <ProxyPageShell
      title={<><ApiOutlined style={{ marginRight: 8, color: '#1677FF' }} />Quản lý Proxy</>}
      subtitle={
        <>
          Chi tiết từng proxy: credential, cổng WAN <ProxyCode>{HTTP_PORT_BASE}+N</ProxyCode> / <ProxyCode>{SOCKS_PORT_BASE}+N</ProxyCode>, health và bulk ops.
        </>
      }
      stats={
        <ProxyStatsRow
          items={[
            { key: 'all', title: 'Tổng proxy', value: stats.total, prefix: <ApiOutlined style={{ color: '#1677FF' }} /> },
            { key: 'run', title: 'Running', value: stats.running, valueStyle: { color: '#52C41A' } },
            { key: 'stop', title: 'Stopped', value: stats.stopped },
            { key: 'err', title: 'Error', value: stats.error, valueStyle: stats.error ? { color: '#FF4D4F' } : undefined },
          ]}
        />
      }
      toolbar={
        <Card className="proxy-toolbar-card" style={{ marginBottom: 16 }}>
          <Flex gap={12} wrap="wrap" align="center" justify="space-between">
            <Flex gap={12} wrap="wrap" align="center" style={{ flex: 1 }}>
              <Input.Search
                placeholder="Tìm PPPoE, user, IP…"
                allowClear
                style={{ width: 240, maxWidth: '100%' }}
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              <Segmented
                options={statusOptions}
                value={statusFilter}
                onChange={v => setStatusFilter(v as string)}
              />
            </Flex>
            <Space wrap>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>Tạo</Button>
              <Button icon={<ImportOutlined />} onClick={() => { setImportText(''); setImportOpen(true); }}>Import</Button>
              <Button icon={<DownloadOutlined />} onClick={() => setExportOpen(true)} disabled={proxies.length === 0}>Export</Button>
              <Button icon={<KeyOutlined />} onClick={openBulkCreds} disabled={proxies.length === 0}>Đổi user/pass</Button>
              <Button icon={<ReloadOutlined />} onClick={regenerateCreds} disabled={proxies.length === 0}>Regenerate pass</Button>
            </Space>
          </Flex>
          {selected.length > 0 && (
            <>
              <Divider style={{ margin: '12px 0' }} />
              <Flex gap={8} wrap="wrap" align="center">
                <Tag color="blue" bordered={false}>Đã chọn {selected.length}</Tag>
                <Button loading={bulkBusy} onClick={() => bulk('start')}>Bật</Button>
                <Button loading={bulkBusy} onClick={() => bulk('stop')}>Tắt</Button>
                <Button loading={bulkBusy} onClick={() => bulk('reload-ip')}>Reload IP</Button>
                <Button loading={bulkBusy} onClick={() => bulk('test')}>Test</Button>
                <Button icon={<KeyOutlined />} onClick={openBulkCreds}>Đổi user/pass</Button>
                <Popconfirm title={`Xoá ${selected.length} proxy?`} onConfirm={() => bulk('delete')}>
                  <Button danger loading={bulkBusy}>Xoá</Button>
                </Popconfirm>
              </Flex>
            </>
          )}
        </Card>
      }
    >
      <Card className="proxy-table-card">
        <Table
          rowKey="id"
          dataSource={filtered}
          columns={columns}
          rowSelection={{
            selectedRowKeys: selected,
            onChange: keys => setSelected(keys as number[]),
          }}
          pagination={tablePagination}
          scroll={{ x: 1320 }}
          size="middle"
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  proxies.length === 0
                    ? 'Chưa có proxy — tạo mới hoặc import danh sách pppoe-out'
                    : 'Không có proxy khớp bộ lọc'
                }
              >
                {proxies.length === 0 && (
                  <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
                    Tạo proxy đầu tiên
                  </Button>
                )}
              </Empty>
            ),
          }}
        />
      </Card>

      <Modal title="Tạo proxy mới" open={createOpen} onCancel={() => setCreateOpen(false)} onOk={() => createForm.submit()} okText="Tạo proxy" width={520}>
        <Form form={createForm} layout="vertical" onFinish={handleCreate} initialValues={{ proxyType: 'both' }}>
          <Form.Item name="pppoeIdx" label="PPPoE interface" rules={[{ required: true, message: 'Chọn PPPoE' }]}>
            <Select options={pppoeOptions} placeholder="Chọn pppoe-out (từ out1)" showSearch optionFilterProp="label" />
          </Form.Item>
          <Form.Item name="proxyType" label="Giao thức">
            <Select options={[
              { value: 'http', label: 'HTTP only' },
              { value: 'socks5', label: 'SOCKS5 only' },
              { value: 'both', label: 'HTTP + SOCKS5' },
            ]} />
          </Form.Item>
          <Form.Item name="username" label="Username (để trống = tự sinh)"><Input placeholder="vd: u1234" /></Form.Item>
          <Form.Item name="password" label="Password (để trống = tự sinh)"><Input.Password /></Form.Item>
          <Form.Item name="note" label="Ghi chú"><Input.TextArea rows={2} maxLength={255} showCount /></Form.Item>
          <Text type="secondary">Container khởi tạo trong ~30–60 giây sau khi tạo.</Text>
        </Form>
      </Modal>

      <Modal title="Sửa proxy" open={!!editTarget} onCancel={() => setEditTarget(null)} onOk={() => editForm.submit()} okText="Lưu thay đổi">
        <Form form={editForm} layout="vertical" onFinish={handleEdit}>
          <Form.Item name="enabled" label="Enabled" valuePropName="checked"><Switch /></Form.Item>
          <Form.Item name="proxyType" label="Loại">
            <Select options={[
              { value: 'http', label: 'HTTP only' },
              { value: 'socks5', label: 'SOCKS5 only' },
              { value: 'both', label: 'Both' },
            ]} />
          </Form.Item>
          <Form.Item name="username" label="Username"><Input /></Form.Item>
          <Form.Item name="password" label="Password (để trống = giữ nguyên)"><Input.Password /></Form.Item>
          <Form.Item name="note" label="Ghi chú"><Input.TextArea rows={2} maxLength={255} showCount /></Form.Item>
        </Form>
      </Modal>

      <Modal title="Export proxy" open={exportOpen} onCancel={() => setExportOpen(false)} onOk={() => exportForm.submit()} okText="Export" width={560}>
        <Form form={exportForm} layout="vertical" onFinish={handleExport} initialValues={{ format: 'ipportuserpass', fileFormat: '', includeSocks: false }}>
          <Form.Item name="format" label="Định dạng">
            <Select options={[
              { value: 'ipportuserpass', label: 'ip:port:user:pass' },
              { value: 'userpassipport', label: 'user:pass@ip:port' },
              { value: 'httpurl', label: 'http://user:pass@ip:port' },
              { value: 'socks5url', label: 'socks5://user:pass@ip:port' },
              { value: 'ipport', label: 'ip:port (no auth)' },
              { value: 'template', label: 'Template tuỳ biến' },
            ]} />
          </Form.Item>
          <Form.Item shouldUpdate noStyle>
            {() => exportForm.getFieldValue('format') === 'template' && (
              <Form.Item name="template" label="Template" tooltip="{scheme} {ip} {port} {user} {pass}">
                <Input placeholder="{scheme}://{user}:{pass}@{ip}:{port}" />
              </Form.Item>
            )}
          </Form.Item>
          <Form.Item name="includeSocks" valuePropName="checked">
            <Switch checkedChildren="Include SOCKS" unCheckedChildren="HTTP only" />
          </Form.Item>
          <Form.Item name="fileFormat" label="Output">
            <Select options={[
              { value: '', label: 'Copy clipboard' },
              { value: 'txt', label: 'Tải .txt' },
              { value: 'csv', label: 'Tải .csv' },
              { value: 'json', label: 'Tải .json' },
            ]} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="Đổi user/pass hàng loạt"
        open={credsOpen}
        onCancel={() => setCredsOpen(false)}
        onOk={submitBulkCreds}
        okText="Áp dụng"
        confirmLoading={credsBusy}
        width={560}
      >
        <Segmented
          block
          style={{ marginBottom: 12 }}
          value={credsMode}
          onChange={v => setCredsMode(v as 'same' | 'lines')}
          options={[
            { value: 'same', label: 'Cùng user/pass' },
            { value: 'lines', label: 'Theo dòng' },
          ]}
        />
        {credsMode === 'same' ? (
          <>
            <Alert
              type="info"
              showIcon
              message={selected.length > 0
                ? `Áp dụng cho ${selected.length} proxy đã chọn`
                : `Áp dụng cho tất cả ${proxies.length} proxy`}
              style={{ marginBottom: 12 }}
            />
            <Form form={credsForm} layout="vertical">
              <Form.Item
                name="username"
                label="Username mới"
                rules={[{
                  validator: (_, v) => !v?.trim() || /^[a-zA-Z0-9_-]{3,32}$/.test(v.trim())
                    ? Promise.resolve()
                    : Promise.reject(new Error('3–32 ký tự, chữ/số/_/-')),
                }]}
              >
                <Input placeholder="Để trống = giữ username cũ" />
              </Form.Item>
              <Form.Item
                name="password"
                label="Password mới"
                rules={[{
                  validator: (_, v) => !v?.trim() || (v.trim().length >= 6 && v.trim().length <= 64)
                    ? Promise.resolve()
                    : Promise.reject(new Error('6–64 ký tự')),
                }]}
              >
                <Input.Password placeholder="Để trống = giữ password cũ" />
              </Form.Item>
            </Form>
          </>
        ) : (
          <>
            <Alert
              type="info"
              showIcon
              message="Mỗi dòng: idx:user:pass hoặc pppoe-outN:user:pass"
              style={{ marginBottom: 12 }}
            />
            <Input.TextArea
              rows={10}
              value={credsText}
              onChange={e => setCredsText(e.target.value)}
              placeholder={'1:myuser1:secret12\npppoe-out2:myuser2:secret34\n3:client3:pass5678'}
            />
          </>
        )}
      </Modal>

      <Modal
        title="Import proxy hàng loạt"
        open={importOpen}
        onCancel={() => setImportOpen(false)}
        onOk={() => { if (importText.trim()) handleImport(importText); }}
        okText="Import"
        width={520}
      >
        <Alert type="info" showIcon message="Mỗi dòng = 1 pppoe idx (vd: 3) hoặc tên pppoe-out3" style={{ marginBottom: 12 }} />
        <Input.TextArea rows={10} value={importText} onChange={e => setImportText(e.target.value)} placeholder={'3\npppoe-out5\n11'} />
      </Modal>

      <Drawer title={logsTarget ? `Logs · ${logsTarget.containerName}` : 'Logs'} open={!!logsTarget} onClose={() => setLogsTarget(null)} width={720}>
        {logsLoading ? <Skeleton active paragraph={{ rows: 8 }} /> : (
          <pre className="proxy-logs-pre">{logsText || '(empty)'}</pre>
        )}
      </Drawer>

      <Drawer
        title={analyticsTarget ? `Analytics · ${analyticsTarget.username}` : 'Analytics'}
        open={!!analyticsTarget}
        onClose={() => setAnalyticsTarget(null)}
        width={600}
        extra={
          <Segmented
            value={analyticsTab}
            onChange={v => {
              const tab = v as 'overview' | 'limits' | 'logs';
              setAnalyticsTab(tab);
              if (tab === 'logs' && analyticsTarget) loadLogs(analyticsTarget.id);
            }}
            options={[
              { label: 'Overview', value: 'overview' },
              { label: 'Limits', value: 'limits' },
              { label: 'Logs', value: 'logs' },
            ]}
          />
        }
      >
        {analyticsTarget && analyticsTab === 'overview' && (
          <Flex vertical gap={16}>
            <Alert
              type="info"
              showIcon
              message="Realtime qua WebSocket (request log)"
              description="Clients / tốc độ / Used cập nhật ngay khi có request qua proxy. HTTPS/SOCKS chỉ thấy hostname:port, không có URL path."
            />
            {analyticsLive ? (
              <>
                <Card size="small" title="Realtime">
                  <Flex gap={24} wrap="wrap">
                    <div>
                      <Text type="secondary">Clients</Text>
                      <div><Text strong style={{ fontSize: 22 }}>{analyticsLive.clients}</Text></div>
                    </div>
                    <div>
                      <Text type="secondary">Upload ↑</Text>
                      <div><Text strong>{formatBps(analyticsLive.txBps)}</Text></div>
                    </div>
                    <div>
                      <Text type="secondary">Download ↓</Text>
                      <div><Text strong>{formatBps(analyticsLive.rxBps)}</Text></div>
                    </div>
                    <div>
                      <Text type="secondary">Used hôm nay</Text>
                      <div>
                        <Text strong>
                          {formatBytes(
                            analyticsLive.usedBytes
                              ?? (BigInt(analyticsLive.rxBytes || '0') + BigInt(analyticsLive.txBytes || '0')).toString(),
                          )}
                        </Text>
                      </div>
                    </div>
                  </Flex>
                  {analyticsLive.quotaPct != null && (
                    <div style={{ marginTop: 16 }}>
                      <Text type="secondary">Quota used (countall)</Text>
                      <Progress
                        percent={Math.min(100, analyticsLive.quotaPct)}
                        status={analyticsLive.quotaPct >= 90 ? 'exception' : 'active'}
                        format={p => `${p}%`}
                      />
                    </div>
                  )}
                  {analyticsLive.sampledAt && (
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      Cập nhật: {new Date(analyticsLive.sampledAt).toLocaleString('vi-VN')}
                    </Text>
                  )}
                </Card>
                <Card size="small" title="Uptime (24h)">
                  {analyticsUptime?.uptimePct != null ? (
                    <Progress percent={analyticsUptime.uptimePct} size="small" />
                  ) : (
                    <Text type="secondary">Chưa đủ dữ liệu health check</Text>
                  )}
                  {analyticsUptime && (
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      {analyticsUptime.samples} mẫu / 24h
                    </Text>
                  )}
                </Card>
                <Card
                  size="small"
                  title="Lịch sử traffic"
                  extra={
                    <Segmented
                      size="small"
                      value={historyPeriod}
                      onChange={v => {
                        const period = v as typeof historyPeriod;
                        setHistoryPeriod(period);
                        if (analyticsTarget) loadHistory(analyticsTarget.id, period);
                      }}
                      options={[
                        { label: 'Giờ', value: 'hour' },
                        { label: 'Ngày', value: 'day' },
                        { label: 'Tuần', value: 'week' },
                        { label: 'Tháng', value: 'month' },
                      ]}
                    />
                  }
                >
                  {historyLoading ? (
                    <Skeleton active paragraph={{ rows: 4 }} />
                  ) : (
                    <ProxyTrafficChart data={historyData} period={historyPeriod} />
                  )}
                </Card>
              </>
            ) : (
              <Skeleton active paragraph={{ rows: 4 }} />
            )}
          </Flex>
        )}

        {analyticsTarget && analyticsTab === 'logs' && (
          <Flex vertical gap={16}>
            <Alert
              type="info"
              showIcon
              message="Request log từ 3proxy hub"
              description="Hostname:port từ CONNECT — không có URL path. Live qua WebSocket proxy.log."
            />
            <Input.Search
              placeholder="Lọc hostname (vd: httpbin.org)"
              allowClear
              value={logHostFilter}
              onChange={e => setLogHostFilter(e.target.value)}
              onSearch={() => analyticsTarget && loadLogs(analyticsTarget.id)}
            />
            <Card size="small" title="Top domains (hôm nay)" extra={
              <Button size="small" icon={<ReloadOutlined />} onClick={() => analyticsTarget && loadLogs(analyticsTarget.id)} />
            }>
              {requestLogsLoading ? <Skeleton active paragraph={{ rows: 3 }} /> : logDomains.length ? (
                <Table
                  size="small"
                  pagination={false}
                  rowKey="domain"
                  dataSource={logDomains}
                  columns={[
                    { title: 'Domain', dataIndex: 'domain', ellipsis: true },
                    { title: 'Hits', dataIndex: 'hits', width: 64 },
                    {
                      title: 'Traffic',
                      key: 'bytes',
                      render: (_: unknown, r: ProxyDomainStatRow) => formatBytes(r.totalBytes),
                    },
                  ]}
                />
              ) : <Empty description="Chưa có domain stats" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
            </Card>
            <Card size="small" title="Requests gần đây">
              {requestLogsLoading ? <Skeleton active paragraph={{ rows: 6 }} /> : (
                <Table
                  size="small"
                  rowKey={r => `${r.id}-${r.ts}`}
                  dataSource={logRequests}
                  pagination={{ pageSize: 15, size: 'small' }}
                  scroll={{ x: 520 }}
                  locale={{ emptyText: 'Chưa có request log — chờ tailer hoặc tạo traffic' }}
                  columns={[
                    {
                      title: 'Thời gian',
                      dataIndex: 'ts',
                      width: 150,
                      render: (v: string) => new Date(v).toLocaleString('vi-VN'),
                    },
                    { title: 'Client', dataIndex: 'clientIp', width: 110, ellipsis: true },
                    {
                      title: 'Đích',
                      key: 'dest',
                      render: (_: unknown, r: ProxyRequestLogRow) => (
                        <Text ellipsis style={{ maxWidth: 160 }}>
                          {r.destHost || '—'}{r.destPort ? `:${r.destPort}` : ''}
                        </Text>
                      ),
                    },
                    {
                      title: '↓/↑',
                      key: 'bytes',
                      width: 100,
                      render: (_: unknown, r: ProxyRequestLogRow) => (
                        <Text type="secondary" style={{ fontSize: 11 }}>
                          {formatBytes(r.rxBytes)} / {formatBytes(r.txBytes)}
                        </Text>
                      ),
                    },
                    {
                      title: 'ms',
                      dataIndex: 'durationMs',
                      width: 56,
                      render: (v: number | null) => v ?? '—',
                    },
                    {
                      title: 'Err',
                      dataIndex: 'errorCode',
                      width: 52,
                      render: (v: number) => v === 0
                        ? <Tag color="success">OK</Tag>
                        : <Tag color="error">{v}</Tag>,
                    },
                  ]}
                />
              )}
            </Card>
          </Flex>
        )}

        {analyticsTarget && analyticsTab === 'limits' && (
          limitsLoading ? <Skeleton active paragraph={{ rows: 8 }} /> : (
            <Form form={limitsForm} layout="vertical" onFinish={saveLimits}>
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 16 }}
                message="Giới hạn áp dụng qua 3proxy cfg"
                description="Lưu sẽ regen hub config và gửi SIGUSR1 reload. Quota dùng countall (MB). Tốc độ dùng bandlimin/out (Kbps→bps)."
              />
              <Form.Item name="enabled" label="Bật giới hạn" valuePropName="checked">
                <Switch />
              </Form.Item>
              <Flex gap={12}>
                <Form.Item name="quotaDailyGb" label="Quota ngày (GB)" style={{ flex: 1 }}>
                  <InputNumber min={0} step={0.5} style={{ width: '100%' }} placeholder="—" />
                </Form.Item>
                <Form.Item name="quotaWeeklyGb" label="Quota tuần (GB)" style={{ flex: 1 }}>
                  <InputNumber min={0} step={1} style={{ width: '100%' }} placeholder="—" />
                </Form.Item>
              </Flex>
              <Form.Item name="quotaMonthlyGb" label="Quota tháng (GB)">
                <InputNumber min={0} step={5} style={{ width: '100%' }} placeholder="—" />
              </Form.Item>
              <Flex gap={12}>
                <Form.Item name="speedDownMbps" label="Tốc độ ↓ (Mbps)" style={{ flex: 1 }}>
                  <InputNumber min={0} step={1} style={{ width: '100%' }} placeholder="—" />
                </Form.Item>
                <Form.Item name="speedUpMbps" label="Tốc độ ↑ (Mbps)" style={{ flex: 1 }}>
                  <InputNumber min={0} step={1} style={{ width: '100%' }} placeholder="—" />
                </Form.Item>
              </Flex>
              <Form.Item name="maxConnections" label="Max kết nối đồng thời">
                <InputNumber min={0} max={500} style={{ width: '100%' }} placeholder="—" />
              </Form.Item>
              <Form.Item name="weekdays" label="Ngày trong tuần" tooltip="0/7=CN, 1=T2, 1-5=T2–T6">
                <Input placeholder="1-5 hoặc 1,2,3,4,5,6,7" />
              </Form.Item>
              <Form.Item name="periods" label="Khung giờ" tooltip="Phân tách bằng dấu phẩy, vd: 08:00:00-22:00:00">
                <Input placeholder="08:00:00-22:00:00" />
              </Form.Item>
              <Form.Item name="expiresAt" label="Ngày hết hạn gói">
                <DatePicker showTime style={{ width: '100%' }} />
              </Form.Item>
              <Button type="primary" htmlType="submit" loading={limitsSaving} block>
                Lưu & áp dụng lên hub
              </Button>
            </Form>
          )
        )}
      </Drawer>
    </ProxyPageShell>
  );
}