import { Tag, Tooltip } from 'antd';

interface Props {
  pppoeName: string;
  egressPppoeName?: string | null;
}

/** Hiện egress khi hub pool gán WAN khác slot. */
export default function EgressTag({ pppoeName, egressPppoeName }: Props) {
  const egress = egressPppoeName || pppoeName;
  if (egress === pppoeName) return null;
  return (
    <Tooltip title="Client kết nối qua IP của egress PPPoE này">
      <Tag color="purple" bordered={false} style={{ fontSize: 11 }}>
        egress {egress}
      </Tag>
    </Tooltip>
  );
}