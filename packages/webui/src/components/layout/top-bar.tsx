import { useState, useCallback, useRef } from 'react';
import { Menu, PanelRightOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTabNavigate } from '@/hooks/use-tab-navigate';
import { NAV_ITEMS } from '@/components/layout/sidebar';
import { TopBarDrawer } from '@/components/layout/topbar-drawer';

// Toggleable top-bar elements (kept for settings compatibility).
export const TOPBAR_CATALOGUE: { id: string; label: string }[] = [
  { id: 'status', label: '连接状态徽章' },
  { id: 'theme', label: '主题切换按钮' },
  { id: 'kiosk', label: '展示模式按钮' },
];

/** Ms to wait before closing drawer after mouse leaves both trigger and panel. */
const CLOSE_DELAY_MS = 150;

interface TopBarProps {
  status: string;
  onOpenMobile: () => void;
  onLogout: () => void;
  isMobile: boolean;
}

/**
 * TopBar — fixed 48px status bar.
 * - Left: current page title
 * - Right: drawer trigger (opens TopBarDrawer on hover)
 * - Mobile: hamburger menu button
 */
export function TopBar({ status, onOpenMobile, onLogout, isMobile }: TopBarProps) {
  const { activeRoute } = useTabNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const meta = NAV_ITEMS.find((n) => n.to === activeRoute);
  const PageIcon = meta?.icon;

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => {
      setDrawerOpen(false);
      closeTimerRef.current = null;
    }, CLOSE_DELAY_MS);
  }, [clearCloseTimer]);

  const handleTriggerEnter = useCallback(() => {
    if (!isMobile) {
      clearCloseTimer();
      setDrawerOpen(true);
    }
  }, [isMobile, clearCloseTimer]);

  const handleTriggerLeave = useCallback(() => {
    if (!isMobile) scheduleClose();
  }, [isMobile, scheduleClose]);

  const handleDrawerEnter = useCallback(() => {
    clearCloseTimer();
  }, [clearCloseTimer]);

  const handleDrawerLeave = useCallback(() => {
    scheduleClose();
  }, [scheduleClose]);

  return (
    <div className="relative flex h-12 shrink-0 items-center bg-background/55 backdrop-blur-xl">
      {/* Mobile menu trigger */}
      {isMobile && (
        <Button variant="ghost" size="icon-sm" onClick={onOpenMobile} aria-label="打开菜单">
          <Menu className="size-4" />
        </Button>
      )}

      {/* Page title */}
      <div className="flex min-w-0 items-center gap-2 px-3">
        {PageIcon && <PageIcon className="size-4 text-primary" />}
        <h1 className="truncate text-sm font-semibold tracking-tight">{meta?.label ?? 'SnowLuma'}</h1>
        {meta?.description && (
          <span className="hidden sm:inline truncate text-xs text-muted-foreground">{meta.description}</span>
        )}
      </div>

      {/* Drawer trigger + panel — wrapped in relative so the drawer has zero-gap positioning */}
      <div
        className="ml-auto relative flex h-full items-center"
        onMouseEnter={handleTriggerEnter}
        onMouseLeave={handleTriggerLeave}
      >
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-foreground"
          aria-label="打开面板"
          title="状态与设置"
        >
          <PanelRightOpen className="size-4" />
        </Button>

        {/* Floating drawer panel */}
        <TopBarDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          status={status}
          onLogout={onLogout}
          onMouseEnter={handleDrawerEnter}
          onMouseLeave={handleDrawerLeave}
        />
      </div>
    </div>
  );
}
