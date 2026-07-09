import { Chip } from '@heroui/react';
import { isUiPreview } from '../../lib/env';

export default function PreviewBanner() {
  if (!isUiPreview) return null;
  return (
    <div className="preview-banner">
      <Chip size="sm" color="warning">Preview</Chip>
      <span>Dữ liệu ảo — không kết nối router thật</span>
    </div>
  );
}