import { Spinner } from '@heroui/react';

export default function LoadingScreen({ label = 'Đang tải…' }: { label?: string }) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 animate-fade-in">
      <div className="loading-orbit">
        <Spinner size="lg" />
      </div>
      <span className="loading-text-pulse text-sm text-muted">{label}</span>
    </div>
  );
}