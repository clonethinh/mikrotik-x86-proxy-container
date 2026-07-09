import { Tag, Tooltip } from 'antd';
import { ipQualityTagColor, resolveIpQuality, type IpQualityFields } from '../lib/ipQuality';

interface Props extends IpQualityFields {
  publicIp?: string | null;
  showPublicWhenOk?: boolean;
}

export default function IpQualityTag({ publicIp, showPublicWhenOk = false, ...fields }: Props) {
  const info = resolveIpQuality({ publicIp, ...fields });
  if (!info.ipQualityLabel) return null;

  const show = showPublicWhenOk || info.ipQuality !== 'public';
  if (!show) return null;

  const color = ipQualityTagColor(info.ipQuality);
  const title = info.ipQualityHint || info.ipQualityLabel;

  return (
    <Tooltip title={title}>
      <Tag color={color} bordered={false} style={{ marginInlineEnd: 0 }}>
        {info.ipQualityLabel}
      </Tag>
    </Tooltip>
  );
}