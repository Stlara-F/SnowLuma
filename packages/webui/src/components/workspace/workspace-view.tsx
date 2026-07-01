import { useEffect } from 'react';
import { useTabs } from '@/contexts/TabContext';
import { useLayout } from '@/contexts/LayoutContext';
import { TabBar } from './tab-bar';
import { TabContent } from './tab-content';
import { SplitView } from './split-view';
import { OverviewPanel } from './overview-panel';
import { ROUTE_TO_PAGE } from '@/hooks/use-tab-navigate';

// ─── WorkspaceView ───────────────────────────────────────────────────────────
// The main workspace container. Combines:
// - TabBar (horizontal tab strip at top)
// - Tab content area (single pane or split view)
// - OverviewPanel (collapsible right sidebar)

export function WorkspaceView() {
  const { tabs, activeTabId, splitTree, openTab } = useTabs();
  const { pages } = useLayout();

  // Open default route on first mount when no tabs exist.
  useEffect(() => {
    if (tabs.length === 0 && pages.defaultRoute) {
      const pageId = ROUTE_TO_PAGE[pages.defaultRoute];
      if (pageId) openTab(pageId);
    }
    // Run only on mount — tabs.length is stable in this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeTab = tabs.find((t) => t.id === activeTabId);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Tab bar row */}
      <TabBar />

      {/* Content area */}
      <div className="flex min-h-0 flex-1">
        {/* Main content (tab or split) */}
        <div className="min-w-0 flex-1 overflow-hidden">
          {splitTree ? (
            <SplitView activeTabId={activeTabId} />
          ) : activeTab ? (
            <TabContent tab={activeTab} isActive={true} />
          ) : (
            <EmptyState />
          )}
        </div>

        {/* Overview panel (collapsible, right side) */}
        <OverviewPanel />
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
      点击左侧菜单打开一个页面
    </div>
  );
}
