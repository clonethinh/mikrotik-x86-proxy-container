import SearchBar from './SearchBar';

interface PageToolbarInlineProps {
  search?: {
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
  };
  children?: React.ReactNode;
}

/** Toolbar nằm trong ListPageTop — không bọc Panel thêm */
export default function PageToolbarInline({ search, children }: PageToolbarInlineProps) {
  return (
    <div className="page-toolbar-inline">
      {search ? (
        <SearchBar value={search.value} onChange={search.onChange} placeholder={search.placeholder} />
      ) : null}
      {children ? <div className="page-toolbar-inline-body">{children}</div> : null}
    </div>
  );
}