import { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useAppState } from '@/contexts/AppStateContext';
import { useTabs } from '@/contexts/TabContext';
import { useApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { LogLevel } from '@/types';

// ─── SidebarDropdown ─────────────────────────────────────────────────────────
// Floating overlay dropdown panel. Content varies by which menu is hovered.
// Positioned below the title bar — does NOT push content.

interface SidebarDropdownProps {
  menuId: string;
  open: boolean;
  onClose: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

const LOG_LEVELS: { level: LogLevel; label: string; color: string }[] = [
  { level: 'trace', label: 'TRACE', color: 'text-muted-foreground' },
  { level: 'debug', label: 'DEBUG', color: 'text-muted-foreground' },
  { level: 'info', label: 'INFO', color: 'text-blue-500' },
  { level: 'success', label: 'SUCCESS', color: 'text-green-500' },
  { level: 'warn', label: 'WARN', color: 'text-yellow-500' },
  { level: 'error', label: 'ERROR', color: 'text-red-500' },
];

const STATUS_MAP: Record<string, { dot: string; text: string }> = {
  available: { dot: 'bg-muted-foreground', text: '可连接' },
  loading: { dot: 'bg-blue-500', text: '加载中' },
  connecting: { dot: 'bg-yellow-500', text: '连接中' },
  loaded: { dot: 'bg-green-500', text: '已加载' },
  online: { dot: 'bg-green-500', text: '在线' },
  error: { dot: 'bg-red-500', text: '错误' },
  disconnected: { dot: 'bg-muted-foreground', text: '已断开' },
};

const ADAPTER_STATUS_MAP: Record<string, string> = {
  ok: 'bg-green-500',
  warn: 'bg-yellow-500',
  down: 'bg-red-500',
  disabled: 'bg-muted-foreground',
};

export function SidebarDropdown({ menuId, open, onClose, onMouseEnter, onMouseLeave }: SidebarDropdownProps) {
  const { processList, connections, qqList, setSelectedUin } = useAppState();
  const { openTab } = useTabs();
  const api = useApi();
  const [currentLevel, setCurrentLevel] = useState<LogLevel | null>(null);

  // Load current server log level when log menu is open.
  useEffect(() => {
    if (menuId !== 'logs' || !open) return;
    let active = true;
    api.logs.getLevel().then(({ level }) => {
      if (active) setCurrentLevel(level);
    }).catch(() => {});
    return () => { active = false; };
  }, [menuId, open, api]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const handleNodeClick = useCallback((uin: string, nickname: string) => {
    setSelectedUin(uin);
    openTab('config', { label: `节点配置 - ${nickname}`, configUin: uin, configLabel: nickname });
    onClose();
  }, [setSelectedUin, openTab, onClose]);

  const handleLogLevelClick = useCallback(async (level: LogLevel) => {
    try {
      await api.logs.setLevel(level);
      setCurrentLevel(level);
    } catch { /* ignore */ }
    openTab('logs');
    onClose();
  }, [api, openTab, onClose]);

  if (!menuId) return null;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
          onMouseEnter={onMouseEnter}
          onMouseLeave={onMouseLeave}
          className="absolute left-0 top-full z-50 border-b bg-background/95 shadow-lg backdrop-blur-sm"
        >
          {menuId === 'processes' && (
            <ProcessSubmenu processList={processList} />
          )}
          {menuId === 'config' && (
            <NodeSubmenu
              connections={connections}
              qqList={qqList}
              onNodeClick={handleNodeClick}
            />
          )}
          {menuId === 'logs' && (
            <LogSubmenu
              currentLevel={currentLevel}
              onLevelClick={handleLogLevelClick}
            />
          )}
          {menuId === 'debug' && (
            <SinglePageSubmenu label="调试" pageId="debug" onOpen={(pageId) => { void openTab(pageId); onClose(); }} />
          )}
          {menuId === 'settings' && (
            <SinglePageSubmenu label="系统设置" pageId="settings" onOpen={(pageId) => { void openTab(pageId); onClose(); }} />
          )}
          {menuId === 'overview' && (
            <SinglePageSubmenu label="总览" pageId="overview" onOpen={(pageId) => { void openTab(pageId); onClose(); }} />
          )}
          {menuId === 'vnc' && (
            <SinglePageSubmenu label="远程桌面" pageId="vnc" onOpen={(pageId) => { void openTab(pageId); onClose(); }} />
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ─── ProcessSubmenu ──────────────────────────────────────────────────────────
// Shows process status info. Not clickable — read-only display.

function ProcessSubmenu({ processList }: { processList: Array<{ pid: number; name: string; status: string; injected: boolean; connected: boolean; loggedIn: boolean; uin: string; method: string }> }) {
  return (
    <div className="w-[520px] p-3">
      <div className="mb-2 text-xs font-medium text-muted-foreground">进程状态</div>
      {processList.length === 0 ? (
        <div className="py-4 text-center text-xs text-muted-foreground">暂无进程</div>
      ) : (
        <div className="max-h-[50vh] overflow-auto">
          {/* Header */}
          <div className="flex items-center gap-2 border-b px-2 py-1 text-[10px] font-medium text-muted-foreground">
            <span className="w-[180px]">进程名 (PID)</span>
            <span className="w-[70px]">状态</span>
            <span className="w-[48px]">注入</span>
            <span className="w-[48px]">连接</span>
            <span className="w-[48px]">登录</span>
            <span className="w-[70px]">方法</span>
            <span className="min-w-0 flex-1">UIN</span>
          </div>
          {processList.map((p) => {
            const s = STATUS_MAP[p.status] ?? STATUS_MAP.available;
            return (
              <div
                key={p.pid}
                className="flex items-center gap-2 border-b border-border/50 px-2 py-1.5 text-[11px] font-mono last:border-b-0"
              >
                <span className="w-[180px] min-w-0 truncate text-foreground" title={p.name}>
                  {p.name}<span className="text-muted-foreground">({p.pid})</span>
                </span>
                <span className="flex w-[70px] items-center gap-1">
                  <span className={cn('size-1.5 rounded-full', s.dot)} />
                  <span className="text-muted-foreground">{s.text}</span>
                </span>
                <span className="w-[48px] text-muted-foreground">{p.injected ? '是' : '否'}</span>
                <span className="w-[48px] text-muted-foreground">{p.connected ? '是' : '否'}</span>
                <span className="w-[48px] text-muted-foreground">{p.loggedIn ? '是' : '否'}</span>
                <span className="w-[70px] truncate text-muted-foreground">{p.method}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{p.uin || '—'}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── NodeSubmenu ─────────────────────────────────────────────────────────────
// Shows online connection nodes. Clickable — opens config tab for that node.

interface NodeSubmenuProps {
  connections: Array<{
    uin: string;
    nickname: string;
    adapters: Array<{ name: string; status: string; detail: string }>;
  }>;
  qqList: Array<{ uin: string; nickname: string }>;
  onNodeClick: (uin: string, nickname: string) => void;
}

function NodeSubmenu({ connections, qqList, onNodeClick }: NodeSubmenuProps) {
  // Merge qqList with connections data — show all known accounts.
  const nodes = qqList.map((q) => {
    const conn = connections.find((c) => c.uin === q.uin);
    return {
      uin: q.uin,
      nickname: q.nickname || q.uin,
      adapters: conn?.adapters ?? [],
    };
  });

  return (
    <div className="w-[400px] p-3">
      <div className="mb-2 text-xs font-medium text-muted-foreground">节点配置</div>
      {nodes.length === 0 ? (
        <div className="py-4 text-center text-xs text-muted-foreground">暂无在线节点</div>
      ) : (
        <div className="max-h-[50vh] overflow-auto">
          {nodes.map((node) => (
            <button
              key={node.uin}
              type="button"
              onClick={() => onNodeClick(node.uin, node.nickname)}
              className="flex w-full items-center gap-3 rounded-lg border border-transparent px-2.5 py-2 text-left transition-colors hover:bg-accent/40 hover:border-border/50 cursor-pointer"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-foreground">{node.nickname}</div>
                <div className="font-mono text-[10px] text-muted-foreground tabular-nums">{node.uin}</div>
              </div>
              {/* Adapter status dots */}
              <div className="flex items-center gap-1.5">
                {node.adapters.length === 0 ? (
                  <span className="text-[10px] text-muted-foreground">无连接</span>
                ) : (
                  node.adapters.map((a) => (
                    <div key={a.name} className="flex items-center gap-1" title={`${a.name}: ${a.status}`}>
                      <span className={cn('size-1.5 rounded-full', ADAPTER_STATUS_MAP[a.status] ?? 'bg-muted-foreground')} />
                      <span className="text-[10px] text-muted-foreground">{a.name}</span>
                    </div>
                  ))
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── LogSubmenu ──────────────────────────────────────────────────────────────
// Shows server log level options. Clickable — sets level + opens logs tab.

function LogSubmenu({ currentLevel, onLevelClick }: {
  currentLevel: LogLevel | null;
  onLevelClick: (level: LogLevel) => void;
}) {
  return (
    <div className="w-[180px] p-3">
      <div className="mb-2 text-xs font-medium text-muted-foreground">服务端日志级别</div>
      <div className="flex flex-col gap-0.5">
        {LOG_LEVELS.map(({ level, label, color }) => (
          <button
            key={level}
            type="button"
            onClick={() => onLevelClick(level)}
            className={cn(
              'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-mono transition-colors cursor-pointer',
              currentLevel === level
                ? 'bg-primary/10 text-primary font-semibold'
                : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
            )}
          >
            <span className={cn('size-1.5 rounded-full', color)} />
            {label}
            {currentLevel === level && (
              <span className="ml-auto text-[10px] text-primary">当前</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── SinglePageSubmenu ───────────────────────────────────────────────────────
// Simple submenu with a single item that opens a page tab.

interface SinglePageSubmenuProps {
  label: string;
  pageId: 'overview' | 'debug' | 'settings' | 'vnc';
  onOpen: (pageId: "overview" | "processes" | "config" | "logs" | "debug" | "settings" | "vnc") => void;
}

function SinglePageSubmenu({ label, pageId, onOpen }: SinglePageSubmenuProps) {
  const handleOpen = useCallback(() => {
    onOpen(pageId);
  }, [pageId, onOpen]);

  return (
    <div className="w-[180px] p-3">
      <div className="mb-2 text-xs font-medium text-muted-foreground">{label}</div>
      <button
        type="button"
        onClick={handleOpen}
        className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer hover:bg-muted/50 hover:text-foreground"
      >
        {label}
      </button>
    </div>
  );
}
