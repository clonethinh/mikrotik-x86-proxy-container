import React, { useEffect, useState, useMemo } from 'react';
import { Form, App } from 'antd';
import { api, type ProxyUser, type WanInfo } from '../services/api';
import { useWSEvent } from '../services/ws';
import { useTablePagination } from './useTablePagination';
import { copyText } from '../lib/clipboard';
import { mergeLiveMetrics } from '../lib/liveMetricsMerge';
import dayjs from 'dayjs';
import {
  PROXY_LIST_RELOAD,
  type LiveMetrics,
  type ProxyRequestLogRow,
  type ProxyDomainStatRow,
  type ProxyLimitConfig,
  type AnalyticsTab,
  type HistoryPeriod,
  type TrafficHistoryPoint,
} from '../types/proxies';

export function useProxiesPage() {
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
  const [analyticsTab, setAnalyticsTab] = useState<AnalyticsTab>('overview');
  const [analyticsUptime, setAnalyticsUptime] = useState<{ uptimePct: number | null; samples: number } | null>(null);
  const [historyPeriod, setHistoryPeriod] = useState<HistoryPeriod>('hour');
  const [historyData, setHistoryData] = useState<TrafficHistoryPoint[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [limitsLoading, setLimitsLoading] = useState(false);
  const [limitsSaving, setLimitsSaving] = useState(false);
  const [limitsForm] = Form.useForm();
  const [logRequests, setLogRequests] = useState<ProxyRequestLogRow[]>([]);
  const [logDomains, setLogDomains] = useState<ProxyDomainStatRow[]>([]);
  const [requestLogsLoading, setRequestLogsLoading] = useState(false);
  const [logHostFilter, setLogHostFilter] = useState('');
  const [focusTarget, setFocusTarget] = useState<ProxyUser | null>(null);
  const [connectionTarget, setConnectionTarget] = useState<ProxyUser | null>(null);

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
    const t = setInterval(() => { loadMetrics(); }, 5_000);
    return () => clearInterval(t);
  }, []);

  useWSEvent(
    (msg) => PROXY_LIST_RELOAD.has(msg.type) || msg.type === 'wan.sync',
    () => load(),
  );

  const patchMetrics = (proxyId: number, patch: Partial<LiveMetrics>) => {
    setMetricsMap(prev => ({
      ...prev,
      [proxyId]: mergeLiveMetrics(prev[proxyId], patch),
    }));
    if (analyticsTarget?.id === proxyId) {
      setAnalyticsLive(prev => mergeLiveMetrics(prev ?? undefined, patch));
    }
  };

  useWSEvent(
    (msg) => msg.type === 'proxy.metrics',
    (msg) => {
      const p = msg.payload as { proxyId: number } & Partial<LiveMetrics>;
      if (!p?.proxyId) return;
      const { proxyId, ...patch } = p;
      patchMetrics(proxyId, { ...patch, sampledAt: patch.sampledAt ?? new Date().toISOString() });
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
    },
  );

  useWSEvent(
    (msg) => msg.type === 'proxy.health',
    (msg) => {
      const p = msg.payload as { id: number; ok: boolean; latencyMs?: number | null; pingMs?: number | null };
      if (!p?.id) return;
      const at = new Date().toISOString();
      const ms = p.pingMs ?? p.latencyMs;
      setProxies(prev => prev.map(x => (
        x.id === p.id
          ? { ...x, lastLatencyMs: p.ok && ms != null ? ms : x.lastLatencyMs, lastCheckAt: at }
          : x
      )));
      setWans(prev => prev.map(w => (
        w.proxyId === p.id
          ? { ...w, lastLatencyMs: p.ok && ms != null ? ms : w.lastLatencyMs, lastCheckAt: at }
          : w
      )));
      if (focusTarget?.id === p.id) {
        setFocusTarget(ft => ft ? { ...ft, lastLatencyMs: p.ok && ms != null ? ms : ft.lastLatencyMs, lastCheckAt: at } : ft);
      }
    },
  );

  useWSEvent(
    (msg) => msg.type === 'proxy.applied' || msg.type === 'wan.internet-up',
    (msg) => {
      const p = msg.payload as { id?: number; proxyId?: number; pingMs?: number | null; pppoeIdx?: number };
      const pingMs = p.pingMs;
      if (pingMs == null) return;
      const proxyId = p.id ?? p.proxyId;
      const at = new Date().toISOString();
      if (proxyId) {
        setProxies(prev => prev.map(x => (
          x.id === proxyId ? { ...x, lastLatencyMs: pingMs, lastCheckAt: at } : x
        )));
      }
      if (p.pppoeIdx != null) {
        setWans(prev => prev.map(w => (
          w.index === p.pppoeIdx ? { ...w, lastLatencyMs: pingMs, lastCheckAt: at } : w
        )));
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

  const loadHistory = async (proxyId: number, period: HistoryPeriod) => {
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
    pending: proxies.filter(p => p.status === 'pending').length,
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
      if (r.ok) {
        const at = new Date().toISOString();
        setProxies(prev => prev.map(p => (
          p.id === id ? { ...p, lastLatencyMs: r.latencyMs, lastCheckAt: at } : p
        )));
        setFocusTarget(ft => (ft?.id === id ? { ...ft, lastLatencyMs: r.latencyMs, lastCheckAt: at } : ft));
        msgApi.success(`Container OK · ${r.latencyMs}ms · egress ${r.exitIp}`);
      } else {
        msgApi.error(r.error || 'Test fail');
      }
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
      msgApi.success('Đã reload config hub (không restart container)');
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
      if (focusTarget?.id === id) setFocusTarget(null);
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
    if (!text?.trim()) {
      msgApi.error(typeof label === 'string' && label.startsWith('Không') ? label : 'Không có nội dung để copy');
      return;
    }
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
            content: React.createElement('pre', { className: 'proxy-logs-pre', style: { maxHeight: 200, overflow: 'auto' } }, r.errors.join('\n')),
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
            content: React.createElement('pre', { className: 'proxy-logs-pre', style: { maxHeight: 200, overflow: 'auto' } }, r.errors.join('\n')),
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
          content: React.createElement('pre', { className: 'proxy-logs-pre', style: { maxHeight: 200, overflow: 'auto' } }, r.errors.join('\n')),
        });
      }
      setImportOpen(false);
      load();
    } catch (e: unknown) {
      msgApi.error(e instanceof Error ? e.message : 'Lỗi');
    }
  };

  const openEdit = (p: ProxyUser) => {
    setEditTarget(p);
    editForm.setFieldsValue(p);
  };

  const pppoeOptions = wans.map(w => ({ value: w.index, label: `${w.name} (${w.publicIp || 'chưa có IP'})` }));

  return {
    proxies,
    wans,
    loading,
    search,
    setSearch,
    statusFilter,
    setStatusFilter,
    selected,
    setSelected,
    createOpen,
    setCreateOpen,
    editTarget,
    setEditTarget,
    busy,
    bulkBusy,
    exportOpen,
    setExportOpen,
    logsTarget,
    setLogsTarget,
    logsText,
    logsLoading,
    importOpen,
    setImportOpen,
    importText,
    setImportText,
    credsOpen,
    setCredsOpen,
    credsMode,
    setCredsMode,
    credsText,
    setCredsText,
    credsBusy,
    createForm,
    editForm,
    exportForm,
    credsForm,
    metricsMap,
    analyticsTarget,
    setAnalyticsTarget,
    analyticsLive,
    analyticsTab,
    setAnalyticsTab,
    analyticsUptime,
    historyPeriod,
    setHistoryPeriod,
    historyData,
    historyLoading,
    limitsLoading,
    limitsSaving,
    limitsForm,
    logRequests,
    logDomains,
    requestLogsLoading,
    logHostFilter,
    setLogHostFilter,
    focusTarget,
    setFocusTarget,
    connectionTarget,
    setConnectionTarget,
    stats,
    filtered,
    wanByIdx,
    tablePagination,
    load,
    loadLogs,
    loadHistory,
    openAnalytics,
    saveLimits,
    reloadOne,
    testOne,
    restartOne,
    toggleOne,
    removeOne,
    revealPassword,
    copyToClipboard,
    buildProxyString,
    handleCreate,
    handleEdit,
    bulk,
    handleExport,
    regenerateCreds,
    credsTargetIds,
    openBulkCreds,
    submitBulkCreds,
    showLogs,
    handleImport,
    openEdit,
    pppoeOptions,
    modal,
  };
}

export type ProxiesPageViewProps = ReturnType<typeof useProxiesPage>;