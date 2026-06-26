// "通用设置" tab — fields that apply to the whole OneBotInstance rather
// than any specific adapter: the music-sign service URL and the built-in
// `#sl` status command. Edits here mark the config dirty and are
// auto-saved with debounce by the parent ConfigPage.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ToggleSwitch } from '@/components/ui/toggle-switch';
import { Button } from '@/components/ui/button';
import { NotificationOptIn } from '@/components/config/notification-opt-in';
import type { OneBotConfig, StatusCommandConfig } from '@/types';

interface GeneralSettingsTabProps {
  config: OneBotConfig;
  onChange: (next: OneBotConfig) => void;
}

export function GeneralSettingsTab({ config, onChange }: GeneralSettingsTabProps) {
  const sc = config.statusCommand;
  const setStatusCommand = (patch: Partial<StatusCommandConfig>) =>
    onChange({ ...config, statusCommand: { ...sc, ...patch } });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5 rounded-lg border bg-card/40 p-4">
        <Label>音乐签名服务 URL</Label>
        <Input
          type="url"
          placeholder="留空则不启用"
          value={config.musicSignUrl ?? ''}
          onChange={(e) => onChange({ ...config, musicSignUrl: e.target.value || undefined })}
        />
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          用于音乐分享卡片签名。未配置时音乐相关消息段会回落为普通文本。
        </p>
      </div>

      <div className="flex flex-col gap-4 rounded-lg border bg-card/40 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Label>
              内置状态命令 <code className="font-mono text-xs">#sl</code>
            </Label>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              收到纯文本 <code className="font-mono">#sl</code> 时回复 SnowLuma 版本 / 平台 / 运行时长。任何人可触发，关闭后完全不响应。
            </p>
          </div>
          <ToggleSwitch
            value={sc.enabled}
            onChange={(v) => setStatusCommand({ enabled: v })}
            ariaLabel="启用 #sl 状态命令"
          />
        </div>

        <div className="flex flex-col gap-1.5 border-t pt-3">
          <Label className={sc.enabled ? undefined : 'text-muted-foreground'}>触发词</Label>
          <Input
            className="w-full font-mono"
            value={sc.trigger}
            disabled={!sc.enabled}
            maxLength={32}
            onChange={(e) => setStatusCommand({ trigger: e.target.value })}
          />
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            自定义触发词，默认 <code className="font-mono">#sl</code>。最长 32 字符，匹配前会去除首尾空格并转为小写。
          </p>
        </div>

        <div className="flex items-start justify-between gap-3 border-t pt-3">
          <div className="min-w-0">
            <Label className={sc.enabled ? undefined : 'text-muted-foreground'}>不转发给下游（swallow）</Label>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              开启后，命中的 <code className="font-mono">#sl</code> 不再投递给已连接的 Bot（仍会回复并本地记录）。默认关闭即透传。
            </p>
          </div>
          <ToggleSwitch
            value={sc.swallow}
            onChange={(v) => setStatusCommand({ swallow: v })}
            ariaLabel="吞掉 #sl 不转发给下游"
            disabled={!sc.enabled}
          />
        </div>

        <div className="flex flex-col gap-1.5 border-t pt-3">
          <Label className={sc.enabled ? undefined : 'text-muted-foreground'}>回复冷却（秒）</Label>
          <Input
            type="number"
            min={0}
            className="w-32 tabular-nums"
            value={sc.cooldownSeconds}
            disabled={!sc.enabled}
            onChange={(e) => {
              const n = Math.trunc(Number(e.target.value));
              setStatusCommand({ cooldownSeconds: Number.isFinite(n) && n >= 0 ? n : 0 });
            }}
          />
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            同一会话在该秒数内重复 <code className="font-mono">#sl</code> 不再回复，防刷屏。<code className="font-mono">0</code> 表示不限制。
          </p>
        </div>
      </div>

      <NotificationOptIn
        selectedIds={config.notifications?.channelIds ?? []}
        onChange={(channelIds) => onChange({ ...config, notifications: { channelIds } })}
      />

      <LargeVideoSection />
    </div>
  );
}

// ─── Large Video Upload ──────────────────────────────────────────────────

const TOKEN_KEY = 'snowluma_token';

