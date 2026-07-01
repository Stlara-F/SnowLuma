import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type DebugTaskStatus = 'running' | 'done' | 'failed' | 'canceled';
export type DebugTaskKind = 'upload' | 'stream' | 'invoke';

export interface DebugTask {
  id: string;
  kind: DebugTaskKind;
  label: string;
  status: DebugTaskStatus;
  progress?: number;
  detail?: string;
  startedAt: number;
  endedAt?: number;
  cancel?: () => void;
}

interface DebugTaskContextValue {
  tasks: DebugTask[];
  start: (task: Omit<DebugTask, 'id' | 'status' | 'startedAt'> & { id?: string }) => string;
  update: (id: string, patch: Partial<Omit<DebugTask, 'id'>>) => void;
  finish: (id: string, status: Exclude<DebugTaskStatus, 'running'>, detail?: string) => void;
  remove: (id: string) => void;
  clearFinished: () => void;
}

const Ctx = createContext<DebugTaskContextValue | null>(null);

let seq = 0;
const nextId = () => `dt-${Date.now().toString(36)}-${(seq++).toString(36)}`;

export function DebugTaskProvider({ children }: { children: ReactNode }) {
  const [tasks, setTasks] = useState<DebugTask[]>([]);

  const start = useCallback<DebugTaskContextValue['start']>((t) => {
    const id = t.id ?? nextId();
    setTasks((prev) => {
      const next = [{ ...t, id, status: 'running' as const, startedAt: Date.now() }, ...prev];
      if (next.length <= 50) return next;
      const running = next.filter((x) => x.status === 'running').length;
      const finished = next.filter((x) => x.status !== 'running');
      const drop = new Set(finished.slice(Math.max(0, 50 - running)).map((x) => x.id));
      return next.filter((x) => !drop.has(x.id));
    });
    return id;
  }, []);

  const update = useCallback<DebugTaskContextValue['update']>((id, patch) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  const finish = useCallback<DebugTaskContextValue['finish']>((id, status, detail) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status, detail: detail ?? t.detail, endedAt: Date.now(), cancel: undefined } : t)));
  }, []);

  const remove = useCallback<DebugTaskContextValue['remove']>((id) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const clearFinished = useCallback(() => {
    setTasks((prev) => prev.filter((t) => t.status === 'running'));
  }, []);

  useEffect(() => {
    const anyRunning = tasks.some((t) => t.status === 'running');
    if (!anyRunning) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [tasks]);

  const value = useMemo<DebugTaskContextValue>(
    () => ({ tasks, start, update, finish, remove, clearFinished }),
    [tasks, start, update, finish, remove, clearFinished],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDebugTasks(): DebugTaskContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useDebugTasks must be used within DebugTaskProvider');
  return v;
}

export function useRunningTaskSummary(): { count: number; progress: number | null } {
  const { tasks } = useDebugTasks();
  return useMemo(() => {
    const running = tasks.filter((t) => t.status === 'running');
    if (running.length === 0) return { count: 0, progress: null };
    const determinate = running.filter((t) => typeof t.progress === 'number');
    const progress = determinate.length
      ? determinate.reduce((s, t) => s + (t.progress ?? 0), 0) / determinate.length
      : null;
    return { count: running.length, progress };
  }, [tasks]);
}
