import { useEffect, useMemo, useState } from 'react';
import { Reorder, motion } from 'motion/react';
import { Cpu, Eye, EyeOff, GripVertical, MemoryStick, PanelLeftClose, PanelLeftOpen, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn, formatBytes, formatUptime } from '@/lib/utils';
import type { LogEntry, LogLevel, UiLayoutItem } from '@/types';
import { useApi } from '@/lib/api';
import { useAppState } from '@/contexts/AppStateContext';
import { useSession } from '@/contexts/SessionContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useTabs } from '@/contexts/TabContext';
import { useLayout, reconcileLayoutItems } from '@/contexts/LayoutContext';
import {
  CONFIGURABLE_WIDGETS, HIDDEN_BY_DEFAULT_IDS, MOBILE_WIDGET_IDS,
  parseAccountConfig, parseAlertsConfig, parseConnectionsConfig, parseHostConfig,
  parseLinkConfig, parseNoteConfig, parseSessionsConfig,
  widgetLabel,
} from '@/lib/dashboard-layout';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AccountConfigForm, AlertsConfigForm, ConnectionsConfigForm, HostConfigForm,
  LinkConfigForm, LINK_ICON_COMPONENTS, NoteConfigForm, SessionsConfigForm,
} from '@/components/pages/widget-config-forms';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

// ─── OverviewPanel ───────────────────────────────────────────────────────────
// Full-featured compact right-side panel. Implements all OverviewPage widgets
// in a dense single-column layout. Edit mode supports drag-reorder & toggle.

export function OverviewPanel() {
  const { overviewPanelVisible, setOverviewPanelVisible } = useTabs();

  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => setOverviewPanelVisible(!overviewPanelVisible)}
        className="shrink-0 text-muted-foreground hover:text-foreground"
        aria-label={overviewPanelVisible ? '收起概览面板' : '展开概览面板'}
      >
        {overviewPanelVisible ? (
          <PanelLeftClose className="size-4 transition-transform duration-200" />
        ) : (
          <PanelLeftOpen className="size-4 transition-transform duration-200" />
        )}
      </Button>

      <motion.div
        initial={false}
        animate={{
          width: overviewPanelVisible ? 'min(30vw,340px)' : 0,
          opacity: overviewPanelVisible ? 1 : 0,
        }}
        transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
        className="flex h-full shrink-0 flex-col border-l bg-background overflow-hidden"
      >
        {overviewPanelVisible && <CompactOverview />}
      </motion.div>
    </>
  );
}

