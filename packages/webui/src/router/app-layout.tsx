import { useCallback, useEffect, useState } from 'react';
import { useTheme } from '@/contexts/ThemeContext';
import { useApi } from '@/lib/api';
import { useHookProcessOps } from '@/hooks/use-hook-process-ops';
import { MainLayout } from '@/components/layout/main-layout';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { AppStateProvider } from '@/contexts/AppStateContext';
import { KioskProvider } from '@/contexts/KioskContext';
import { LayoutProvider } from '@/contexts/LayoutContext';
import { useSession } from '@/contexts/SessionContext';
import type { AccountConnections, HookProcessInfo, QQInfo, SystemInfo, UpdateInfo } from '@/types';

/**
 * The layout route. Owns the live state shared across the pages
 * (polling lists, processOps, selectedUin) and renders MainLayout.
 *
 * In the new tab-based architecture, <Outlet /> is removed —
 * MainLayout renders WorkspaceView which handles tab content internally.
 * Child routes (overview, processes, etc.) are kept for deep-linking
 * compatibility but their components are loaded lazily by TabContext.
 */
export function AppLayout() {
  const api = useApi();
  const { pollInterval, reloadAppearance } = useTheme();
  const session = useSession();

  useEffect(() => { void reloadAppearance(); }, [reloadAppearance]);

  const [qqList, setQqList] = useState<QQInfo[]>([]);
  const [processList, setProcessList] = useState<HookProcessInfo[]>([]);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [connections, setConnections] = useState<AccountConnections[]>([]);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [selectedUin, setSelectedUin] = useState<string | null>(null);

  const refreshQqList = useCallback(async () => {
    try { setQqList(await api.qqList()); } catch (e) { console.error('qq-list', e); }
  }, [api]);

  const refreshProcesses = useCallback(async () => {
    try { setProcessList(await api.processes.list()); } catch (e) { console.error('processes', e); }
  }, [api]);

  const refreshSystem = useCallback(async () => {
    try { setSystemInfo(await api.system()); } catch (e) { console.error('system', e); }
  }, [api]);

  const refreshConnections = useCallback(async () => {
    try { setConnections(await api.connections()); } catch (e) { console.error('connections', e); }
  }, [api]);

  const refreshUpdate = useCallback(async (force = false) => {
    try { setUpdateInfo(await api.update.check(force)); } catch (e) { console.error('update-check', e); }
  }, [api]);

  const { ops: processOps, unloadFailedAlert, dismissUnloadFailedAlert } = useHookProcessOps({
    onAfterOp: refreshProcesses,
  });

  // SSE live-state subscription.
  useEffect(() => {
    const dispose = api.stateStream({
      onEvent: (event) => {
        if ('resource' in event) {
          if (event.resource === 'processes') setProcessList(event.data);
          else if (event.resource === 'qq-list') setQqList(event.data);
          else if (event.resource === 'connections') setConnections(event.data);
          return;
        }
        if ('kind' in event && event.kind === 'dropped') {
          void refreshQqList();
          void refreshProcesses();
          void refreshConnections();
        }
      },
    });
    return () => { dispose(); };
  }, [api, refreshQqList, refreshProcesses, refreshConnections]);

  // Slow reconcile fallback.
  useEffect(() => {
    if (pollInterval <= 0) return;
    let cancelled = false;
    const reconcileMs = Math.max(pollInterval * 10, 10_000);
    const tick = async () => {
      if (cancelled) return;
      await Promise.all([refreshQqList(), refreshProcesses(), refreshConnections()]);
    };
    tick();
    const interval = setInterval(tick, reconcileMs);
    return () => { cancelled = true; clearInterval(interval); };
  }, [pollInterval, refreshQqList, refreshProcesses, refreshConnections]);

  // SystemInfo fast cadence.
  useEffect(() => {
    if (pollInterval <= 0) return;
    let cancelled = false;
    const tick = async () => { if (!cancelled) await refreshSystem(); };
    tick();
    const interval = setInterval(tick, pollInterval);
    return () => { cancelled = true; clearInterval(interval); };
  }, [pollInterval, refreshSystem]);

  // Update check (slow, 6h).
  useEffect(() => {
    refreshUpdate();
    const id = setInterval(() => refreshUpdate(), 6 * 60 * 60 * 1000);
    return () => clearInterval(id);
  }, [refreshUpdate]);

  const handleLogout = useCallback(async () => {
    await api.logout();
    setQqList([]);
    setProcessList([]);
    setSystemInfo(null);
    setConnections([]);
    setUpdateInfo(null);
    setSelectedUin(null);
    session.onLogoutComplete();
  }, [api, session]);

  return (
    <AppStateProvider
      value={{
        qqList, processList, systemInfo, connections, updateInfo, selectedUin,
        setSelectedUin, processOps, refreshProcesses, refreshSystem,
        refreshConnections, refreshUpdate, onLogout: handleLogout,
      }}
    >
      <LayoutProvider>
        <KioskProvider>
          <MainLayout status={session.status} onLogout={handleLogout} />

          <ConfirmDialog
            open={!!unloadFailedAlert}
            onOpenChange={(open) => !open && dismissUnloadFailedAlert()}
            title="卸载失败"
            description={
              unloadFailedAlert ? (
                <>
                  <p>进程 {unloadFailedAlert.pid} 的 SnowLuma DLL 卸载失败。</p>
                  <p className="mt-2 text-sm">{unloadFailedAlert.error}</p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    系统将继续尝试重新连接该进程。如需彻底卸载，请重启 QQ 进程。
                  </p>
                </>
              ) : null
            }
            confirmText="知道了"
            onConfirm={dismissUnloadFailedAlert}
          />
        </KioskProvider>
      </LayoutProvider>
    </AppStateProvider>
  );
}
