import { useMemo } from 'react';
import { Area } from '@ant-design/plots';
import { Empty, Typography } from 'antd';

const { Text } = Typography;

export interface TrafficHistoryPoint {
  bucket: string;
  rxBytes: string;
  txBytes: string;
}

interface Props {
  data: TrafficHistoryPoint[];
  period: 'hour' | 'day' | 'week' | 'month';
  height?: number;
}

function formatBucketLabel(bucket: string, period: Props['period']): string {
  if (period === 'hour') {
    const d = new Date(bucket);
    return d.toLocaleString('vi-VN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  }
  if (period === 'month') return bucket.slice(0, 7);
  return bucket.slice(5);
}

function toMb(n: string): number {
  const v = Number(n);
  if (!v || Number.isNaN(v)) return 0;
  return Math.round((v / 1_048_576) * 100) / 100;
}

export default function ProxyTrafficChart({ data, period, height = 220 }: Props) {
  const chartData = useMemo(() => {
    const rows: Array<{ label: string; type: string; mb: number }> = [];
    for (const p of data) {
      const label = formatBucketLabel(p.bucket, period);
      rows.push({ label, type: 'Download', mb: toMb(p.rxBytes) });
      rows.push({ label, type: 'Upload', mb: toMb(p.txBytes) });
    }
    return rows;
  }, [data, period]);

  if (!data.length) {
    return <Empty description="Chưa có dữ liệu lịch sử — cần traffic + rollup" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  }

  return (
    <div>
      <Area
        data={chartData}
        xField="label"
        yField="mb"
        colorField="type"
        stack
        height={height}
        shapeField="smooth"
        style={{ fillOpacity: 0.35 }}
        axis={{ y: { title: 'MB' } }}
        legend={{ color: { position: 'top' } }}
      />
      <Text type="secondary" style={{ fontSize: 11 }}>
        Tích lũy từ samples bps (rollup {period})
      </Text>
    </div>
  );
}