function CompactOverview() {
  const {
    overviewBlocks, setOverviewBlocks, overviewMobile, setOverviewMobile,
    resetLayout,
  } = useLayout();
  const [editing, setEditing] = useState(false);
  const [configId, setConfigId] = useState<string | null>(null);

  const mobileItems = useMemo(
    () => reconcileLayoutItems(overviewMobile, MOBILE_WIDGET_IDS, [], HIDDEN_BY_DEFAULT_IDS),
    [overviewMobile],
  );
  const configBlock = configId ? overviewBlocks.find((b) => b.id === configId) : null;

  const toggleMobile = (id: string) =>
    setOverviewMobile(mobileItems.map((b) => (b.id === id ? { ...b, visible: !b.visible } : b)));

  const reorderMobile = (ids: string[]) => {
    const byId = new Map(mobileItems.map((i) => [i.id, i]));
    setOverviewMobile(ids.map((id) => byId.get(id)).filter((x): x is UiLayoutItem => !!x));
  };

  const setBlockConfig = (id: string, config: Record<string, unknown>) =>
    setOverviewBlocks(overviewBlocks.map((b) => (b.id === id ? { ...b, config: { ...b.config, ...config } } : b)));

  const orderedItems = useMemo(() => {
    const alerts = mobileItems.find((i) => i.id === 'alerts');
    const rest = mobileItems.filter((i) => i.id !== 'alerts');
    return alerts ? [...rest, alerts] : rest;
  }, [mobileItems]);

  const visibleWidgets = orderedItems.filter((i) => i.id !== 'alerts' && i.visible);
  const alertsVisible = orderedItems.find((i) => i.id === 'alerts' && i.visible);

  return (
    <div className="flex min-h-0 flex-1 flex-col text-xs">
      {/* Toolbar: ultra-compact */}
      <div className="flex items-center justify-end gap-1 border-b px-1.5 py-0.5">
        {editing && (
          <button type="button" onClick={resetLayout} className=" text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded">恢复默认</button>
        )}
        <button type="button" onClick={() => setEditing(!editing)} className={cn(' px-1.5 py-0.5 rounded font-medium', editing ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground')}>
          {editing ? '完成' : '编辑'}
        </button>
      </div>

      {/* Widget area */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {editing ? (
          <EditModeList items={orderedItems} onReorder={reorderMobile} onToggle={toggleMobile} onConfigOpen={setConfigId} />
        ) : (
          <ScrollArea className="h-full">
            <div className="flex flex-col gap-1 p-1.5">
              {visibleWidgets.map((item) => (
                <CompactWidget key={item.id} block={item} />
              ))}
              {visibleWidgets.length === 0 && (
                <div className="flex flex-col items-center gap-1 py-6 text-xs text-muted-foreground">
                  <p>暂无可见部件</p>
                  <button type="button" onClick={resetLayout} className="text-primary hover:underline">恢复默认</button>
                </div>
              )}
            </div>
          </ScrollArea>
        )}
      </div>

      {/* Alerts pinned to bottom */}
      <div className="min-h-[30%] max-h-[45%] shrink-0 border-t">
        {alertsVisible ? (
          <CompactAlerts config={parseAlertsConfig(overviewBlocks.find((b) => b.id === 'alerts')?.config)} />
        ) : (
          <div className="flex h-full items-center justify-center  text-muted-foreground">告警部件已隐藏</div>
        )}
      </div>

      {/* Config dialog — supports ALL widget types */}
      <Dialog open={!!configId} onOpenChange={(o) => { if (!o) setConfigId(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{configBlock ? `${widgetLabel(configBlock.id)} · 设置` : '设置'}</DialogTitle>
          </DialogHeader>
          {configBlock?.id === 'alerts' && <AlertsConfigForm config={configBlock.config} onChange={(c) => setBlockConfig('alerts', c)} />}
          {configBlock?.id === 'sessions' && <SessionsConfigForm config={configBlock.config} onChange={(c) => setBlockConfig('sessions', c)} />}
          {configBlock?.id === 'host' && <HostConfigForm config={configBlock.config} onChange={(c) => setBlockConfig('host', c)} />}
          {configBlock?.id === 'connections' && <ConnectionsConfigForm config={configBlock.config} onChange={(c) => setBlockConfig('connections', c)} />}
          {configBlock?.id === 'note' && <NoteConfigForm config={configBlock.config} onChange={(c) => setBlockConfig('note', c)} />}
          {configBlock?.id === 'link' && <LinkConfigForm config={configBlock.config} onChange={(c) => setBlockConfig('link', c)} />}
          {configBlock?.id === 'account' && <AccountConfigForm config={configBlock.config} onChange={(c) => setBlockConfig('account', c)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Edit mode ──────────────────────────────────────────────────────────────

function EditModeList({ items, onReorder, onToggle, onConfigOpen }: {
  items: UiLayoutItem[]; onReorder: (ids: string[]) => void; onToggle: (id: string) => void; onConfigOpen: (id: string) => void;
}) {
  return (
    <ScrollArea className="h-full">
      <Reorder.Group axis="y" values={items.map((i) => i.id)} onReorder={onReorder} className="flex flex-col gap-0.5 p-1.5">
        {items.map((item) => (
          <Reorder.Item
            key={item.id} value={item.id}
            className={cn('flex select-none items-center gap-1.5 rounded border px-2 py-1 cursor-grab active:cursor-grabbing text-xs', item.visible ? 'bg-card/60' : 'bg-muted/20 opacity-50')}
          >
            <GripVertical className="size-3 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate font-medium">{widgetLabel(item.id)}</span>
            {CONFIGURABLE_WIDGETS.has(item.id) && item.visible && (
              <button type="button" onClick={() => onConfigOpen(item.id)} className="inline-flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-accent/50 hover:text-foreground" title="设置"><Settings2 className="size-2.5" /></button>
            )}
            <button type="button" onClick={() => onToggle(item.id)} className="inline-flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-accent/50 hover:text-foreground" title={item.visible ? '隐藏' : '显示'}>
              {item.visible ? <Eye className="size-2.5" /> : <EyeOff className="size-2.5" />}
            </button>
          </Reorder.Item>
        ))}
      </Reorder.Group>
    </ScrollArea>
  );
}

// ─── CompactWidget dispatcher ───────────────────────────────────────────────

function CompactWidget({ block }: { block: UiLayoutItem }) {
  if (block.id.startsWith('stat:')) return <CompactStatTile id={block.id} />;
  switch (block.id) {
    case 'host': return <CompactHost config={parseHostConfig(block.config)} />;
    case 'sessions': return <CompactSessions config={parseSessionsConfig(block.config)} />;
    case 'connections': return <CompactConnections config={parseConnectionsConfig(block.config)} />;
    case 'note': return <CompactNote config={parseNoteConfig(block.config)} />;
    case 'link': return <CompactLink config={parseLinkConfig(block.config)} />;
    case 'account': return <CompactAccount config={parseAccountConfig(block.config)} />;
    case 'deliveries': return <CompactDeliveries />;
    default: return null;
  }
}

// ─── Stat tiles (ultra-compact single row) ──────────────────────────────────

function CompactStatTile({ id }: { id: string }) {
  const { qqList, processList, systemInfo } = useAppState();
  const { status } = useSession();
  const online = status === '已连接';

  let label: string; let value: string; let accent = false;
  switch (id) {
    case 'stat:status': label = '服务'; value = online ? '运行中' : status; accent = online; break;
    case 'stat:accounts': label = '账号'; value = `${qqList.length}`; break;
    case 'stat:processes':
      label = '进程'; value = `${processList.filter((p) => p.status === 'online').length} 在线`; break;
    case 'stat:host':
      if (systemInfo) {
        return (
          <div className="flex items-center gap-1.5 rounded border px-2 py-1 text-xs">
            <span className="font-medium text-muted-foreground shrink-0">主机</span>
            <span className="font-semibold">{systemInfo.hostname}</span>
            <span className="text-muted-foreground/50 font-mono text-[11px]">{systemInfo.archLabel}</span>
          </div>
        );
      }
      label = '主机'; value = '—'; break;
    case 'stat:uptime': label = '运行'; value = systemInfo ? formatUptime(systemInfo.uptime) : '—'; break;
    default: return null;
  }

  return (
    <div className={cn('flex items-center gap-1.5 rounded border px-2 py-1 text-xs', accent && 'border-primary/20 bg-primary/5')}>
      <span className="font-medium text-muted-foreground min-w-[2em]">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  );
}

// ─── Host ───────────────────────────────────────────────────────────────────

function shortDistro(distro: string): string {
  let s = distro;
  s = s.replace(/^Debian GNU\/Linux /, 'Debian ');
  s = s.replace(/^Red Hat Enterprise Linux /, 'RHEL ');
  s = s.replace(/^CentOS (?:Linux )?release /, 'CentOS ');
  s = s.replace(/^Rocky Linux /, 'Rocky ');
  s = s.replace(/^Alma(?:Linux)? /, 'Alma ');
  s = s.replace(/^Oracle Linux /, 'Oracle ');
  s = s.replace(/^Amazon Linux /, 'Amazon ');
  s = s.replace(/^Scientific Linux /, 'Scientific ');
  s = s.replace(/^SUSE Linux Enterprise (?:Server |Desktop )?/, 'SUSE ');
  s = s.replace(/^Anolis OS /, 'Anolis ');
  s = s.replace(/^TencentOS Server /, 'TencentOS ');
  s = s.replace(/^Ubuntu Kylin /, 'Ubuntu ');
  s = s.replace(/^Manjaro Linux /, 'Manjaro ');
  s = s.replace(/^Void Linux /, 'Void ');
  s = s.replace(/^Alibaba Cloud Linux /, 'Alibaba ');
  s = s.replace(/^Raspbian GNU\/Linux /, 'Raspbian ');
  s = s.replace(/^DietPi v /, 'DietPi ');
  s = s.replace(/^Kali GNU\/Linux /, 'Kali ');
  s = s.replace(/^Proxmox VE /, 'Proxmox ');
  s = s.replace(/^Windows Server /, 'Win Svr ');
  s = s.replace(/^Windows (\d+)/, 'Win $1');
  s = s.replace(/\s*\([^)]+\)/g, '');
  s = s.replace(/\s{2,}/g, ' ');
  return s.trim();
}

const HOST_DISPLAY_FIELDS = ['cpu', 'memory', 'runtime'] as const;

function CompactHost({ config }: { config: { cpu?: boolean; memory?: boolean; runtime?: boolean } }) {
  const { systemInfo } = useAppState();
  const fields = HOST_DISPLAY_FIELDS.filter((f) => config[f] !== false);
  if (!systemInfo || fields.length === 0) {
    return <div className="rounded border px-2 py-1 text-xs"><span className="font-medium text-muted-foreground">主机</span> <span className="text-muted-foreground/60">加载中...</span></div>;
  }

  const cpuPct = systemInfo.cpu.average;
  const memPct = systemInfo.memory.usagePercent;
  const perCore = systemInfo.cpu.perCore ?? [];

  return (
    <div className="rounded border px-2 py-1.5 text-xs">
      {/* Row 1: hostname + distro + arch */}
      <div className="flex items-center gap-1.5 mb-1 flex-wrap break-words">
        <span className="font-semibold shrink-0">{systemInfo.hostname}</span>
        <span className="text-muted-foreground/70 min-w-0 break-words">{shortDistro(systemInfo.distro)}</span>
        <span className="text-muted-foreground/40 font-mono shrink-0">{systemInfo.archLabel}</span>
      </div>

      {/* Row 2: CPU model + cores */}
      <div className="flex items-center gap-1.5 mb-1 text-muted-foreground break-words">
        <span className="min-w-0 break-words">{systemInfo.cpu.model}</span>
        <span className="text-muted-foreground/50 shrink-0">{systemInfo.cpu.cores} 核</span>
      </div>

      {/* Row 3: CPU% + Mem% */}
      <div className="flex items-center gap-3 mb-1">
        {fields.includes('cpu') && (
          <span className="inline-flex items-center gap-0.5 text-muted-foreground text-[11px]">
            <Cpu className="size-2.5" />
            <span className="tabular-nums">{cpuPct.toFixed(1)}%</span>
          </span>
        )}
        {fields.includes('memory') && (
          <span className="inline-flex items-center gap-0.5 text-muted-foreground text-[11px]">
            <MemoryStick className="size-2.5" />
            <span className="tabular-nums">{memPct.toFixed(1)}%</span>
          </span>
        )}
        {fields.includes('runtime') && (
          <span className="text-muted-foreground/50 text-[11px]">Node {systemInfo.nodeVersion}</span>
        )}
      </div>

      {/* Per-core CPU bars */}
      {fields.includes('cpu') && perCore.length > 0 && (
        <div className="flex gap-px h-6 mb-1">
          {perCore.map((p, i) => (
            <div key={i} title={`Core ${i}: ${p.toFixed(1)}%`} className="flex-1 rounded-sm bg-muted relative overflow-hidden">
              <div className="absolute bottom-0 left-0 right-0 bg-primary/60 transition-[height] duration-500 ease-out" style={{ height: `${Math.max(2, p)}%` }} />
            </div>
          ))}
        </div>
      )}

      {/* Memory bar */}
      {fields.includes('memory') && (
        <div className="mb-1">
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div className="h-full rounded-full bg-primary/60 transition-[width] duration-500 ease-out" style={{ width: `${memPct}%` }} />
          </div>
          <div className="flex justify-between  text-muted-foreground mt-0.5 tabular-nums">
            <span>已用 {formatBytes(systemInfo.memory.used)}</span>
            <span>共 {formatBytes(systemInfo.memory.total)}</span>
          </div>
        </div>
      )}

      {/* Runtime: PID, RSS, heap, external */}
      {fields.includes('runtime') && (
        <div className="grid grid-cols-2 gap-x-2 gap-y-0.5  text-muted-foreground pt-0.5 border-t border-border/40">
          <span>PID <span className="tabular-nums font-medium text-foreground">{systemInfo.runtime.pid}</span></span>
          <span>RSS <span className="tabular-nums font-medium text-foreground">{formatBytes(systemInfo.runtime.rss)}</span></span>
          <span>堆 <span className="tabular-nums font-medium text-foreground">{formatBytes(systemInfo.runtime.heapUsed)}/{formatBytes(systemInfo.runtime.heapTotal)}</span></span>
          <span>外部 <span className="tabular-nums font-medium text-foreground">{formatBytes(systemInfo.runtime.external)}</span></span>
        </div>
      )}
    </div>
  );
}

// ─── Sessions (在线会话) ────────────────────────────────────────────────────

function CompactSessions({ config }: { config: { sort?: string; filter?: string } }) {
  const { qqList } = useAppState();
  const items = useMemo(() => {
    const f = (config.filter ?? '').trim().toLowerCase();
    const arr = f
      ? qqList.filter((q) => (q.nickname ?? '').toLowerCase().includes(f) || q.uin.includes(f))
      : [...qqList];
    if (config.sort === 'uin') arr.sort((a, b) => a.uin.localeCompare(b.uin));
    else if (config.sort === 'nickname') arr.sort((a, b) => (a.nickname || a.uin).localeCompare(b.nickname || b.uin));
    return arr;
  }, [qqList, config.sort, config.filter]);
  if (items.length === 0) {
    return <div className="rounded border px-2 py-1 text-xs"><span className="font-medium text-muted-foreground">在线会话</span> <span className="text-muted-foreground/60">暂无</span></div>;
  }

  return (
    <div className="rounded border px-2 py-1 text-xs">
      <span className="font-medium text-muted-foreground">在线会话</span>
      <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5">
        {items.map((q) => (
          <span key={q.uin} className="inline-flex items-center gap-1">
            <Avatar size={14}>
              <AvatarImage src={`/avatar/${encodeURIComponent(q.uin)}`} alt={q.nickname || q.uin} />
              <AvatarFallback>{(q.nickname || q.uin).slice(0, 1)}</AvatarFallback>
            </Avatar>
            <span className="min-w-0 break-words">{q.nickname || q.uin}</span>
            <span className="font-mono text-muted-foreground/60 text-[10px]">{q.uin}</span>
            <span className="size-1.5 rounded-full bg-success shrink-0" />
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Connections (OneBot 连接) ──────────────────────────────────────────────

const CONN_STATUS_RANK: Record<string, number> = { down: 0, warn: 1, disabled: 2, ok: 3 };
const ADAPTER_KIND_LABEL: Record<string, string> = {
  httpServer: '服务端', httpClient: '上报', wsServer: 'WS', wsClient: 'WS',
};

function CompactConnections({ config }: { config: { onlyIssues?: boolean; sort?: string; filter?: string } }) {
  const { connections } = useAppState();
  const list = useMemo(() => {
    let arr = connections.map((acc) => ({
      ...acc,
      adapters: config.onlyIssues ? acc.adapters.filter((a) => a.status !== 'ok') : acc.adapters,
    }));
    if (config.onlyIssues) arr = arr.filter((acc) => acc.adapters.length > 0);
    const f = (config.filter ?? '').trim().toLowerCase();
    if (f) arr = arr.filter((acc) => (acc.nickname ?? '').toLowerCase().includes(f) || acc.uin.includes(f));
    if (config.sort === 'name') {
      arr = [...arr].sort((a, b) => (a.nickname || a.uin).localeCompare(b.nickname || b.uin));
    } else if (config.sort === 'status') {
      const worst = (acc: typeof arr[number]) =>
        acc.adapters.reduce((m, a) => Math.min(m, CONN_STATUS_RANK[a.status] ?? 99), 99);
      arr = [...arr].sort((a, b) => worst(a) - worst(b));
    }
    return arr;
  }, [connections, config.onlyIssues, config.filter, config.sort]);
  if (list.length === 0) {
    return <div className="rounded border px-2 py-1 text-xs"><span className="font-medium text-muted-foreground">连接</span> <span className="text-muted-foreground/60">暂无</span></div>;
  }

  return (
    <div className="rounded border px-2 py-1 text-xs">
      <span className="font-medium text-muted-foreground">连接</span>
      <div className="mt-0.5 flex flex-col gap-0.5">
        {list.map((acc) => (
          <div key={acc.uin} className="flex items-center gap-1.5">
            <span className="min-w-0 break-words font-medium">{acc.nickname || acc.uin}</span>
            <div className="flex items-center gap-1.5">
              {acc.adapters.slice(0, 4).map((a) => (
                <span key={a.name} className={cn('inline-flex items-center gap-0.5', a.status === 'ok' ? 'text-success' : a.status === 'warn' ? 'text-warning' : a.status === 'down' ? 'text-destructive' : 'text-muted-foreground')} title={`${a.name}: ${a.status}`}>
                  <span className={cn('size-1.5 rounded-full', a.status === 'ok' ? 'bg-success' : a.status === 'warn' ? 'bg-warning' : a.status === 'down' ? 'bg-destructive' : 'bg-muted-foreground')} />
                  <span className="text-[10px]">{ADAPTER_KIND_LABEL[a.kind] ?? a.kind}</span>
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Note ──────────────────────────────────────────────────────────────────

function CompactNote({ config }: { config: { text?: string } }) {
  const text = (config.text ?? '').trim();
  return <div className="rounded border px-2 py-1 text-xs break-words"><span className="font-medium text-muted-foreground">便签</span> <span className="text-muted-foreground/60">{text || '暂无内容'}</span></div>;
}

// ─── Link ──────────────────────────────────────────────────────────────────

function CompactLink({ config }: { config: { url?: string; label?: string; icon?: string } }) {
  if (!config.url) {
    return <div className="rounded border px-2 py-1 text-xs"><span className="font-medium text-muted-foreground">链接</span> <span className="text-muted-foreground/60">未配置</span></div>;
  }
  const Icon = LINK_ICON_COMPONENTS[config.icon as keyof typeof LINK_ICON_COMPONENTS] ?? LINK_ICON_COMPONENTS.link;
  return (
    <a href={config.url} target="_blank" rel="noreferrer noopener" className="flex items-center gap-1.5 rounded border px-2 py-1 text-xs hover:bg-accent/30 transition-colors">
      <Icon className="size-3 shrink-0 text-primary" />
      <span className="min-w-0 flex-1 truncate">{config.label || config.url}</span>
    </a>
  );
}

// ─── Account ──────────────────────────────────────────────────────────────

function CompactAccount({ config }: { config: { uin?: string } }) {
  const { qqList } = useAppState();
  const acct = qqList.find((q) => q.uin === config.uin);
  if (!config.uin) {
    return <div className="rounded border px-2 py-1 text-xs"><span className="font-medium text-muted-foreground">账号</span> <span className="text-muted-foreground/60">未指定</span></div>;
  }
  return (
    <div className="flex items-center gap-1.5 rounded border px-2 py-1 text-xs">
      <Avatar size={16}>
        <AvatarImage src={`/avatar/${encodeURIComponent(config.uin)}`} alt={acct?.nickname || config.uin} />
        <AvatarFallback>{(acct?.nickname || config.uin).slice(0, 1)}</AvatarFallback>
      </Avatar>
      <span className="min-w-0 flex-1 truncate font-medium">{acct?.nickname || config.uin}</span>
      {acct && <span className="size-1.5 rounded-full bg-success shrink-0" />}
    </div>
  );
}

// ─── Deliveries ─────────────────────────────────────────────────────────────

function CompactDeliveries() {
  return <div className="rounded border px-2 py-1 text-xs text-muted-foreground">消息投递状态</div>;
}

// ─── Alerts (pinned to bottom, min 30%) ─────────────────────────────────────

const ALERT_LEVEL_CLASS: Record<string, string> = {
  trace: 'text-muted-foreground', debug: 'text-muted-foreground',
  info: 'text-blue-500', success: 'text-green-500',
  warn: 'text-warning', error: 'text-destructive',
};

function CompactAlerts({ config }: { config: { count: number; levels: string[] } }) {
  const api = useApi();
  const { formatClock } = useTheme();
  const [alerts, setAlerts] = useState<LogEntry[]>([]);
  const count = config.count;
  const levelsKey = config.levels.join(',');

  useEffect(() => {
    const levels = new Set(levelsKey.split(',') as LogLevel[]);
    let active = true;
    api.logs.list(Math.max(50, count * 3)).then((list) => {
      if (!active) return;
      setAlerts(list.filter((l) => levels.has(l.level)).slice(-count));
    }).catch(() => {});
    const stop = api.logs.stream({
      onLine: (entry) => {
        if (!levels.has(entry.level)) return;
        setAlerts((prev) => [...prev.filter((a) => a.id !== entry.id), entry].slice(-count));
      },
    });
    return () => { active = false; stop(); };
  }, [api, levelsKey, count]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-2 py-1">
        <span className=" font-medium text-muted-foreground">告警</span>
        <span className=" font-mono text-muted-foreground">{config.levels.map((l) => l.toUpperCase()).join('/')}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto border-t border-border/40 px-1 pb-0.5">
        {alerts.length === 0 ? (
          <div className="flex h-full items-center justify-center  text-muted-foreground">暂无告警</div>
        ) : (
          <div className="flex flex-col gap-px">
            {alerts.map((a) => (
              <div key={a.id} className="flex items-start gap-1 rounded px-1.5 py-0.5 hover:bg-accent/30  font-mono">
                <span className="shrink-0 text-muted-foreground tabular-nums">{formatClock(a.time)}</span>
                <span className={cn('shrink-0 font-semibold', ALERT_LEVEL_CLASS[a.level])}>{a.level.toUpperCase()}</span>
                <span className="min-w-0 flex-1 truncate" title={a.message}>{a.message}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
