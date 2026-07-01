import { useState, useCallback, useRef } from 'react';
import { Bug, LayoutDashboard, PlugZap, Settings, Terminal, SlidersHorizontal, Sparkles } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { APP_NAME, APP_VERSION } from '@/types';
import { useAppState } from '@/contexts/AppStateContext';
import { reconcileLayoutItems, useLayout } from '@/contexts/LayoutContext';
import { SidebarDropdown } from '@/components/layout/sidebar-dropdown';
import { useTabs } from '@/contexts/TabContext';
import type { AppPath } from '@/router';

export interface NavItem {
  to: AppPath;
  label: string;
  icon: typeof LayoutDashboard;
  description: string;
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: '总览', icon: LayoutDashboard, description: '主机与服务状态' },
  { to: '/processes', label: '进程注入', icon: PlugZap, description: '加载 / 卸载 / 登录' },
  { to: '/config', label: '节点配置', icon: Settings, description: 'OneBot 协议端点' },
  { to: '/logs', label: '日志', icon: Terminal, description: '实时事件流' },
  { to: '/debug', label: '调试', icon: Bug, description: '测试台与实时活动' },
  { to: '/settings', label: '系统设置', icon: SlidersHorizontal, description: '主题与账号' },
];

export const PINNED_NAV: AppPath[] = ['/', '/settings'];

/** Horizontal menu items for the title bar (overview excluded — persistent in right 1/4). */
const TITLEBAR_MENUS = [
  { id: 'processes', label: '进程注入', icon: PlugZap },
  { id: 'config', label: '节点配置', icon: Settings },
  { id: 'logs', label: '日志', icon: Terminal },
  { id: 'debug', label: '调试', icon: Bug },
  { id: 'settings', label: '系统设置', icon: SlidersHorizontal },
] as const;

/** Ms to wait before closing dropdown after mouse leaves both trigger and panel. */
const CLOSE_DELAY_MS = 150;

interface SidebarProps {
  /** Desktop: fixed title bar mode. Mobile: full nav in Sheet. */
  mode?: 'titlebar' | 'full';
  onItemClick?: () => void;
}

/**
 * Sidebar component.
 * - `mode="titlebar"` (default): Fixed 48px title bar with horizontal menu + dropdown.
 *   Used in the desktop top row.
 * - `mode="full"`: Full navigation list. Used in the mobile Sheet.
 */
