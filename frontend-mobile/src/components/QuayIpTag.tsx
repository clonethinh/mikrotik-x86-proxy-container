import { Chip } from '@heroui/react';
import type { WanInfo } from '../services/api';

type QuayIpFields = Pick<WanInfo, 'quayipStatus' | 'quayipLabel'>;

function quayipChipColor(status: NonNullable<WanInfo['quayipStatus']>): 'success' | 'danger' | 'warning' | 'default' {
  if (status === 'ok') return 'success';
  if (status === 'dead') return 'danger';
  if (status === 'rotating' || status === 'unknown') return 'warning';
  return 'default';
}

export default function QuayIpTag({ quayipStatus, quayipLabel }: QuayIpFields) {
  if (!quayipStatus || quayipStatus === 'protected' || !quayipLabel) return null;

  return (
    <Chip size="sm" color={quayipChipColor(quayipStatus)} title="Script quayip trên router (comment OK/DEAD)">
      {quayipLabel}
    </Chip>
  );
}