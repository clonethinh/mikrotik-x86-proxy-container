import {
  Button, Card, Empty, Flex, Form, Input, InputNumber, Progress, Segmented,
  Skeleton, Switch, Table, Tag, Typography, DatePicker,
} from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import DismissibleAlert from '../ui/DismissibleAlert';
import AppDrawer from '../ui/AppDrawer';
import { DrawerSection } from '../ui/DrawerSection';
import ProxyTrafficChart from '../proxy/ProxyTrafficChart';
import { formatBps, formatBytes } from '../../lib/proxiesFormat';
import type { ProxiesPageViewProps } from '../../hooks/useProxiesPage';
import type { ProxyRequestLogRow } from '../../types/proxies';
import { BarChartOutlined } from '@ant-design/icons';

const { Text } = Typography;

type Props = Pick<
  ProxiesPageViewProps,
  | 'analyticsTarget' | 'setAnalyticsTarget' | 'analyticsLive' | 'analyticsTab' | 'setAnalyticsTab'
  | 'analyticsUptime' | 'historyPeriod' | 'setHistoryPeriod' | 'historyData' | 'historyLoading'
  | 'limitsLoading' | 'limitsSaving' | 'limitsForm' | 'saveLimits'
  | 'logRequests' | 'logDomains' | 'requestLogsLoading' | 'logHostFilter' | 'setLogHostFilter'
  | 'loadLogs' | 'loadHistory'
>;

export default function ProxyAnalyticsDrawer({
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
  saveLimits,
  logRequests,
  logDomains,
  requestLogsLoading,
  logHostFilter,
  setLogHostFilter,
  loadLogs,
  loadHistory,
}: Props) {
  return (
    <AppDrawer
      open={!!analyticsTarget}
      onClose={() => setAnalyticsTarget(null)}
      width="lg"
      icon={<BarChartOutlined />}
      title={analyticsTarget ? `Analytics · ${analyticsTarget.username}` : 'Analytics'}
      subtitle={analyticsTarget ? `${analyticsTarget.pppoeName || `idx ${analyticsTarget.pppoeIdx}`} · ${analyticsTarget.publicIp || 'no IP'}` : undefined}
      headerExtra={(
        <Segmented
          size="small"
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
      )}
    >
      {analyticsTarget && analyticsTab === 'overview' && (
        <Flex vertical gap={16}>
          <DismissibleAlert
            bannerId="proxies-analytics-realtime"
            type="info"
            showIcon
            message="Realtime qua WebSocket (request log)"
            description="Clients / tốc độ / Used cập nhật ngay khi có request qua proxy. HTTPS/SOCKS chỉ thấy hostname:port, không có URL path."
          />
          {analyticsLive ? (
            <>
              <DrawerSection title="Realtime" extra={<Tag bordered={false} color="processing">Live</Tag>}>
                <div className="drawer-metric-strip">
                  <div className="drawer-metric-tile">
                    <span className="drawer-metric-tile__label">Clients</span>
                    <span className="drawer-metric-tile__value">{analyticsLive.clients}</span>
                  </div>
                  <div className="drawer-metric-tile">
                    <span className="drawer-metric-tile__label">Upload ↑</span>
                    <span className="drawer-metric-tile__value" style={{ fontSize: 16 }}>{formatBps(analyticsLive.txBps)}</span>
                  </div>
                  <div className="drawer-metric-tile">
                    <span className="drawer-metric-tile__label">Download ↓</span>
                    <span className="drawer-metric-tile__value" style={{ fontSize: 16 }}>{formatBps(analyticsLive.rxBps)}</span>
                  </div>
                  <div className="drawer-metric-tile">
                    <span className="drawer-metric-tile__label">Used hôm nay</span>
                    <span className="drawer-metric-tile__value" style={{ fontSize: 16 }}>
                      {formatBytes(
                        analyticsLive.usedBytes
                          ?? (BigInt(analyticsLive.rxBytes || '0') + BigInt(analyticsLive.txBytes || '0')).toString(),
                      )}
                    </span>
                  </div>
                </div>
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
                  <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 10 }}>
                    Cập nhật: {new Date(analyticsLive.sampledAt).toLocaleString('vi-VN')}
                  </Text>
                )}
              </DrawerSection>
              <DrawerSection title="Uptime (24h)">
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
              </DrawerSection>
              <DrawerSection
                title="Lịch sử traffic"
                extra={(
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
                )}
              >
                {historyLoading ? (
                  <Skeleton active paragraph={{ rows: 4 }} />
                ) : (
                  <ProxyTrafficChart data={historyData} period={historyPeriod} />
                )}
              </DrawerSection>
            </>
          ) : (
            <Skeleton active paragraph={{ rows: 4 }} />
          )}
        </Flex>
      )}

      {analyticsTarget && analyticsTab === 'logs' && (
        <Flex vertical gap={16}>
          <DismissibleAlert
            bannerId="proxies-analytics-logs"
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
                    render: (_: unknown, r) => formatBytes(r.totalBytes),
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
            <DismissibleAlert
              bannerId="proxies-limits-warning"
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
    </AppDrawer>
  );
}