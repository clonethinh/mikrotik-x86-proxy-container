interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}

export default function SectionHeader({ title, subtitle, action }: SectionHeaderProps) {
  return (
    <div className="section-header animate-fade-up">
      <div className="min-w-0 flex-1">
        <div className="section-title">
          <span className="section-title-bar" aria-hidden />
          <span>{title}</span>
        </div>
        {subtitle ? <p className="section-subtitle">{subtitle}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}