export function Sidebar({ mode = 'titlebar', onItemClick }: SidebarProps) {
  const { updateInfo } = useAppState();
  const { openTab } = useTabs();
  const { navItems } = useLayout();
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => {
      setActiveMenuId(null);
      closeTimerRef.current = null;
    }, CLOSE_DELAY_MS);
  }, [clearCloseTimer]);

  const handleMenuEnter = useCallback((menuId: string) => {
    clearCloseTimer();
    setActiveMenuId(menuId);
  }, [clearCloseTimer]);

  const handleMenuLeave = useCallback(() => {
    scheduleClose();
  }, [scheduleClose]);

  const handleDropdownEnter = useCallback(() => {
    clearCloseTimer();
  }, [clearCloseTimer]);

  const handleDropdownLeave = useCallback(() => {
    scheduleClose();
  }, [scheduleClose]);

  // ─── Title bar mode (desktop) ──────────────────────────────────────────
  if (mode === 'titlebar') {
    return (
      <div className="relative z-40 flex h-full w-full items-center bg-sidebar text-sidebar-foreground">
        {/* Brand (fixed width) */}
        <div className="flex h-12 shrink-0 items-center gap-2.5 px-4">
          <div className="relative flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-primary/10 ring-1 ring-primary/20">
            <img src="/logo.png" alt="SnowLuma" className="size-6 object-contain" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-1.5">
              <span className="text-sm font-bold tracking-tight">{APP_NAME}</span>
              <span className="text-[10px] font-medium text-muted-foreground tabular-nums">v{APP_VERSION}</span>
            </div>
          </div>
        </div>

        {/* Separator */}
        <div className="mx-1 h-6 w-px shrink-0 bg-border" />

        {/* Horizontal menu items — each wraps its own dropdown */}
        <nav className="flex h-full items-center gap-1 px-2">
          {TITLEBAR_MENUS.map((menu) => {
            const Icon = menu.icon;
            const isActive = activeMenuId === menu.id;
            return (
              <div
                key={menu.id}
                className="relative h-full flex items-center"
                onMouseEnter={() => handleMenuEnter(menu.id)}
                onMouseLeave={handleMenuLeave}
              >
                <button
                  type="button"
                  className={cn(
                    'flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium transition-colors cursor-pointer',
                    isActive
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                  )}
                >
                  <Icon className="size-3.5 shrink-0" />
                  <span className="whitespace-nowrap">{menu.label}</span>
                </button>

                {/* Dropdown panel — positioned directly below this menu item (no gap) */}
                <SidebarDropdown
                  menuId={menu.id}
                  open={isActive}
                  onClose={() => setActiveMenuId(null)}
                  onMouseEnter={handleDropdownEnter}
                  onMouseLeave={handleDropdownLeave}
                />
              </div>
            );
          })}
        </nav>

        {/* Update info indicator */}
        {updateInfo?.hasUpdate && (
          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary/50" />
        )}
      </div>
    );
  }

  // ─── Full nav mode (mobile Sheet) ──────────────────────────────────────
  return (
    <div className="flex h-full w-full flex-col bg-sidebar text-sidebar-foreground">
      {/* Brand */}
      <div className="flex h-16 items-center gap-3 px-4">
        <div className="relative flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-primary/10 ring-1 ring-primary/20">
          <img src="/logo.png" alt="SnowLuma" className="size-7 object-contain" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <span className="text-sm font-bold tracking-tight">{APP_NAME}</span>
            <span className="text-[10px] font-medium text-muted-foreground tabular-nums">v{APP_VERSION}</span>
          </div>
          <span className="text-[10px] text-muted-foreground">OneBot v11 控制台</span>
        </div>
      </div>

      {/* Nav */}
      <ScrollArea className="flex-1 min-h-0" viewportClassName="[&>div]:!block">
        <nav className="flex flex-col gap-1 p-2">
          {(() => {
            const reconciled = reconcileLayoutItems(navItems, NAV_ITEMS.map((i) => i.to), PINNED_NAV);
            const orderedNav = reconciled
              .filter((i) => i.visible)
              .map((i) => NAV_ITEMS.find((n) => n.to === i.id))
              .filter((n): n is NavItem => !!n);
            return orderedNav.map(({ to, label, icon: Icon, description }) => (
              <button
                key={to}
                type="button"
                onClick={onItemClick}
                className="group relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent/40 hover:text-foreground cursor-pointer"
              >
                <Icon className="relative z-10 size-4 shrink-0" />
                <span className="relative z-10 flex min-w-0 flex-1 flex-col items-start">
                  <span className="truncate leading-tight">{label}</span>
                  <span className="text-[10px] font-normal text-muted-foreground truncate">{description}</span>
                </span>
              </button>
            ));
          })()}
        </nav>
      </ScrollArea>

      {updateInfo?.hasUpdate && (
        <div className="px-2 pt-2">
          <button
            type="button"
            onClick={() => openTab('settings')}
            title={updateInfo.latest ? `有新版本 v${updateInfo.latest}` : '有可用更新'}
            className="group relative flex w-full items-center gap-2.5 rounded-lg bg-primary/[0.1] px-3 py-2 cursor-pointer text-left transition-colors hover:bg-primary/[0.15]"
          >
            <Sparkles className="size-4 shrink-0 text-primary" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-xs font-medium leading-tight text-foreground">有新版本可用</span>
              <span className="truncate text-[10px] text-muted-foreground">v{updateInfo.latest}</span>
            </span>
          </button>
        </div>
      )}
      <div className="px-4 py-3 text-[10px] text-muted-foreground">
        {`© ${new Date().getFullYear()} SnowLuma`}
      </div>
    </div>
  );
}
