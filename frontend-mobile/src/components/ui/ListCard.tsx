import Panel from './Panel';

interface ListCardProps {
  children: React.ReactNode;
  selected?: boolean;
  className?: string;
}

/** Không bọc motion — danh sách dài (proxy/WAN) tránh stagger/layout thrashing */
function ListCardRoot({ children, selected, className = '' }: ListCardProps) {
  return (
    <Panel
      flush
      className={`list-card list-card-v2 ${selected ? 'list-card-selected' : ''} ${className}`}
    >
      {children}
    </Panel>
  );
}

function ListCardBody({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`list-card-body ${className}`}>{children}</div>;
}

function ListCardRow({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`list-card-row ${className}`}>{children}</div>;
}

function ListCardMain({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`list-card-main min-w-0 flex-1 ${className}`}>{children}</div>;
}

function ListCardTitle({ children }: { children: React.ReactNode }) {
  return <div className="list-card-title">{children}</div>;
}

function ListCardSubtitle({ children }: { children: React.ReactNode }) {
  return <div className="list-card-subtitle">{children}</div>;
}

function ListCardMeta({ children }: { children: React.ReactNode }) {
  return <div className="list-card-meta">{children}</div>;
}

function ListCardBadges({ children }: { children: React.ReactNode }) {
  return <div className="list-card-badges">{children}</div>;
}

function ListCardAside({ children }: { children: React.ReactNode }) {
  return <div className="list-card-aside">{children}</div>;
}

function ListCardSpark({ children }: { children: React.ReactNode }) {
  return <div className="list-card-spark">{children}</div>;
}

function ListCardActions({ children }: { children: React.ReactNode }) {
  return <div className="list-card-actions">{children}</div>;
}

const ListCard = Object.assign(ListCardRoot, {
  Body: ListCardBody,
  Row: ListCardRow,
  Main: ListCardMain,
  Title: ListCardTitle,
  Subtitle: ListCardSubtitle,
  Meta: ListCardMeta,
  Badges: ListCardBadges,
  Aside: ListCardAside,
  Spark: ListCardSpark,
  Actions: ListCardActions,
});

export default ListCard;