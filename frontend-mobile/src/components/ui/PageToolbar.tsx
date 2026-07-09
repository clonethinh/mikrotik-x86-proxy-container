import Panel from './Panel';
import SearchBar from './SearchBar';

interface PageToolbarProps {
  children?: React.ReactNode;
  className?: string;
  search?: {
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
  };
  /** Nội dung dưới search: filter, actions */
  extra?: React.ReactNode;
}

/** Toolbar cố định — search trên, filter/actions dưới, luôn hiển thị */
export default function PageToolbar({ children, className = '', search, extra }: PageToolbarProps) {
  const body = extra ?? children;
  return (
    <Panel className={`page-toolbar ${className}`}>
      {search ? (
        <SearchBar value={search.value} onChange={search.onChange} placeholder={search.placeholder} />
      ) : null}
      {body ? <div className="page-toolbar-body">{body}</div> : null}
    </Panel>
  );
}