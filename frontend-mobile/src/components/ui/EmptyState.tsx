import { IconProxy } from './Icons';

interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: React.ReactNode;
}

export default function EmptyState({ title, description, icon }: EmptyStateProps) {
  return (
    <div className="empty-state animate-fade-up">
      <div className="empty-state-icon" aria-hidden>
        {icon ?? <IconProxy />}
      </div>
      <div className="empty-state-title">{title}</div>
      {description ? <div className="empty-state-desc">{description}</div> : null}
    </div>
  );
}