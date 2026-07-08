import type { ReactNode } from 'react';
import { Typography } from 'antd';
import PageHeader from '../ui/PageHeader';
import DismissibleAlert from '../ui/DismissibleAlert';

const { Text } = Typography;

export interface ProxyPageShellProps {
  title: ReactNode;
  subtitle?: ReactNode;
  extra?: ReactNode;
  policy?: { id: string; message: string; description?: ReactNode };
  stats?: ReactNode;
  toolbar?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Table page: fill remaining viewport height */
  fillViewport?: boolean;
  compactHeader?: boolean;
}

export default function ProxyPageShell({
  title,
  subtitle,
  extra,
  policy,
  stats,
  toolbar,
  children,
  className,
  fillViewport,
  compactHeader,
}: ProxyPageShellProps) {
  const pageClass = [
    'proxy-page',
    fillViewport ? 'proxy-page--fill' : '',
    className ?? '',
  ].filter(Boolean).join(' ');

  const body = (
    <>
      {stats}
      {toolbar}
      {children}
    </>
  );

  return (
    <div className={pageClass}>
      <PageHeader
        title={title}
        subtitle={subtitle}
        extra={extra}
        compact={compactHeader}
      />

      {policy && (
        <DismissibleAlert
          bannerId={policy.id}
          className="proxy-policy-banner"
          type="info"
          showIcon
          style={{ marginBottom: fillViewport ? 10 : 16 }}
          message={policy.message}
          description={policy.description}
        />
      )}

      {fillViewport ? <div className="proxy-page__fill-body">{body}</div> : body}
    </div>
  );
}

export function ProxyCode({ children }: { children: ReactNode }) {
  return <Text code>{children}</Text>;
}