function LargeVideoSection() {
  const [videoPath, setVideoPath] = useState('');
  const [groupId, setGroupId] = useState('');
  const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [stdout, setStdout] = useState('');
  const [stderr, setStderr] = useState('');
  const [exitCode, setExitCode] = useState<number | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const token = localStorage.getItem(TOKEN_KEY);

  const stopPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  }, []);

  useEffect(() => {
    return stopPolling;
  }, [stopPolling]);

  const startPolling = useCallback((id: string) => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const headers: Record<string, string> = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const res = await fetch(`/api/large-video/task/${id}`, { headers });
        if (!res.ok) {
          setRunning(false);
          setStderr(res.status === 401 ? '登录已过期，请重新登录' : `查询任务失败：HTTP ${res.status}`);
          stopPolling();
          return;
        }
        const data = await res.json();
        if (!data.success) {
          setRunning(false);
          setStderr('查询任务失败');
          stopPolling();
          return;
        }
        const t = data.task;
        setStdout(t.stdout || '');
        setStderr(t.stderr || '');
        setExitCode(t.exitCode);
        setRunning(t.running);
        if (!t.running) stopPolling();
      } catch {
        // 网络错误时继续轮询，不改变 UI 状态
      }
    }, 1000);
  }, [token, stopPolling]);

  const handleSend = async () => {
    if (starting || hasRunningTask || !videoPath.trim() || !groupId.trim()) return;
    setStarting(true);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch('/api/large-video/send', {
        method: 'POST',
        headers,
        body: JSON.stringify({ input: videoPath.trim(), group: Number(groupId) }),
      });
      const data = await res.json();
      if (data.success && data.taskId) {
        setRunning(true);
        setStdout('');
        setStderr('');
        setExitCode(null);
        startPolling(data.taskId);
      } else {
        setStderr(data.message || '启动失败');
      }
    } catch (err) {
      setStderr(err instanceof Error ? err.message : '网络错误');
    } finally {
      setStarting(false);
    }
  };

  const isDone = exitCode !== null;
  const hasRunningTask = running && !isDone;

  return (
    <div className="rounded-lg border bg-card/40 p-4">
      <Label>大视频上传</Label>
      <p className="mt-1 mb-3 text-[11px] leading-relaxed text-muted-foreground">
        将大于 95MB 的视频分割为多个 ≤95MB 的分段，通过 OneBot HTTP API 串行发送到目标群聊。
        需要系统中已安装 ffmpeg + ffprobe。
      </p>

      <div className="flex flex-col gap-2">
        <Label htmlFor="large-video-path">视频文件路径</Label>
        <Input
          id="large-video-path"
          placeholder="视频文件完整路径，如 D:\videos\demo.mp4"
          value={videoPath}
          disabled={hasRunningTask}
          onChange={(e) => setVideoPath(e.target.value)}
        />
        <div className="flex gap-2">
          <Label htmlFor="large-video-group" className="sr-only">目标群号</Label>
          <Input
            id="large-video-group"
            type="number"
            className="w-40 tabular-nums"
            placeholder="目标群号"
            value={groupId}
            disabled={hasRunningTask}
            onChange={(e) => setGroupId(e.target.value)}
          />
          <Button
            className="shrink-0"
            disabled={starting || hasRunningTask || !videoPath.trim() || !groupId.trim()}
            onClick={handleSend}
          >
            {starting ? '启动中...' : hasRunningTask ? '上传中...' : '上传'}
          </Button>
        </div>
      </div>

      {hasRunningTask && (
        <div className="mt-3">
          <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
          </div>
        </div>
      )}

      {stdout && (
        <pre className="mt-3 max-h-48 overflow-auto rounded bg-black/5 p-2 text-[11px] leading-relaxed whitespace-pre-wrap font-mono">
          {stdout}
        </pre>
      )}

      {stderr && (
        <pre className="mt-1 max-h-24 overflow-auto rounded bg-destructive/10 p-2 text-[11px] leading-relaxed whitespace-pre-wrap font-mono text-destructive">
          {stderr}
        </pre>
      )}

      {isDone && (
        <p className={`mt-2 text-xs font-medium ${exitCode === 0 ? 'text-green-600' : 'text-destructive'}`}>
          {exitCode === 0 ? '✓ 上传完成' : `✗ 上传失败 (退出码 ${exitCode})`}
        </p>
      )}
    </div>
  );
}
