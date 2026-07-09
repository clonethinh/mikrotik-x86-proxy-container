import { MotionList } from './MotionList';

interface RecordListProps {
  children: React.ReactNode;
  className?: string;
}

/** Danh sách bản ghi — gap & animation đồng nhất */
export default function RecordList({ children, className = '' }: RecordListProps) {
  return <MotionList className={`record-list ${className}`}>{children}</MotionList>;
}