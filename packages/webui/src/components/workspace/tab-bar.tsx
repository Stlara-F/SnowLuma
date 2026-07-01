import { useCallback, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { useTabs } from '@/contexts/TabContext';
import { cn } from '@/lib/utils';

// ─── TabBar ──────────────────────────────────────────────────────────────────
// Horizontal tab bar with drag-to-reorder, close (× + middle-click), and
// scroll overflow. No right-click context menu.

// Page icon mapping — resolved from iconName (which is the pageId for built-in pages).
import {
  LayoutDashboard, PlugZap, Settings, Terminal, Bug, SlidersHorizontal,
} from 'lucide-react';

const PAGE_ICONS: Record<string, typeof LayoutDashboard> = {
  overview: LayoutDashboard,
  processes: PlugZap,
  config: Settings,
  logs: Terminal,
  debug: Bug,
  settings: SlidersHorizontal,
};

export function TabBar() {
  const { tabs, activeTabId, activateTab, closeTab, reorderTabs } = useTabs();
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  const handleDragStart = useCallback((e: React.DragEvent, index: number) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));
    setDragIndex(index);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setOverIndex(index);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, toIndex: number) => {
    e.preventDefault();
    const fromIndex = dragIndex;
    if (fromIndex !== null && fromIndex !== toIndex) {
      reorderTabs(fromIndex, toIndex);
    }
    setDragIndex(null);
    setOverIndex(null);
  }, [dragIndex, reorderTabs]);

  const handleDragEnd = useCallback(() => {
    setDragIndex(null);
    setOverIndex(null);
  }, []);

  const handleMiddleClick = useCallback((e: React.MouseEvent, tabId: string) => {
    if (e.button === 1) {
      e.preventDefault();
      closeTab(tabId);
    }
  }, [closeTab]);

  if (tabs.length === 0) return null;

  return (
    <div
      ref={barRef}
      className="flex h-9 shrink-0 items-center border-b bg-muted/30"
    >
      <ScrollArea className="flex-1" viewportClassName="[&>div]:!flex [&>div]:!h-full">
        <div className="flex h-full items-stretch gap-px">
          {tabs.map((tab, index) => {
            const isActive = tab.id === activeTabId;
            const Icon = PAGE_ICONS[tab.iconName] ?? LayoutDashboard;
            const isDragging = dragIndex === index;
            const isOver = overIndex === index && dragIndex !== index;

            return (
              <div
                key={tab.id}
                draggable
                onDragStart={(e) => handleDragStart(e, index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDrop={(e) => handleDrop(e, index)}
                onDragEnd={handleDragEnd}
                onMouseDown={(e) => handleMiddleClick(e, tab.id)}
                onClick={() => activateTab(tab.id)}
                className={cn(
                  'group flex items-center gap-1.5 border-r px-3 text-xs font-medium transition-colors select-none cursor-pointer',
                  isActive
                    ? 'bg-background text-foreground'
                    : 'text-muted-foreground hover:bg-background/50 hover:text-foreground',
                  isDragging && 'opacity-50',
                  isOver && 'border-primary/50',
                )}
              >
                <Icon className="size-3.5 shrink-0" />
                <span className="max-w-[120px] truncate">{tab.label}</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(tab.id);
                  }}
                  className={cn(
                    'ml-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-sm transition-colors cursor-pointer',
                    'text-muted-foreground/50 hover:bg-muted hover:text-foreground',
                    !isActive && 'opacity-0 group-hover:opacity-100',
                  )}
                  aria-label={`关闭 ${tab.label}`}
                >
                  <X className="size-3" />
                </button>
              </div>
            );
          })}
        </div>
        <ScrollBar orientation="horizontal" className="h-1.5" />
      </ScrollArea>
    </div>
  );
}
