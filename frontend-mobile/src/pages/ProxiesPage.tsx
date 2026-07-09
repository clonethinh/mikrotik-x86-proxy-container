import { useEffect, useMemo, useState } from 'react';
import {
  Button, Chip, Drawer, Input, Label, ListBox, Modal, NumberField, Select,
  Switch, Tabs, TextArea, TextField, toast,
} from '@heroui/react';
import { api, ProxyUser, WanInfo } from '../services/api';
import { useWSEvent } from '../services/ws';
import { copyText } from '../lib/clipboard';
import { formatBps, formatBytesLabel, formatDateTime, formatLatency } from '../lib/format';
import { mergeLiveMetrics } from '../lib/liveMetricsMerge';
import { effectiveLatencyMs, isLatencyStale } from '../lib/proxyLatency';
import { formatProxy, proxyStatusColor } from '../lib/proxyUtils';
import {
  PROXY_LIST_RELOAD, type AnalyticsTab, type HistoryPeriod, type LiveMetrics,
  type ProxyDomainStatRow, type ProxyLimitConfig, type ProxyRequestLogRow, type TrafficHistoryPoint,
} from '../types/proxies';
import MobileHeader from '../components/layout/MobileHeader';
import PageLayout from '../components/layout/PageLayout';
import LoadingScreen from '../components/ui/LoadingScreen';
import EmptyState from '../components/ui/EmptyState';
import KvList from '../components/ui/KvList';
import FilterChip from '../components/ui/FilterChip';
import DualTrafficChart from '../components/charts/DualTrafficChart';
import HorizontalBarChart from '../components/charts/HorizontalBarChart';
import { seriesFromHistory } from '../lib/chartUtils';
import ListPageTop from '../components/ui/ListPageTop';
import PageToolbarInline from '../components/ui/PageToolbarInline';
import ListCard from '../components/ui/ListCard';
import ActionBar from '../components/ui/ActionBar';
import RecordList from '../components/ui/RecordList';
import DismissibleAlert from '../components/ui/DismissibleAlert';
import ConfirmModal from '../components/ui/ConfirmModal';
import PaginationBar from '../components/ui/PaginationBar';
import ProxiesDataTable from '../components/wide/ProxiesDataTable';
import ProxyConnectionDrawer from '../components/proxies/ProxyConnectionDrawer';
import IpQualityTag from '../components/IpQualityTag';
import EgressTag from '../components/EgressTag';
import { resolveIpQuality } from '../lib/ipQuality';
import { useWideLayout } from '../hooks/useWideLayout';
import { useListPagination } from '../hooks/useListPagination';
import { IconProxy } from '../components/ui/Icons';

const STATUS_FILTERS = ['all', 'running', 'stopped', 'error', 'pending'] as const;

