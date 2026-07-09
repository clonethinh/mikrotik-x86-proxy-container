interface MotionListProps {
  children: React.ReactNode;
  className?: string;
}

/** Danh sách — CSS gap only, không stagger JS (perf danh sách 100+ item) */
export function MotionList({ children, className = '' }: MotionListProps) {
  return <div className={`mobile-list ${className}`}>{children}</div>;
}

interface MotionListItemProps {
  children: React.ReactNode;
  className?: string;
}

/** Item trong MotionList — dùng khi không qua ListCard */
export function MotionListItem({ children, className = '' }: MotionListItemProps) {
  return <div className={className}>{children}</div>;
}