import { Chip } from '@heroui/react';
import { ipQualityChipColor, resolveIpQuality, type IpQualityFields } from '../lib/ipQuality';

interface Props extends IpQualityFields {
  publicIp?: string | null;
  showPublicWhenOk?: boolean;
}

export default function IpQualityTag({ publicIp, showPublicWhenOk = false, ...fields }: Props) {
  const info = resolveIpQuality({ publicIp, ...fields });
  if (!info.ipQualityLabel) return null;

  const show = showPublicWhenOk || info.ipQuality !== 'public';
  if (!show) return null;

  const color = ipQualityChipColor(info.ipQuality);
  const title = info.ipQualityHint || info.ipQualityLabel;

  return (
    <Chip size="sm" color={color} title={title}>
      {info.ipQualityLabel}
    </Chip>
  );
}