import { Chip } from '@heroui/react';

interface Props {
  pppoeName: string;
  egressPppoeName?: string | null;
}

export default function EgressTag({ pppoeName, egressPppoeName }: Props) {
  const egress = egressPppoeName || pppoeName;
  if (egress === pppoeName) return null;
  return (
    <Chip size="sm" color="accent" title="IP egress từ WAN khác slot">
      egress {egress}
    </Chip>
  );
}