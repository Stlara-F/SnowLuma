import { useState, type ReactNode } from 'react';
import { Minimize2 } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { Sidebar } from '@/components/layout/sidebar';
import { TopBar } from '@/components/layout/top-bar';
import { WorkspaceView } from '@/components/workspace/workspace-view';
import { useMediaQuery } from '@/hooks/use-media-query';
import { useTheme } from '@/contexts/ThemeContext';
import { useKiosk } from '@/contexts/KioskContext';
import { TabProvider } from '@/contexts/TabContext';
import { cn } from '@/lib/utils';

interface MainLayoutProps {
  status: string;
  onLogout: () => void;
  children?: ReactNode;
}

/**
 * MainLayout — two-row layout.
 * Row 1 (fixed 48px): Sidebar title bar (left 2/3) + TopBar status bar (right 1/3)
 * Row 2 (flex-1):     WorkspaceView (TabBar + content + OverviewPanel)
 *
 * The `children` prop is ignored in the new tab-based architecture.
 * WorkspaceView replaces the old <Outlet /> page rendering.
 */
export function MainLayout({ status, onLogout }: MainLayoutProps) {
  const isMobile = !useMediaQuery('(min-width: 768px)');
  const { appearance } = useTheme();
  const customBg = appearance.background.type !== 'none';
  const { kiosk, exit: exitKiosk } = useKiosk();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <TabProvider>
      <div className={cn('flex h-screen w-screen flex-col text-foreground', customBg ? 'bg-transparent' : 'bg-sidebar')}>
        {/* ─── Row 1: Top bar ────────────────────────────────────────────── */}
        {!kiosk && (
          <div className="relative z-40 flex h-12 shrink-0 items-stretch border-b">
            {/* Left 3/4: Sidebar title bar */}
            <div className="w-3/4 min-w-0">
              {!isMobile ? (
                <Sidebar mode="titlebar" />
              ) : (
                /* Mobile: hamburger trigger that opens the Sheet */
                <div className="flex h-full items-center px-4">
                  <button
                    type="button"
                    onClick={() => setMobileOpen(true)}
                    className="text-sm font-medium text-muted-foreground hover:text-foreground"
                  >
                    ☰
                  </button>
                </div>
              )}
            </div>

            {/* Right 1/4: TopBar status bar */}
            <div className="w-1/4 min-w-0 border-l">
              <TopBar
                status={status}
                onOpenMobile={() => setMobileOpen(true)}
                onLogout={onLogout}
                isMobile={isMobile}
              />
            </div>
          </div>
        )}

        {/* ─── Kiosk exit button ─────────────────────────────────────────── */}
        {kiosk && (
          <button
            type="button"
            onClick={exitKiosk}
            title="退出展示模式 (Esc)"
            aria-label="退出展示模式"
            className="fixed right-3 top-3 z-50 inline-flex size-9 items-center justify-center rounded-full border bg-background/70 text-muted-foreground opacity-30 backdrop-blur transition-opacity outline-none hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-[3px] focus-visible:ring-ring/40"
          >
            <Minimize2 className="size-4" />
          </button>
        )}

        {/* ─── Row 2: Content ────────────────────────────────────────────── */}
        <div
          className={cn(
            'flex min-h-0 flex-1 flex-col overflow-hidden',
            !customBg && 'bg-background',
          )}
        >
          <WorkspaceView />
        </div>

        {/* ─── Mobile sidebar sheet ──────────────────────────────────────── */}
        {isMobile && !kiosk && (
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetContent side="left" className="w-64 max-w-[80vw] p-0">
              <SheetTitle className="sr-only">导航菜单</SheetTitle>
              <SheetDescription className="sr-only">切换 SnowLuma 控制台的页面。</SheetDescription>
              <Sidebar mode="full" onItemClick={() => setMobileOpen(false)} />
            </SheetContent>
          </Sheet>
        )}
      </div>
    </TabProvider>
  );
}
