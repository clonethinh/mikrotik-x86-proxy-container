interface DataRowProps {
  primary: React.ReactNode;
  secondary?: React.ReactNode;
  meta?: React.ReactNode;
  trailing?: React.ReactNode;
  mono?: string;
  onClick?: () => void;
  className?: string;
}

/** Hàng dữ liệu dạng bảng — nhiều field trên ít chiều cao */
export default function DataRow({
  primary,
  secondary,
  meta,
  trailing,
  mono,
  onClick,
  className = '',
}: DataRowProps) {
  const Tag = onClick ? 'button' : 'div';

  return (
    <Tag
      type={onClick ? 'button' : undefined}
      className={`data-dense-row ${onClick ? 'data-dense-row-clickable' : ''} ${className}`}
      onClick={onClick}
    >
      <div className="data-dense-main min-w-0">
        <div className="data-dense-primary">{primary}</div>
        {secondary ? <div className="data-dense-secondary">{secondary}</div> : null}
        {mono ? <div className="data-dense-mono">{mono}</div> : null}
      </div>
      {meta ? <div className="data-dense-meta">{meta}</div> : null}
      {trailing ? <div className="data-dense-trailing">{trailing}</div> : null}
    </Tag>
  );
}

interface DataRowListProps {
  children: React.ReactNode;
  className?: string;
}

export function DataRowList({ children, className = '' }: DataRowListProps) {
  return <div className={`data-dense-list ${className}`}>{children}</div>;
}