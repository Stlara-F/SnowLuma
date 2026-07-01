import { Suspense, useEffect, useRef, useState, type ComponentType } from 'react';
import { useTabs } from '@/contexts/TabContext';
import { Skeleton } from '@/components/ui/skeleton';
import type { TabItem } from '@/types';

// ─── TabContent ──────────────────────────────────────────────────────────────
// Renders a single tab's page content. Handles:
// - Lazy loading via dynamic import
// - Scroll position save/restore
// - Unmount after 30s of inactivity (with 3-tab keep-alive buffer)

interface TabContentProps {
  tab: TabItem;
  isActive: boolean;
}

/** How many of the most-recently-active tabs to keep mounted. */
const KEEP_ALIVE_COUNT = 3;

/** Ms after which an inactive tab is unmounted. */
const UNMOUNT_AFTER_MS = 30_000;

export function TabContent({ tab, isActive }: TabContentProps) {
  const { getPageLoader, saveScrollPosition, getScrollPosition, tabs } = useTabs();
  const [Component, setComponent] = useState<ComponentType<Record<string, unknown>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const unmountTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [shouldRender, setShouldRender] = useState(true);

  // Lazy-load the page component on mount.
  useEffect(() => {
    let cancelled = false;
    const loader = getPageLoader(tab.pageId);
    loader()
      .then((mod) => {
        if (!cancelled) setComponent(() => mod.default);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => { cancelled = true; };
  }, [tab.pageId, getPageLoader]);

  // Save scroll position on scroll (throttled).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let ticking = false;
    const onScroll = () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(() => {
          saveScrollPosition(tab.id, el.scrollTop);
          ticking = false;
        });
      }
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [tab.id, saveScrollPosition]);

  // Restore scroll position when becoming active.
  useEffect(() => {
    if (isActive && containerRef.current) {
      const saved = getScrollPosition(tab.id);
      if (saved !== undefined) {
        requestAnimationFrame(() => {
          if (containerRef.current) containerRef.current.scrollTop = saved;
        });
      }
    }
  }, [isActive, tab.id, getScrollPosition]);

  // Unmount timer: when deactivated, start a countdown to unmount.
  useEffect(() => {
    if (isActive) {
      // Cancel any pending unmount.
      if (unmountTimer.current) {
        clearTimeout(unmountTimer.current);
        unmountTimer.current = null;
      }
      setShouldRender(true);
      return;
    }

    // Count how many tabs are "more recent" than this one.
    const myTab = tabs.find((t) => t.id === tab.id);
    if (!myTab) return;
    const recentCount = tabs.filter((t) => t.lastActiveTime > myTab.lastActiveTime).length;

    // If this tab is in the keep-alive buffer, don't set a timer.
    if (recentCount < KEEP_ALIVE_COUNT) return;

    // Otherwise, unmount after the delay.
    unmountTimer.current = setTimeout(() => {
      setShouldRender(false);
      unmountTimer.current = null;
    }, UNMOUNT_AFTER_MS);

    return () => {
      if (unmountTimer.current) {
        clearTimeout(unmountTimer.current);
        unmountTimer.current = null;
      }
    };
  }, [isActive, tab.id, tabs]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-destructive">
        页面加载失败: {error}
      </div>
    );
  }

  if (!shouldRender) {
    // Show a lightweight placeholder while unmounted.
    return <div className="h-full w-full" />;
  }

  return (
    <div ref={containerRef} className="h-full w-full overflow-auto">
      {Component ? (
        <Suspense fallback={<TabFallback />}>
          {tab.pageId === 'vnc' ? (
            <Component vncPid={tab.vncPid} vncProcessName={tab.vncProcessName} />
          ) : tab.pageId === 'config' ? (
            <Component {...{ configUin: tab.configUin, configLabel: tab.configLabel }} />
          ) : (
            <Component />
          )}
        </Suspense>
      ) : (
        <TabFallback />
      )}
    </div>
  );
}

function TabFallback() {
  return (
    <div className="flex flex-col gap-4 p-6">
      <Skeleton className="h-9 w-48" />
      <Skeleton className="h-10" />
      <Skeleton className="h-32" />
      <Skeleton className="h-32" />
    </div>
  );
}
