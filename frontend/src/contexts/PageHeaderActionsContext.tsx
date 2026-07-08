import {
  createContext, useContext, useState, useEffect, useMemo,
  type ReactNode,
} from 'react';

interface Ctx {
  actions: ReactNode;
  setActions: (node: ReactNode) => void;
}

const PageHeaderActionsContext = createContext<Ctx | null>(null);

export function PageHeaderActionsProvider({ children }: { children: ReactNode }) {
  const [actions, setActions] = useState<ReactNode>(null);
  const value = useMemo(() => ({ actions, setActions }), [actions]);
  return (
    <PageHeaderActionsContext.Provider value={value}>
      {children}
    </PageHeaderActionsContext.Provider>
  );
}

export function usePageHeaderActionsState(): ReactNode {
  const ctx = useContext(PageHeaderActionsContext);
  return ctx?.actions ?? null;
}

/** Gắn nút/toolbar vào header app — tự gỡ khi rời trang. */
export function useRegisterPageHeaderActions(actions: ReactNode) {
  const ctx = useContext(PageHeaderActionsContext);
  useEffect(() => {
    if (!ctx) return;
    ctx.setActions(actions);
    return () => ctx.setActions(null);
  }, [ctx, actions]);
}