export default function ProxiesPage() {
  const [proxies, setProxies] = useState<ProxyUser[]>([]);
  const [wans, setWans] = useState<WanInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selected, setSelected] = useState<number[]>([]);
  const [busy, setBusy] = useState<number | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const wide = useWideLayout();
  const [metricsMap, setMetricsMap] = useState<Record<number, LiveMetrics>>({});
  const [detail, setDetail] = useState<ProxyUser | null>(null);
  const [connectionTarget, setConnectionTarget] = useState<ProxyUser | null>(null);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [analyticsTarget, setAnalyticsTarget] = useState<ProxyUser | null>(null);
  const [analyticsTab, setAnalyticsTab] = useState<AnalyticsTab>('overview');
  const [analyticsLive, setAnalyticsLive] = useState<LiveMetrics | null>(null);
  const [historyPeriod, setHistoryPeriod] = useState<HistoryPeriod>('hour');
  const [historyData, setHistoryData] = useState<TrafficHistoryPoint[]>([]);
  const [limits, setLimits] = useState<ProxyLimitConfig>({ enabled: false });
  const [limitsSaving, setLimitsSaving] = useState(false);
  const [logRequests, setLogRequests] = useState<ProxyRequestLogRow[]>([]);
  const [logDomains, setLogDomains] = useState<ProxyDomainStatRow[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [createPppoeIdx, setCreatePppoeIdx] = useState(2);
  const [createType, setCreateType] = useState('both');
  const [createForm, setCreateForm] = useState({ username: '', password: '', note: '' });
  const [editForm, setEditForm] = useState({ username: '', password: '', note: '', proxyType: 'both', enabled: true });
  const [exportFormat, setExportFormat] = useState('ipportuserpass');
  const [exportTemplate, setExportTemplate] = useState('');
  const [exportIncludeSocks, setExportIncludeSocks] = useState(true);
  const [exportFileFormat, setExportFileFormat] = useState<string>('');
  const [revealedPass, setRevealedPass] = useState<string | null>(null);
  const [credsOpen, setCredsOpen] = useState(false);
  const [credsMode, setCredsMode] = useState<'same' | 'lines'>('same');
  const [credsText, setCredsText] = useState('');
  const [credsUsername, setCredsUsername] = useState('');
  const [credsPassword, setCredsPassword] = useState('');
  const [credsBusy, setCredsBusy] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [logsTarget, setLogsTarget] = useState<ProxyUser | null>(null);
  const [logsText, setLogsText] = useState('');
  const [logsLoading, setLogsLoading] = useState(false);
  const [importErrorsOpen, setImportErrorsOpen] = useState(false);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [analyticsUptime, setAnalyticsUptime] = useState<{ uptimePct: number | null; samples: number } | null>(null);
  const [logHostFilter, setLogHostFilter] = useState('');

  const loadMetrics = async () => {
    try {
      const rows = await api.get<Array<LiveMetrics & { proxyId: number }>>('/api/proxies/metrics/live-all');
      const map: Record<number, LiveMetrics> = {};
      for (const r of rows) if (r?.proxyId) map[r.proxyId] = r;
      setMetricsMap(map);
    } catch { /* ignore */ }
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
    const t = setInterval(() => { loadMetrics(); }, 5_000);
    return () => clearInterval(t);
  }, []);

  const patchMetrics = (proxyId: number, patch: Partial<LiveMetrics>) => {
    setMetricsMap((prev) => ({
      ...prev,
      [proxyId]: mergeLiveMetrics(prev[proxyId], patch),
    }));
    if (analyticsTarget?.id === proxyId) {
      setAnalyticsLive((prev) => mergeLiveMetrics(prev ?? undefined, patch));
    }
  };

  const applyLatency = (proxyId: number, latencyMs: number, pppoeIdx?: number) => {
    const at = new Date().toISOString();
    setProxies((prev) => {
      const row = prev.find((x) => x.id === proxyId);
      const idx = pppoeIdx ?? row?.pppoeIdx;
      if (idx != null) {
        setWans((wprev) => wprev.map((w) => (
          w.index === idx ? { ...w, lastLatencyMs: latencyMs, lastCheckAt: at } : w
        )));
      }
      return prev.map((x) => (
        x.id === proxyId ? { ...x, lastLatencyMs: latencyMs, lastCheckAt: at } : x
      ));
    });
    setDetail((d) => (d?.id === proxyId ? { ...d, lastLatencyMs: latencyMs, lastCheckAt: at } : d));
    setConnectionTarget((c) => (c?.id === proxyId ? { ...c, lastLatencyMs: latencyMs, lastCheckAt: at } : c));
  };

  useWSEvent((msg) => PROXY_LIST_RELOAD.has(msg.type) || msg.type === 'wan.sync', () => load());

  useWSEvent((msg) => msg.type === 'proxy.metrics', (msg) => {
    const p = msg.payload as { proxyId: number } & Partial<LiveMetrics>;
    if (!p?.proxyId) return;
    const { proxyId, ...patch } = p;
    patchMetrics(proxyId, { ...patch, sampledAt: patch.sampledAt ?? new Date().toISOString() });
  });

  useWSEvent((msg) => msg.type === 'proxy.log', (msg) => {
    const p = msg.payload as { proxyId: number } & Partial<ProxyRequestLogRow> & {
      clientIp?: string; rxBytes?: string; txBytes?: string; durationMs?: number | null;
      rxBps?: number; txBps?: number;
    };
    if (!p?.proxyId) return;

    const rx = Number(p.rxBytes || 0);
    const tx = Number(p.txBytes || 0);
    const durMs = Math.max(200, p.durationMs || 1000);
    const snapRxBps = p.rxBps ?? Math.round(rx * 1000 / durMs);
    const snapTxBps = p.txBps ?? Math.round(tx * 1000 / durMs);
    const hasClient = !!(p.clientIp && p.clientIp !== '-' && p.clientIp !== '0.0.0.0');
    patchMetrics(p.proxyId, {
      rxBps: snapRxBps,
      txBps: snapTxBps,
      rxBytes: String(rx),
      txBytes: String(tx),
      clients: hasClient ? 1 : undefined,
      source: 'logs',
      sampledAt: new Date().toISOString(),
    });
  });

  useWSEvent((msg) => msg.type === 'proxy.health', (msg) => {
    const p = msg.payload as { id: number; ok: boolean; latencyMs?: number | null; pingMs?: number | null };
    if (!p?.id || !p.ok) return;
    const ms = p.pingMs ?? p.latencyMs;
    if (ms == null) return;
    applyLatency(p.id, ms);
  });

  useWSEvent((msg) => msg.type === 'proxy.applied' || msg.type === 'wan.internet-up', (msg) => {
    const p = msg.payload as { id?: number; proxyId?: number; pingMs?: number | null; pppoeIdx?: number };
    if (p.pingMs == null) return;
    const proxyId = p.id ?? p.proxyId;
    if (proxyId) {
      applyLatency(proxyId, p.pingMs, p.pppoeIdx);
    } else if (p.pppoeIdx != null) {
      const at = new Date().toISOString();
      setWans((prev) => prev.map((w) => (
        w.index === p.pppoeIdx ? { ...w, lastLatencyMs: p.pingMs!, lastCheckAt: at } : w
      )));
    }
  });

  useWSEvent(
    (msg) => msg.type === 'proxy.log',
    (msg) => {
      const p = msg.payload as { proxyId: number } & Partial<ProxyRequestLogRow> & {
        clientIp?: string; rxBytes?: string; txBytes?: string; durationMs?: number | null;
        rxBps?: number; txBps?: number;
      };
      if (!p?.proxyId) return;

      if (logsTarget?.id === p.proxyId) {
        const line = `${p.ts || new Date().toISOString()}  ${p.clientIp || '-'}  ${p.destHost || '-'}:${p.destPort ?? '-'}  ↓${p.rxBytes || 0} ↑${p.txBytes || 0}`;
        setLogsText((prev) => (prev ? `${line}\n${prev}` : line).slice(0, 120_000));
        setLogsLoading(false);
      }

      if (analyticsTarget?.id !== p.proxyId || analyticsTab !== 'logs') return;
      const hostQ = logHostFilter.trim().toLowerCase();
      if (hostQ && !(p.destHost || '').toLowerCase().includes(hostQ)) return;
      setLogRequests((prev) => {
        const row: ProxyRequestLogRow = {
          id: Date.now(),
          ts: p.ts || new Date().toISOString(),
          clientIp: p.clientIp || '-',
          destHost: p.destHost ?? null,
          destPort: p.destPort ?? null,
          rxBytes: p.rxBytes || '0',
          txBytes: p.txBytes || '0',
          errorCode: p.errorCode ?? 0,
          durationMs: p.durationMs ?? null,
          service: p.service ?? null,
        };
        return [row, ...prev].slice(0, 100);
      });
    },
    [analyticsTarget?.id, analyticsTab, logHostFilter, logsTarget?.id],
  );

  const stats = useMemo(() => ({
    total: proxies.length,
    running: proxies.filter((p) => p.status === 'running').length,
    stopped: proxies.filter((p) => p.status === 'stopped').length,
    error: proxies.filter((p) => p.status === 'error').length,
    pending: proxies.filter((p) => p.status === 'pending').length,
  }), [proxies]);

  const wanByIdx = useMemo(() => new Map(wans.map((w) => [w.index, w])), [wans]);

  const filtered = useMemo(() => proxies.filter((p) => {
    if (statusFilter !== 'all' && p.status !== statusFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      if (!p.pppoeName.toLowerCase().includes(q) && !p.username.toLowerCase().includes(q) && !(p.publicIp || '').includes(search)) return false;
    }
    return true;
  }), [proxies, search, statusFilter]);

  const filterKey = `${search}|${statusFilter}`;
  const {
    slice: pageRows, page, setPage, pageSize, setPageSize, total: pageTotal, pageCount,
  } = useListPagination(filtered, wide ? 20 : filtered.length, filterKey);

  const toggleSelect = (id: number) => {
    setSelected((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };

  const toggleSelectAll = (checked: boolean) => {
    if (!checked) {
      setSelected((prev) => prev.filter((id) => !pageRows.some((r) => r.id === id)));
      return;
    }
    setSelected((prev) => [...new Set([...prev, ...pageRows.map((r) => r.id)])]);
  };

  const openDetail = (p: ProxyUser) => {
    setDetail(p);
    setRevealedPass(null);
  };

  const openAnalytics = async (p: ProxyUser) => {
    setAnalyticsTarget(p);
    setAnalyticsOpen(true);
    setAnalyticsTab('overview');
    setAnalyticsLive(metricsMap[p.id] || null);
    setAnalyticsUptime(null);
    setHistoryPeriod('hour');
    setLogHostFilter('');
    try {
      const [live, uptime, lim, hist, reqs, domains] = await Promise.all([
        api.get<LiveMetrics & { proxyId: number }>(`/api/proxies/${p.id}/metrics/live`).catch(() => null),
        api.get<{ uptimePct: number | null; samples: number }>(`/api/proxies/${p.id}/uptime`).catch(() => null),
        api.get<ProxyLimitConfig>(`/api/proxies/${p.id}/limits`).catch(() => ({ enabled: false })),
        api.get<TrafficHistoryPoint[]>(`/api/proxies/${p.id}/metrics/history?period=hour`).catch(() => []),
        api.get<ProxyRequestLogRow[]>(`/api/proxies/${p.id}/logs/requests?limit=30`).catch(() => []),
        api.get<ProxyDomainStatRow[]>(`/api/proxies/${p.id}/logs/domains?limit=10`).catch(() => []),
      ]);
      if (live) setAnalyticsLive(live);
      if (uptime) setAnalyticsUptime(uptime);
      setLimits(lim);
      setHistoryData(hist);
      setLogRequests(reqs);
      setLogDomains(domains);
    } catch { /* ignore */ }
  };

  const loadLogs = async (proxyId: number, host?: string) => {
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
    }
  };

  const showLogs = async (p: ProxyUser) => {
    setLogsTarget(p);
    setLogsOpen(true);
    setLogsLoading(true);
    setLogsText('');
    try {
      const r = await api.get<{ lines: string[] }>(`/api/proxies/${p.id}/logs/tail?lines=80`);
      setLogsText((r.lines || []).join('\n') || '(chờ request log realtime…)');
    } catch (e) {
      setLogsText(`[error: ${e instanceof Error ? e.message : 'unknown'}]\n(chờ WebSocket proxy.log…)`);
    } finally {
      setLogsLoading(false);
    }
  };

  const loadHistory = async (proxyId: number, period: HistoryPeriod) => {
    setHistoryPeriod(period);
    try {
      setHistoryData(await api.get<TrafficHistoryPoint[]>(`/api/proxies/${proxyId}/metrics/history?period=${period}`));
    } catch {
      setHistoryData([]);
    }
  };

  const saveLimits = async () => {
    if (!analyticsTarget) return;
    setLimitsSaving(true);
    try {
      const periods = (limits.allowedHours?.periods ?? []).filter(Boolean);
      await api.patch(`/api/proxies/${analyticsTarget.id}/limits`, {
        enabled: limits.enabled,
        quotaDailyMb: limits.quotaDailyMb ?? null,
        quotaWeeklyMb: limits.quotaWeeklyMb ?? null,
        quotaMonthlyMb: limits.quotaMonthlyMb ?? null,
        speedDownKbps: limits.speedDownKbps ?? null,
        speedUpKbps: limits.speedUpKbps ?? null,
        maxConnections: limits.maxConnections ?? null,
        allowedHours: periods.length || limits.allowedHours?.weekdays
          ? { weekdays: limits.allowedHours?.weekdays || '1-7', periods: periods.length ? periods : ['00:00:00-24:00:00'] }
          : null,
        expiresAt: limits.expiresAt ?? null,
      });
      toast.success('Đã lưu giới hạn và reload hub config');
    } catch (e) {
      toast.danger(e instanceof Error ? e.message : 'Lỗi');
    } finally {
      setLimitsSaving(false);
    }
  };

  const action = async (id: number, path: string, label: string) => {
    setBusy(id);
    try {
      await api.post(path);
      toast.success(label);
      load();
    } catch (e) {
      toast.danger(e instanceof Error ? e.message : 'Lỗi');
    } finally {
      setBusy(null);
    }
  };

  const testOne = async (p: ProxyUser) => {
    setBusy(p.id);
    try {
      const r = await api.post<{ ok: boolean; latencyMs: number; exitIp: string | null; error: string | null }>(`/api/proxies/${p.id}/test`);
      if (r.ok) {
        applyLatency(p.id, r.latencyMs, p.pppoeIdx);
        toast.success(`Test OK · ${r.latencyMs}ms · ${r.exitIp || p.publicIp}`);
      } else {
        toast.danger(r.error || 'Test fail');
      }
      load();
    } catch (e) {
      toast.danger(e instanceof Error ? e.message : 'Lỗi');
    } finally {
      setBusy(null);
    }
  };

  const toggleOne = async (p: ProxyUser) => {
    setBusy(p.id);
    try {
      if (p.enabled) await api.post(`/api/proxies/${p.id}/stop`);
      else await api.post(`/api/proxies/${p.id}/start`);
      toast.success('Đã cập nhật trạng thái');
      load();
    } catch (e) {
      toast.danger(e instanceof Error ? e.message : 'Lỗi');
    } finally {
      setBusy(null);
    }
  };

  const removeOne = async (id: number) => {
    try {
      await api.del(`/api/proxies/${id}`);
      toast.success('Đã xoá proxy');
      setDetail(null);
      load();
    } catch (e) {
      toast.danger(e instanceof Error ? e.message : 'Lỗi');
    }
  };

  const bulk = async (act: 'start' | 'stop' | 'reload-ip' | 'test' | 'delete') => {
    if (selected.length === 0) { toast.warning('Chọn proxy trước'); return; }
    setBulkBusy(true);
    try {
      const r = await api.post<{ results: Array<{ ok: boolean }> }>('/api/proxies/bulk', { ids: selected, action: act });
      const ok = r.results.filter((x) => x.ok).length;
      toast.success(`Bulk ${act}: ${ok}/${r.results.length} OK`);
      setSelected([]);
      load();
    } catch (e) {
      toast.danger(e instanceof Error ? e.message : 'Lỗi');
    } finally {
      setBulkBusy(false);
    }
  };

  const handleCreate = async () => {
    try {
      await api.post('/api/proxies', {
        pppoeIdx: createPppoeIdx,
        proxyType: createType,
        username: createForm.username.trim() || undefined,
        password: createForm.password.trim() || undefined,
        note: createForm.note.trim() || undefined,
      });
      toast.success(`Đã tạo proxy pppoe-out${createPppoeIdx}`);
      setCreateOpen(false);
      setCreateForm({ username: '', password: '', note: '' });
      load();
    } catch (e) {
      toast.danger(e instanceof Error ? e.message : 'Lỗi');
    }
  };

  const openEdit = (p: ProxyUser) => {
    setDetail(p);
    setEditForm({ username: p.username, password: '', note: p.note || '', proxyType: p.proxyType, enabled: p.enabled });
    setEditOpen(true);
  };

  const handleEdit = async () => {
    if (!detail) return;
    try {
      const body: Record<string, unknown> = {
        username: editForm.username,
        proxyType: editForm.proxyType,
        enabled: editForm.enabled,
        note: editForm.note.trim() || null,
      };
      if (editForm.password.trim()) body.password = editForm.password.trim();
      await api.patch(`/api/proxies/${detail.id}`, body);
      toast.success('Đã cập nhật');
      setEditOpen(false);
      load();
    } catch (e) {
      toast.danger(e instanceof Error ? e.message : 'Lỗi');
    }
  };

  const credsTargetIds = selected.length > 0 ? selected : proxies.map((p) => p.id);

  const regenerateCreds = async () => {
    try {
      await api.post('/api/proxies/regenerate-credentials', {
        ids: selected.length > 0 ? selected : proxies.map((p) => p.id),
      });
      toast.success('Đã regenerate password');
      load();
    } catch (e) {
      toast.danger(e instanceof Error ? e.message : 'Lỗi');
    }
  };

  const submitBulkCreds = async () => {
    setCredsBusy(true);
    try {
      if (credsMode === 'same') {
        if (!credsUsername.trim() && !credsPassword.trim()) {
          toast.warning('Nhập username và/hoặc password');
          return;
        }
        if (credsTargetIds.length === 0) {
          toast.warning('Không có proxy nào');
          return;
        }
        const r = await api.post<{ updated: number; errors?: string[] }>('/api/proxies/bulk-update-credentials', {
          mode: 'same',
          ids: credsTargetIds,
          username: credsUsername.trim() || undefined,
          password: credsPassword.trim() || undefined,
        });
        toast.success(`Đã đổi credential cho ${r.updated} proxy`);
        if (r.errors?.length) {
          setImportErrors(r.errors);
          setImportErrorsOpen(true);
        }
      } else {
        if (!credsText.trim()) {
          toast.warning('Dán danh sách idx:user:pass');
          return;
        }
        const r = await api.post<{ updated: number; errors?: string[] }>('/api/proxies/bulk-update-credentials', {
          mode: 'lines',
          text: credsText,
        });
        toast.success(`Đã đổi credential cho ${r.updated} proxy`);
        if (r.errors?.length) {
          setImportErrors(r.errors);
          setImportErrorsOpen(true);
        }
      }
      setCredsOpen(false);
      load();
    } catch (e) {
      toast.danger(e instanceof Error ? e.message : 'Lỗi');
    } finally {
      setCredsBusy(false);
    }
  };

  const handleExport = async () => {
    try {
      const body = {
        ids: selected.length > 0 ? selected : undefined,
        format: exportFormat,
        template: exportTemplate || undefined,
        includeSocks: exportIncludeSocks,
        fileFormat: exportFileFormat || undefined,
      };
      const r = await api.postExport(body);
      if ('downloaded' in r) toast.success(`Đã tải ${r.filename}`);
      else if (r.text?.trim()) {
        await copyText(r.text);
        toast.success(`Đã copy ${r.count} proxy`);
      } else toast.warning('Không có proxy có IP public');
      setExportOpen(false);
    } catch (e) {
      toast.danger(e instanceof Error ? e.message : 'Lỗi');
    }
  };

  const handleImport = async () => {
    try {
      const r = await api.post<{ created: number; skipped: number; errors: string[] }>('/api/proxies/import', { text: importText });
      toast.success(`Tạo ${r.created}, bỏ qua ${r.skipped}`);
      if (r.errors.length > 0) {
        setImportErrors(r.errors);
        setImportErrorsOpen(true);
      }
      setImportOpen(false);
      setImportText('');
      load();
    } catch (e) {
      toast.danger(e instanceof Error ? e.message : 'Lỗi');
    }
  };

  const revealPasswordApi = async (id: number): Promise<string> => {
    const r = await api.get<{ password: string }>(`/api/proxies/${id}/password`);
    setRevealedPass(r.password);
    return r.password;
  };

  const revealPassword = async (id: number) => {
    try {
      await revealPasswordApi(id);
    } catch (e) {
      toast.danger(e instanceof Error ? e.message : 'Lỗi');
    }
  };

  const copyToClipboard = async (text: string, label = 'Đã copy') => {
    if (!text?.trim()) {
      toast.danger('Không có nội dung để copy');
      return;
    }
    try {
      await copyText(text);
      toast.success(label);
    } catch {
      toast.danger('Copy thất bại');
    }
  };

  const copyProxy = async (p: ProxyUser, kind: 'http' | 'socks5' = 'http') => {
    if (!p.publicIp) { toast.warning('Chưa có IP'); return; }
    try {
      const pw = p.password || await revealPasswordApi(p.id);
      const text = formatProxy({ ...p, password: pw }, kind);
      await copyToClipboard(text, `Đã copy ${kind.toUpperCase()}`);
    } catch (e) {
      toast.danger(e instanceof Error ? e.message : 'Lỗi');
    }
  };

  if (loading) return <LoadingScreen />;

  return (
    <div>
      <MobileHeader
        title="Proxies"
        subtitle={`${stats.running}/${stats.total} running`}
        icon={<IconProxy />}
        onRefresh={load}
      />
      <PageLayout>
        <DismissibleAlert bannerId="proxies-pool-policy" title="Proxy pool · client kết nối IP egress:port">
          Mỗi proxy gắn 1 PPPoE — client dùng <code className="mobile-mono">user:pass@publicIp:extPort</code>.
          Bulk start/stop/reload/test từ toolbar hoặc chọn nhiều dòng trên bảng.
        </DismissibleAlert>
        <ListPageTop
          eyebrow="Proxy Pool"
          heroValue={stats.total > 0 ? Math.round((stats.running / stats.total) * 100) : 0}
          heroSuffix="%"
          summary={`${stats.running}/${stats.total} running · ${stats.error} error · ${stats.pending} pending`}
          metrics={[
            { label: 'Tổng', value: stats.total, accent: true, icon: <IconProxy /> },
            { label: 'Run', value: stats.running, hint: `${stats.stopped} stop` },
            { label: 'Error', value: stats.error },
            { label: 'Pending', value: stats.pending },
          ]}
          gauges={[
            { label: 'Running', value: stats.total > 0 ? Math.round((stats.running / stats.total) * 100) : 0, color: stats.running >= stats.total * 0.8 ? 'success' : 'warning' },
            { label: 'Stopped', value: stats.total > 0 ? Math.round((stats.stopped / stats.total) * 100) : 0, color: 'default' },
            { label: 'Error', value: stats.total > 0 ? Math.round((stats.error / stats.total) * 100) : 0, color: stats.error > 0 ? 'danger' : 'success' },
          ]}
          toolbar={(
            <PageToolbarInline
              search={{ value: search, onChange: setSearch, placeholder: 'Tìm WAN, user, IP…' }}
            >
              <div className="filter-scroll">
                {STATUS_FILTERS.map((f) => (
                  <FilterChip
                    key={f}
                    label={f}
                    active={statusFilter === f}
                    onSelect={() => setStatusFilter(f)}
                    count={f === 'all' ? stats.total : f === 'running' ? stats.running : f === 'stopped' ? stats.stopped : f === 'error' ? stats.error : undefined}
                  />
                ))}
              </div>
              <ActionBar label="Thao tác">
                <Button size="sm" onPress={() => setCreateOpen(true)}>Tạo</Button>
                <Button size="sm" variant="secondary" onPress={() => setExportOpen(true)}>Export</Button>
                <Button size="sm" variant="outline" onPress={() => setImportOpen(true)}>Import</Button>
                <Button size="sm" variant="ghost" onPress={() => { setCredsMode('same'); setCredsOpen(true); }}>Creds</Button>
                <Button size="sm" variant="ghost" onPress={regenerateCreds}>Regen</Button>
              </ActionBar>
              {selected.length > 0 ? (
                <ActionBar label={`Bulk · ${selected.length} đã chọn`}>
                  <Button size="sm" isPending={bulkBusy} onPress={() => bulk('start')}>Start</Button>
                  <Button size="sm" variant="outline" isPending={bulkBusy} onPress={() => bulk('stop')}>Stop</Button>
                  <Button size="sm" variant="ghost" isPending={bulkBusy} onPress={() => bulk('reload-ip')}>Reload IP</Button>
                  <Button size="sm" variant="ghost" isPending={bulkBusy} onPress={() => bulk('test')}>Test</Button>
                  <Button size="sm" variant="danger" isPending={bulkBusy} onPress={() => setConfirmBulkDelete(true)}>Xoá</Button>
                </ActionBar>
              ) : null}
            </PageToolbarInline>
          )}
        />
        {filtered.length === 0 ? (
          <EmptyState title="Không có proxy" />
        ) : wide ? (
          <>
            <ProxiesDataTable
              rows={pageRows}
              selected={selected}
              busy={busy}
              metricsMap={metricsMap}
              wanByIdx={wanByIdx}
              onToggleSelect={toggleSelect}
              onSelectAll={toggleSelectAll}
              onRowClick={openDetail}
              onToggle={toggleOne}
              onTest={testOne}
              onReload={(p) => action(p.id, `/api/proxies/${p.id}/reload-ip`, 'Reload IP')}
              onAnalytics={openAnalytics}
              onOpenConnection={setConnectionTarget}
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
            {filtered.map((p) => {
              const m = metricsMap[p.id];
              const wan = wanByIdx.get(p.pppoeIdx);
              const latMs = effectiveLatencyMs(p, wan);
              const latStale = isLatencyStale(p);
              return (
                <ListCard key={p.id} selected={selected.includes(p.id)}>
                  <ListCard.Body>
                    <ListCard.Row>
                      <input
                        type="checkbox"
                        className="list-card-checkbox"
                        checked={selected.includes(p.id)}
                        onChange={() => toggleSelect(p.id)}
                        aria-label={`Chọn ${p.pppoeName}`}
                      />
                      <ListCard.Main>
                        <ListCard.Title>{p.pppoeName}</ListCard.Title>
                        <ListCard.Subtitle>
                          {p.publicIp || '—'} · {p.username}
                          {p.proxyType !== 'socks5' ? ` · HTTP :${p.extHttpPort}` : ''}
                          {p.proxyType !== 'http' && p.extSocksPort ? ` · SOCKS :${p.extSocksPort}` : ''}
                        </ListCard.Subtitle>
                        <ListCard.Meta>
                          <IpQualityTag {...p} publicIp={p.publicIp} />
                          <EgressTag pppoeName={p.pppoeName} egressPppoeName={p.egressPppoeName} />
                        </ListCard.Meta>
                        {m ? (
                          <ListCard.Meta>
                            <span className="traffic-pill">↓{formatBps(m.rxBps)}</span>
                            <span className="traffic-pill traffic-pill-tx">↑{formatBps(m.txBps)}</span>
                            <span>{m.clients} cli</span>
                            {latMs != null ? (
                              <span className={latStale ? 'text-muted' : undefined}>{latMs}ms</span>
                            ) : null}
                            {m.quotaPct != null ? <span>{m.quotaPct}% quota</span> : null}
                          </ListCard.Meta>
                        ) : latMs != null ? (
                          <ListCard.Meta>
                            <span className={latStale ? 'text-muted' : undefined}>{latMs}ms latency</span>
                          </ListCard.Meta>
                        ) : null}
                      </ListCard.Main>
                      <ListCard.Aside>
                        <Chip size="sm" color={proxyStatusColor(p.status)}>{p.status}</Chip>
                        <Chip size="sm" color={p.enabled ? 'success' : 'default'}>{p.enabled ? 'ON' : 'OFF'}</Chip>
                      </ListCard.Aside>
                    </ListCard.Row>
                    <ListCard.Actions>
                      <Button size="sm" variant="secondary" onPress={() => openDetail(p)}>Chi tiết</Button>
                      <Button size="sm" variant="outline" onPress={() => setConnectionTarget(p)}>URL</Button>
                      <Button size="sm" variant="outline" onPress={() => openAnalytics(p)}>Analytics</Button>
                      <Button size="sm" variant="ghost" isPending={busy === p.id} onPress={() => toggleOne(p)}>
                        {p.enabled ? 'Stop' : 'Start'}
                      </Button>
                    </ListCard.Actions>
                  </ListCard.Body>
                </ListCard>
              );
            })}
          </RecordList>
        )}
      </PageLayout>

      <ProxyConnectionDrawer
        proxy={connectionTarget}
        open={!!connectionTarget}
        onClose={() => setConnectionTarget(null)}
        onCopy={copyToClipboard}
        revealPassword={revealPasswordApi}
      />

      {/* Detail drawer */}
      <Drawer isOpen={!!detail && !analyticsOpen && !connectionTarget} onOpenChange={(open) => !open && setDetail(null)}>
        <Drawer.Backdrop>
          <Drawer.Content placement="bottom">
            <Drawer.Dialog className="max-h-[90vh]">
              <Drawer.Header><Drawer.Heading>{detail?.pppoeName}</Drawer.Heading></Drawer.Header>
              <Drawer.Body className="overflow-y-auto">
                {detail ? (
                  <>
                    <KvList items={[
                      { label: 'IP', value: detail.publicIp || '—' },
                      { label: 'Chất lượng IP', value: resolveIpQuality(detail).ipQualityLabel || '—' },
                      { label: 'User', value: detail.username },
                      { label: 'Password', value: revealedPass || '••••••' },
                      { label: 'HTTP', value: detail.proxyType !== 'socks5' ? `${detail.publicIp || '—'}:${detail.extHttpPort}` : '—' },
                      { label: 'SOCKS', value: detail.extSocksPort && detail.proxyType !== 'http' ? `${detail.publicIp || '—'}:${detail.extSocksPort}` : '—' },
                      { label: 'Container', value: detail.containerName },
                      {
                        label: 'Latency',
                        value: formatLatency(effectiveLatencyMs(detail, wanByIdx.get(detail.pppoeIdx))),
                      },
                      { label: 'Last check', value: formatDateTime(detail.lastCheckAt) },
                    ]} />
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button size="sm" onPress={() => setConnectionTarget(detail)}>Connection URL</Button>
                      <Button size="sm" variant="secondary" onPress={() => revealPassword(detail.id)}>Reveal pass</Button>
                      <Button size="sm" variant="outline" onPress={() => copyProxy(detail, 'http')}>Copy HTTP</Button>
                      <Button size="sm" variant="outline" onPress={() => copyProxy(detail, 'socks5')}>Copy SOCKS</Button>
                      <Button size="sm" variant="ghost" isPending={busy === detail.id} onPress={() => action(detail.id, `/api/proxies/${detail.id}/reload-ip`, 'Reload IP')}>Reload IP</Button>
                      <Button size="sm" variant="ghost" isPending={busy === detail.id} onPress={() => testOne(detail)}>Test</Button>
                      <Button size="sm" variant="ghost" isPending={busy === detail.id} onPress={() => action(detail.id, `/api/proxies/${detail.id}/restart`, 'Reload Hub')}>Reload Hub</Button>
                      <Button size="sm" variant="ghost" onPress={() => showLogs(detail)}>Container logs</Button>
                      <Button size="sm" onPress={() => openEdit(detail)}>Sửa</Button>
                      <Button size="sm" variant="danger" onPress={() => removeOne(detail.id)}>Xoá</Button>
                    </div>
                  </>
                ) : null}
              </Drawer.Body>
            </Drawer.Dialog>
          </Drawer.Content>
        </Drawer.Backdrop>
      </Drawer>

      {/* Analytics drawer */}
      <Drawer isOpen={analyticsOpen} onOpenChange={(open) => { setAnalyticsOpen(open); if (!open) setAnalyticsTarget(null); }}>
        <Drawer.Backdrop>
          <Drawer.Content placement="bottom">
            <Drawer.Dialog className="max-h-[92vh]">
              <Drawer.Header><Drawer.Heading>Analytics · {analyticsTarget?.pppoeName}</Drawer.Heading></Drawer.Header>
              <Drawer.Body className="overflow-y-auto">
                <Tabs selectedKey={analyticsTab} onSelectionChange={(k) => setAnalyticsTab(k as AnalyticsTab)}>
                  <Tabs.ListContainer>
                    <Tabs.List aria-label="Analytics tabs">
                      <Tabs.Tab id="overview">Overview<Tabs.Indicator /></Tabs.Tab>
                      <Tabs.Tab id="limits">Limits<Tabs.Indicator /></Tabs.Tab>
                      <Tabs.Tab id="logs">Logs<Tabs.Indicator /></Tabs.Tab>
                    </Tabs.List>
                  </Tabs.ListContainer>
                  <Tabs.Panel id="overview" className="pt-3">
                    {analyticsLive ? (
                      <KvList items={[
                        { label: 'Clients', value: analyticsLive.clients },
                        { label: 'Download', value: `${formatBps(analyticsLive.rxBps)} KB/s · ${formatBytesLabel(analyticsLive.rxBytes)}` },
                        { label: 'Upload', value: `${formatBps(analyticsLive.txBps)} KB/s · ${formatBytesLabel(analyticsLive.txBytes)}` },
                        { label: 'Quota', value: analyticsLive.quotaPct != null ? `${analyticsLive.quotaPct}%` : '—' },
                        { label: 'Uptime', value: analyticsUptime?.uptimePct != null ? `${analyticsUptime.uptimePct}% (${analyticsUptime.samples} samples)` : '—' },
                      ]} />
                    ) : <div className="text-sm text-muted">Chưa có metrics</div>}
                    <div className="mt-3 mobile-chip-row">
                      {(['hour', 'day', 'week', 'month'] as HistoryPeriod[]).map((p) => (
                        <FilterChip
                          key={p}
                          label={p}
                          active={historyPeriod === p}
                          onSelect={() => analyticsTarget && loadHistory(analyticsTarget.id, p)}
                        />
                      ))}
                    </div>
                    {historyData.length > 1 ? (
                      <div className="mt-4">
                        <DualTrafficChart
                          rx={seriesFromHistory(historyData, (h) => h.rxBps)}
                          tx={seriesFromHistory(historyData, (h) => h.txBps)}
                          height={100}
                        />
                      </div>
                    ) : (
                      <div className="mt-3 text-xs text-muted">{historyData.length} samples · {historyPeriod}</div>
                    )}
                  </Tabs.Panel>
                  <Tabs.Panel id="limits" className="pt-3 flex flex-col gap-3">
                    <Switch isSelected={limits.enabled} onChange={(v) => setLimits((l) => ({ ...l, enabled: v }))}>
                      <Switch.Content><Switch.Control><Switch.Thumb /></Switch.Control>Bật giới hạn</Switch.Content>
                    </Switch>
                    <NumberField value={limits.quotaDailyMb ?? undefined} onChange={(v) => setLimits((l) => ({ ...l, quotaDailyMb: Number(v) || null }))}>
                      <Label>Quota ngày (MB)</Label>
                      <NumberField.Group><NumberField.Input /></NumberField.Group>
                    </NumberField>
                    <NumberField value={limits.quotaWeeklyMb ?? undefined} onChange={(v) => setLimits((l) => ({ ...l, quotaWeeklyMb: Number(v) || null }))}>
                      <Label>Quota tuần (MB)</Label>
                      <NumberField.Group><NumberField.Input /></NumberField.Group>
                    </NumberField>
                    <NumberField value={limits.quotaMonthlyMb ?? undefined} onChange={(v) => setLimits((l) => ({ ...l, quotaMonthlyMb: Number(v) || null }))}>
                      <Label>Quota tháng (MB)</Label>
                      <NumberField.Group><NumberField.Input /></NumberField.Group>
                    </NumberField>
                    <NumberField value={limits.speedDownKbps ? limits.speedDownKbps / 1000 : undefined} onChange={(v) => setLimits((l) => ({ ...l, speedDownKbps: v ? Math.round(Number(v) * 1000) : null }))}>
                      <Label>Speed down (Mbps)</Label>
                      <NumberField.Group><NumberField.Input /></NumberField.Group>
                    </NumberField>
                    <NumberField value={limits.speedUpKbps ? limits.speedUpKbps / 1000 : undefined} onChange={(v) => setLimits((l) => ({ ...l, speedUpKbps: v ? Math.round(Number(v) * 1000) : null }))}>
                      <Label>Speed up (Mbps)</Label>
                      <NumberField.Group><NumberField.Input /></NumberField.Group>
                    </NumberField>
                    <NumberField value={limits.maxConnections ?? undefined} onChange={(v) => setLimits((l) => ({ ...l, maxConnections: Number(v) || null }))}>
                      <Label>Max connections</Label>
                      <NumberField.Group><NumberField.Input /></NumberField.Group>
                    </NumberField>
                    <TextField
                      value={limits.allowedHours?.weekdays ?? '1-7'}
                      onChange={(v) => setLimits((l) => ({ ...l, allowedHours: { ...l.allowedHours, weekdays: String(v) } }))}
                    >
                      <Label>Weekdays (1-7)</Label><Input />
                    </TextField>
                    <TextField
                      value={(limits.allowedHours?.periods ?? []).join(', ')}
                      onChange={(v) => setLimits((l) => ({
                        ...l,
                        allowedHours: { ...l.allowedHours, periods: String(v).split(',').map((s) => s.trim()).filter(Boolean) },
                      }))}
                    >
                      <Label>Periods (HH:MM:SS-HH:MM:SS)</Label><Input placeholder="00:00:00-24:00:00" />
                    </TextField>
                    <TextField
                      value={limits.expiresAt ? limits.expiresAt.slice(0, 16) : ''}
                      onChange={(v) => setLimits((l) => ({ ...l, expiresAt: String(v) ? new Date(String(v)).toISOString() : null }))}
                    >
                      <Label>Expires at</Label><Input type="datetime-local" />
                    </TextField>
                    <Button isPending={limitsSaving} onPress={saveLimits}>Lưu limits</Button>
                  </Tabs.Panel>
                  <Tabs.Panel id="logs" className="pt-3">
                    <TextField value={logHostFilter} onChange={(v) => setLogHostFilter(String(v))}>
                      <Label>Lọc host</Label><Input placeholder="api.telegram.org" />
                    </TextField>
                    <Button
                      size="sm"
                      className="mt-2 mb-3"
                      variant="outline"
                      onPress={() => analyticsTarget && loadLogs(analyticsTarget.id, logHostFilter)}
                    >
                      Lọc logs
                    </Button>
                    <div className="mobile-list">
                      {logRequests.map((r) => (
                        <div key={r.id} className="rounded-lg border border-border p-2 text-xs">
                          <div className="font-medium">{r.destHost || '—'}:{r.destPort ?? '-'}</div>
                          <div className="text-muted">{r.clientIp} · {formatDateTime(r.ts)}</div>
                          <div>↓{r.rxBytes} ↑{r.txBytes}</div>
                        </div>
                      ))}
                    </div>
                    {logDomains.length > 0 ? (
                      <div className="mt-4">
                        <div className="section-title mb-3">
                          <span className="section-title-bar" />
                          Top domains
                        </div>
                        <HorizontalBarChart
                          items={logDomains.map((d) => ({
                            label: d.domain,
                            value: d.hits,
                            color: 'success' as const,
                          }))}
                        />
                      </div>
                    ) : null}
                  </Tabs.Panel>
                </Tabs>
              </Drawer.Body>
            </Drawer.Dialog>
          </Drawer.Content>
        </Drawer.Backdrop>
      </Drawer>

      {/* Create modal */}
      <Modal isOpen={createOpen} onOpenChange={setCreateOpen}>
        <Modal.Backdrop><Modal.Container><Modal.Dialog>
          <Modal.CloseTrigger />
          <Modal.Header><Modal.Heading>Tạo proxy</Modal.Heading></Modal.Header>
          <Modal.Body className="flex flex-col gap-3">
            <Select selectedKey={String(createPppoeIdx)} onSelectionChange={(k) => setCreatePppoeIdx(Number(k))}>
              <Label>PPPoE</Label>
              <Select.Trigger><Select.Value /></Select.Trigger>
              <Select.Popover><ListBox>
                {wans.map((w) => (
                  <ListBox.Item key={String(w.index)} id={String(w.index)} textValue={w.name}>
                    {w.name} ({w.publicIp || 'no IP'})<ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
              </ListBox></Select.Popover>
            </Select>
            <Select selectedKey={createType} onSelectionChange={(k) => setCreateType(String(k))}>
              <Label>Loại</Label>
              <Select.Trigger><Select.Value /></Select.Trigger>
              <Select.Popover><ListBox>
                {['http', 'socks5', 'both'].map((t) => (
                  <ListBox.Item key={t} id={t} textValue={t}>{t}<ListBox.ItemIndicator /></ListBox.Item>
                ))}
              </ListBox></Select.Popover>
            </Select>
            <TextField value={createForm.username} onChange={(v) => setCreateForm((f) => ({ ...f, username: String(v) }))}>
              <Label>Username (tuỳ chọn)</Label><Input />
            </TextField>
            <TextField value={createForm.password} onChange={(v) => setCreateForm((f) => ({ ...f, password: String(v) }))}>
              <Label>Password (tuỳ chọn)</Label><Input type="password" />
            </TextField>
            <TextField value={createForm.note} onChange={(v) => setCreateForm((f) => ({ ...f, note: String(v) }))}>
              <Label>Ghi chú</Label><Input />
            </TextField>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="tertiary" onPress={() => setCreateOpen(false)}>Huỷ</Button>
            <Button onPress={handleCreate}>Tạo</Button>
          </Modal.Footer>
        </Modal.Dialog></Modal.Container></Modal.Backdrop>
      </Modal>

      {/* Edit modal */}
      <Modal isOpen={editOpen} onOpenChange={setEditOpen}>
        <Modal.Backdrop><Modal.Container><Modal.Dialog>
          <Modal.CloseTrigger />
          <Modal.Header><Modal.Heading>Sửa proxy</Modal.Heading></Modal.Header>
          <Modal.Body className="flex flex-col gap-3">
            <TextField value={editForm.username} onChange={(v) => setEditForm((f) => ({ ...f, username: String(v) }))}>
              <Label>Username</Label><Input />
            </TextField>
            <Select selectedKey={editForm.proxyType} onSelectionChange={(k) => setEditForm((f) => ({ ...f, proxyType: String(k) }))}>
              <Label>Loại proxy</Label>
              <Select.Trigger><Select.Value /></Select.Trigger>
              <Select.Popover><ListBox>
                {['http', 'socks5', 'both'].map((t) => (
                  <ListBox.Item key={t} id={t} textValue={t}>{t}<ListBox.ItemIndicator /></ListBox.Item>
                ))}
              </ListBox></Select.Popover>
            </Select>
            <TextField value={editForm.password} onChange={(v) => setEditForm((f) => ({ ...f, password: String(v) }))}>
              <Label>Password mới (để trống = giữ)</Label><Input type="password" />
            </TextField>
            <TextField value={editForm.note} onChange={(v) => setEditForm((f) => ({ ...f, note: String(v) }))}>
              <Label>Ghi chú</Label><Input />
            </TextField>
            <Switch isSelected={editForm.enabled} onChange={(v) => setEditForm((f) => ({ ...f, enabled: v }))}>
              <Switch.Content><Switch.Control><Switch.Thumb /></Switch.Control>Enabled</Switch.Content>
            </Switch>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="tertiary" onPress={() => setEditOpen(false)}>Huỷ</Button>
            <Button onPress={handleEdit}>Lưu</Button>
          </Modal.Footer>
        </Modal.Dialog></Modal.Container></Modal.Backdrop>
      </Modal>

      {/* Export modal */}
      <Modal isOpen={exportOpen} onOpenChange={setExportOpen}>
        <Modal.Backdrop><Modal.Container><Modal.Dialog>
          <Modal.CloseTrigger />
          <Modal.Header><Modal.Heading>Export proxy</Modal.Heading></Modal.Header>
          <Modal.Body className="flex flex-col gap-3">
            <Select selectedKey={exportFormat} onSelectionChange={(k) => setExportFormat(String(k))}>
              <Label>Format</Label>
              <Select.Trigger><Select.Value /></Select.Trigger>
              <Select.Popover><ListBox>
                {['ipportuserpass', 'userpassipport', 'httpurl', 'socks5url', 'ipport'].map((f) => (
                  <ListBox.Item key={f} id={f} textValue={f}>{f}<ListBox.ItemIndicator /></ListBox.Item>
                ))}
              </ListBox></Select.Popover>
            </Select>
            <TextField value={exportTemplate} onChange={(v) => setExportTemplate(String(v))}>
              <Label>Template (tuỳ chọn)</Label><Input placeholder="{ip}:{port}:{user}:{pass}" />
            </TextField>
            <Switch isSelected={exportIncludeSocks} onChange={setExportIncludeSocks}>
              <Switch.Content><Switch.Control><Switch.Thumb /></Switch.Control>Include SOCKS</Switch.Content>
            </Switch>
            <Select selectedKey={exportFileFormat || 'clipboard'} onSelectionChange={(k) => setExportFileFormat(k === 'clipboard' ? '' : String(k))}>
              <Label>Output</Label>
              <Select.Trigger><Select.Value /></Select.Trigger>
              <Select.Popover><ListBox>
                <ListBox.Item id="clipboard" textValue="clipboard">Copy clipboard<ListBox.ItemIndicator /></ListBox.Item>
                {['txt', 'csv', 'json'].map((f) => (
                  <ListBox.Item key={f} id={f} textValue={f}>Download .{f}<ListBox.ItemIndicator /></ListBox.Item>
                ))}
              </ListBox></Select.Popover>
            </Select>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="tertiary" onPress={() => setExportOpen(false)}>Huỷ</Button>
            <Button onPress={handleExport}>Export / Copy</Button>
          </Modal.Footer>
        </Modal.Dialog></Modal.Container></Modal.Backdrop>
      </Modal>

      {/* Bulk credentials modal */}
      <Modal isOpen={credsOpen} onOpenChange={setCredsOpen}>
        <Modal.Backdrop><Modal.Container><Modal.Dialog>
          <Modal.CloseTrigger />
          <Modal.Header><Modal.Heading>Đổi credentials hàng loạt</Modal.Heading></Modal.Header>
          <Modal.Body className="flex flex-col gap-3">
            <Select selectedKey={credsMode} onSelectionChange={(k) => setCredsMode(k as 'same' | 'lines')}>
              <Label>Chế độ</Label>
              <Select.Trigger><Select.Value /></Select.Trigger>
              <Select.Popover><ListBox>
                <ListBox.Item id="same" textValue="same">Cùng user/pass cho {credsTargetIds.length} proxy<ListBox.ItemIndicator /></ListBox.Item>
                <ListBox.Item id="lines" textValue="lines">Theo dòng idx:user:pass<ListBox.ItemIndicator /></ListBox.Item>
              </ListBox></Select.Popover>
            </Select>
            {credsMode === 'same' ? (
              <>
                <TextField value={credsUsername} onChange={(v) => setCredsUsername(String(v))}>
                  <Label>Username</Label><Input />
                </TextField>
                <TextField value={credsPassword} onChange={(v) => setCredsPassword(String(v))}>
                  <Label>Password</Label><Input type="password" />
                </TextField>
              </>
            ) : (
              <TextArea value={credsText} onChange={(e) => setCredsText(e.target.value)} className="min-h-32 w-full" placeholder="2:user:pass&#10;3:user2:pass2" />
            )}
          </Modal.Body>
          <Modal.Footer>
            <Button variant="tertiary" onPress={() => setCredsOpen(false)}>Huỷ</Button>
            <Button isPending={credsBusy} onPress={submitBulkCreds}>Áp dụng</Button>
          </Modal.Footer>
        </Modal.Dialog></Modal.Container></Modal.Backdrop>
      </Modal>

      {/* Container logs drawer */}
      <Drawer isOpen={logsOpen} onOpenChange={(open) => { setLogsOpen(open); if (!open) setLogsTarget(null); }}>
        <Drawer.Backdrop>
          <Drawer.Content placement="bottom">
            <Drawer.Dialog className="max-h-[85vh]">
              <Drawer.Header><Drawer.Heading>Logs · {logsTarget?.pppoeName}</Drawer.Heading></Drawer.Header>
              <Drawer.Body className="overflow-y-auto">
                {logsLoading ? <div className="text-sm text-muted">Đang tải…</div> : null}
                <pre className="logs-pre whitespace-pre-wrap break-all text-xs">{logsText || '(chờ log…)'}</pre>
              </Drawer.Body>
            </Drawer.Dialog>
          </Drawer.Content>
        </Drawer.Backdrop>
      </Drawer>

      {/* Import errors modal */}
      <Modal isOpen={importErrorsOpen} onOpenChange={setImportErrorsOpen}>
        <Modal.Backdrop><Modal.Container><Modal.Dialog>
          <Modal.CloseTrigger />
          <Modal.Header><Modal.Heading>Một số dòng lỗi ({importErrors.length})</Modal.Heading></Modal.Header>
          <Modal.Body>
            <pre className="logs-pre max-h-48 overflow-y-auto whitespace-pre-wrap text-xs">{importErrors.join('\n')}</pre>
          </Modal.Body>
          <Modal.Footer>
            <Button onPress={() => setImportErrorsOpen(false)}>Đóng</Button>
          </Modal.Footer>
        </Modal.Dialog></Modal.Container></Modal.Backdrop>
      </Modal>

      {/* Import modal */}
      <Modal isOpen={importOpen} onOpenChange={setImportOpen}>
        <Modal.Backdrop><Modal.Container><Modal.Dialog>
          <Modal.CloseTrigger />
          <Modal.Header><Modal.Heading>Import proxy</Modal.Heading></Modal.Header>
          <Modal.Body>
            <TextArea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              className="min-h-32 w-full"
              placeholder="idx:user:pass hoặc danh sách…"
            />
          </Modal.Body>
          <Modal.Footer>
            <Button variant="tertiary" onPress={() => setImportOpen(false)}>Huỷ</Button>
            <Button onPress={handleImport}>Import</Button>
          </Modal.Footer>
        </Modal.Dialog></Modal.Container></Modal.Backdrop>
      </Modal>

      <ConfirmModal
        open={confirmBulkDelete}
        onOpenChange={setConfirmBulkDelete}
        title={`Xoá ${selected.length} proxy?`}
        message="Proxy và container liên quan sẽ bị xoá. Thao tác không hoàn tác."
        confirmLabel="Xoá"
        isPending={bulkBusy}
        onConfirm={() => bulk('delete')}
      />
    </div>
  );
}