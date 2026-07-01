import { useCallback } from 'react';
import { useTabs } from '@/contexts/TabContext';
import type { TabItem } from '@/types';

/** Map route paths to tab pageIds. */
const ROUTE_TO_PAGE: Record<string, TabItem['pageId']> = {
  '/': 'overview',
  '/processes': 'processes',
  '/config': 'config',
  '/logs': 'logs',
  '/debug': 'debug',
  '/settings': 'settings',
};

/** Reverse map: pageId to route path. */
const PAGE_TO_ROUTE: Record<TabItem['pageId'], string> = {
  overview: '/',
  processes: '/processes',
  config: '/config',
  logs: '/logs',
  debug: '/debug',
  settings: '/settings',
  vnc: '/',
};

export interface TabNavigateResult {
  /** Open/activate a tab for the given route path. */
  navigateTo: (routePath: string, opts?: { label?: string }) => void;
  /** Open/activate a tab for the given pageId. */
  navigateToPage: (pageId: TabItem['pageId'], opts?: { label?: string }) => void;
  /** Check if a route path corresponds to the currently active tab. */
  isActive: (routePath: string) => boolean;
  /** Get the route path for the active tab. */
  activeRoute: string | null;
}

/**
 * Hook that replaces router-based navigation with tab-based navigation.
 * Use this in components that previously used `<Link to={...}>` or `useNavigate()`.
 */
export function useTabNavigate(): TabNavigateResult {
  const { openTab, activeTabId, tabs } = useTabs();

  const navigateTo = useCallback((
    routePath: string,
    opts?: { label?: string },
  ) => {
    const pageId = ROUTE_TO_PAGE[routePath];
    if (pageId) {
      openTab(pageId, { label: opts?.label });
    }
  }, [openTab]);

  const navigateToPage = useCallback((
    pageId: TabItem['pageId'],
    opts?: { label?: string },
  ) => {
    openTab(pageId, { label: opts?.label });
  }, [openTab]);

  const activeRoute = activeTabId
    ? PAGE_TO_ROUTE[tabs.find((t) => t.id === activeTabId)?.pageId ?? 'overview'] ?? null
    : null;

  const isActive = useCallback((routePath: string) => {
    return activeRoute === routePath;
  }, [activeRoute]);

  return { navigateTo, navigateToPage, isActive, activeRoute };
}

export { ROUTE_TO_PAGE, PAGE_TO_ROUTE };
