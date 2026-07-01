import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { SplitNode, TabItem } from '@/types';

// ─── Tab Context ─────────────────────────────────────────────────────────────
// Manages the open-tab list, active tab, split tree, and overview-panel
// visibility. The split tree itself is NOT persisted — only the ordered list
// of open tabs and the active tab id are saved to localStorage.

const STORAGE_KEY = 'snowluma-tabs';

interface StoredTabs {
  tabOrder: { id: string; pageId: string; label: string; iconName: string }[];
  activeTabId: string;
}

function loadStoredTabs(): StoredTabs | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoredTabs;
  } catch {
    return null;
  }
}

function saveStoredTabs(tabs: TabItem[], activeTabId: string) {
  try {
    const data: StoredTabs = {
      tabOrder: tabs.map((t) => ({ id: t.id, pageId: t.pageId, label: t.label, iconName: t.iconName })),
      activeTabId,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch { /* best-effort */ }
}

function makeTabId(pageId: string): string {
  return `${pageId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// Lazy-load page registry — maps pageId to a dynamic import function.
// Named exports are re-wrapped into a { default: Component } shape for
// consistency with React.lazy / Suspense expectations.
const PAGE_REGISTRY: Record<TabItem['pageId'], () => Promise<{ default: React.ComponentType }>> = {
  overview: async () => {
    const mod = await import('@/components/pages/overview-page');
    return { default: mod.OverviewPage };
  },
  processes: async () => {
    const mod = await import('@/components/pages/processes-page');
    return { default: mod.ProcessesPage };
  },
  config: async () => {
    const mod = await import('@/components/pages/config-page');
    return { default: mod.ConfigPage };
  },
  logs: async () => {
    const mod = await import('@/components/pages/logs-page');
    return { default: mod.LogsPage };
  },
  debug: async () => {
    const mod = await import('@/components/pages/debug-page');
    return { default: mod.DebugPage };
  },
  settings: async () => {
    const mod = await import('@/components/pages/settings-page');
    return { default: mod.SettingsPage };
  },
  vnc: async () => {
    const mod = await import('@/components/pages/vnc-view-page');
    return { default: mod.VncViewPage };
  },
};

export interface TabContextValue {
  /** All open tabs in display order. */
  tabs: TabItem[];
  /** Currently active (visible) tab id. */
  activeTabId: string | null;
  /** The split tree (null = single-tab mode, no splits). */
  splitTree: SplitNode | null;
  /** Whether the overview panel is visible. */
  overviewPanelVisible: boolean;
  /** Open a tab for the given page. If already open, activates it. Returns the tab id. */
  openTab: (pageId: TabItem['pageId'], opts?: { label?: string; vncPid?: string; vncProcessName?: string; configUin?: string; configLabel?: string }) => string;
  /** Close a tab by id. Activates an adjacent tab if the closed one was active. */
  closeTab: (tabId: string) => void;
  /** Set the active tab. */
  activateTab: (tabId: string) => void;
  /** Reorder tabs (drag-drop). */
  reorderTabs: (fromIndex: number, toIndex: number) => void;
  /** Cache the scroll position for a tab (called before unmount). */
  saveScrollPosition: (tabId: string, scrollTop: number) => void;
  /** Get cached scroll position for a tab. */
  getScrollPosition: (tabId: string) => number | undefined;
  /** Split the active tab's pane. */
  splitTab: (direction: 'horizontal' | 'vertical') => void;
  /** Remove a split node (merge back). */
  removeSplit: (groupId: string) => void;
  /** Update split ratio. */
  updateSplitRatio: (groupId: string, ratio: number) => void;
  /** Toggle overview panel visibility. */
  setOverviewPanelVisible: (visible: boolean) => void;
  /** Get the page loader for a tab. */
  getPageLoader: (pageId: TabItem['pageId']) => () => Promise<{ default: React.ComponentType }>;
}

const TabContext = createContext<TabContextValue | null>(null);

export function TabProvider({ children }: { children: ReactNode }) {
  const [tabs, setTabs] = useState<TabItem[]>(() => {
    const stored = loadStoredTabs();
    if (!stored) return [];
    return stored.tabOrder.map((t) => ({
      id: t.id,
      pageId: t.pageId as TabItem['pageId'],
      label: t.label,
      iconName: t.iconName,
      lastActiveTime: Date.now(),
    }));
  });
  const [activeTabId, setActiveTabId] = useState<string | null>(() => {
    const stored = loadStoredTabs();
    return stored?.activeTabId ?? null;
  });
  const [splitTree, setSplitTree] = useState<SplitNode | null>(null);
  const [overviewPanelVisible, setOverviewPanelVisible] = useState(true);
  const scrollCache = useRef<Map<string, number>>(new Map());
  const unmountTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Persist tab list + active tab on every change.
  useEffect(() => {
    saveStoredTabs(tabs, activeTabId ?? '');
  }, [tabs, activeTabId]);

  const openTab = useCallback((
    pageId: TabItem['pageId'],
    opts?: { label?: string; vncPid?: string; vncProcessName?: string; configUin?: string; configLabel?: string },
  ): string => {
    // Non-VNC pages: check if a matching tab already exists.
    if (!opts?.vncPid) {
      if (pageId === 'config' && opts?.configUin) {
        // Config tabs are differentiated by configUin — reuse only if same UIN.
        const existing = tabs.find((t) => t.pageId === pageId && t.configUin === opts.configUin);
        if (existing) {
          setActiveTabId(existing.id);
          return existing.id;
        }
      } else {
        const existing = tabs.find((t) => t.pageId === pageId);
        if (existing) {
          setActiveTabId(existing.id);
          return existing.id;
        }
      }
    }

    const id = makeTabId(pageId);
    const now = Date.now();
    const newTab: TabItem = {
      id,
      pageId,
      label: opts?.label ?? pageId,
      iconName: pageId,
      lastActiveTime: now,
      vncPid: opts?.vncPid,
      vncProcessName: opts?.vncProcessName,
      configUin: opts?.configUin,
      configLabel: opts?.configLabel,
    };

    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(id);
    return id;
  }, [tabs]);

  const closeTab = useCallback((tabId: string) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === tabId);
      if (idx === -1) return prev;
      const next = prev.filter((t) => t.id !== tabId);

      // If we closed the active tab, activate an adjacent one.
      setActiveTabId((current) => {
        if (current !== tabId) return current;
        if (next.length === 0) return null;
        const newIdx = Math.min(idx, next.length - 1);
        return next[newIdx].id;
      });

      return next;
    });

    // Clear unmount timer for this tab.
    const timer = unmountTimers.current.get(tabId);
    if (timer) {
      clearTimeout(timer);
      unmountTimers.current.delete(tabId);
    }
  }, []);

  const activateTab = useCallback((tabId: string) => {
    setActiveTabId(tabId);
    setTabs((prev) =>
      prev.map((t) => (t.id === tabId ? { ...t, lastActiveTime: Date.now() } : t)),
    );
  }, []);

  const reorderTabs = useCallback((fromIndex: number, toIndex: number) => {
    setTabs((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  }, []);

  const saveScrollPosition = useCallback((tabId: string, scrollTop: number) => {
    scrollCache.current.set(tabId, scrollTop);
  }, []);

  const getScrollPosition = useCallback((tabId: string) => {
    return scrollCache.current.get(tabId);
  }, []);

  // ─── Split Tree Helpers ──────────────────────────────────────────────────

  const splitTab = useCallback((direction: 'horizontal' | 'vertical') => {
    setSplitTree((prev) => {
      if (!prev || prev.type === 'leaf') {
        // Single pane or no tree — create initial split.
        const tabId = activeTabId ?? tabs[0]?.id;
        if (!tabId) return prev;
        return {
          type: 'split',
          direction,
          groupId: `split-${Date.now()}`,
          ratio: 0.5,
          children: [
            { type: 'leaf', tabId },
            { type: 'leaf', tabId: tabId }, // duplicate for demo; will be replaced
          ],
        };
      }
      // TODO: split an existing leaf in the tree.
      return prev;
    });
  }, [activeTabId, tabs]);

  const removeSplit = useCallback((groupId: string) => {
    setSplitTree((prev) => {
      if (!prev || prev.type === 'leaf') return prev;
      if (prev.groupId === groupId) return prev.children[0]; // collapse to first child
      // TODO: recurse and remove nested splits.
      return prev;
    });
  }, []);

  const updateSplitRatio = useCallback((groupId: string, ratio: number) => {
    setSplitTree((prev) => {
      if (!prev || prev.type === 'leaf') return prev;
      if (prev.groupId === groupId) return { ...prev, ratio };
      return prev;
    });
  }, []);

  const getPageLoader = useCallback((pageId: TabItem['pageId']) => {
    return PAGE_REGISTRY[pageId];
  }, []);

  // ─── Cleanup stale unmount timers ────────────────────────────────────────
  useEffect(() => {
    const timers = unmountTimers.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
    };
  }, []);

  const value = useMemo<TabContextValue>(() => ({
    tabs,
    activeTabId,
    splitTree,
    overviewPanelVisible,
    openTab,
    closeTab,
    activateTab,
    reorderTabs,
    saveScrollPosition,
    getScrollPosition,
    splitTab,
    removeSplit,
    updateSplitRatio,
    setOverviewPanelVisible,
    getPageLoader,
  }), [
    tabs, activeTabId, splitTree, overviewPanelVisible,
    openTab, closeTab, activateTab, reorderTabs,
    saveScrollPosition, getScrollPosition,
    splitTab, removeSplit, updateSplitRatio, getPageLoader,
  ]);

  return <TabContext.Provider value={value}>{children}</TabContext.Provider>;
}

export function useTabs(): TabContextValue {
  const ctx = useContext(TabContext);
  if (!ctx) throw new Error('useTabs must be used within TabProvider');
  return ctx;
}
