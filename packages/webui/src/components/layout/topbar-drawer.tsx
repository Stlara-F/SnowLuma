import { useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { LogOut, Monitor, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme-toggle';
import { useTabNavigate } from '@/hooks/use-tab-navigate';
import { useKiosk } from '@/contexts/KioskContext';
import { cn } from '@/lib/utils';

// ─── TopBarDrawer ────────────────────────────────────────────────────────────
// Floating panel that appears from the right side of the top bar on hover.
// Shows status, theme toggle, kiosk button, settings shortcut, logout.

interface TopBarDrawerProps {
  open: boolean;
  onClose: () => void;
  status: string;
  onLogout: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

export function TopBarDrawer({ open, onClose, status, onLogout, onMouseEnter, onMouseLeave }: TopBarDrawerProps) {
  const { navigateTo } = useTabNavigate();
  const { enter: enterKiosk } = useKiosk();
  const online = status === '已连接';

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const handleSettings = useCallback(() => {
    navigateTo('/settings');
    onClose();
  }, [navigateTo, onClose]);

  const handleKiosk = useCallback(() => {
    enterKiosk();
    onClose();
  }, [enterKiosk, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, x: 8 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 8 }}
          transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
          onMouseEnter={onMouseEnter}
          onMouseLeave={onMouseLeave}
          className="absolute right-0 top-full z-50 w-[200px] border-b border-l bg-background/95 p-3 shadow-lg backdrop-blur-sm"
        >
          <div className="flex flex-col gap-2">
            {/* Status */}
            <div className="flex items-center gap-2 text-xs">
              <span
                className={cn(
                  'size-2 rounded-full',
                  online ? 'bg-success animate-pulse' : 'bg-destructive',
                )}
              />
              <span className="text-muted-foreground">{status}</span>
            </div>

            {/* Theme toggle */}
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">主题</span>
              <ThemeToggle />
            </div>

            {/* Kiosk */}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleKiosk}
              className="justify-start gap-2 text-xs"
            >
              <Monitor className="size-3.5" />
              展示模式
            </Button>

            {/* Settings */}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSettings}
              className="justify-start gap-2 text-xs"
            >
              <Settings className="size-3.5" />
              系统设置
            </Button>

            {/* Logout */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { onLogout(); onClose(); }}
              className="justify-start gap-2 text-xs text-destructive hover:text-destructive"
            >
              <LogOut className="size-3.5" />
              登出
            </Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
