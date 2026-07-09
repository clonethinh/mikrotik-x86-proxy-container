interface PageLayoutProps {
  children: React.ReactNode;
  /** Banner cảnh báo / bulk progress phía trên panel */
  banner?: React.ReactNode;
}

/** Khung trang — panel đầu (ListPageTop) + danh sách nằm trong children */
export default function PageLayout({ children, banner }: PageLayoutProps) {
  return (
    <div className="mobile-page">
      {banner}
      {children}
    </div>
  );
}