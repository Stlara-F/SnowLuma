import { useRef, useState } from 'react';
import { AlertCircle, ArrowLeft, Loader2, Monitor, Wifi, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { VncViewer, type VncViewerHandle } from '@/components/vnc-viewer';
import { VncPasswordDialog } from '@/components/vnc-password-dialog';
import { useTabs } from '@/contexts/TabContext';

type ConnStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

interface VncViewPageProps {
  /** PID of the target process (optional — VNC connects to the host, PID is for display). */
  vncPid?: string;
  /** Human-readable process name. */
  vncProcessName?: string;
}

export function VncViewPage({ vncPid, vncProcessName }: VncViewPageProps = {}) {
  const { closeTab, activeTabId } = useTabs();

  const viewerRef = useRef<VncViewerHandle>(null);
  const [connStatus, setConnStatus] = useState<ConnStatus>('connecting');
  const [errorMessage, setErrorMessage] = useState('');
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [pendingPassword, setPendingPassword] = useState(false);

  const processName = vncProcessName ?? (vncPid ? `PID ${vncPid}` : '远程桌面');

  const handleBack = () => {
    // Close the current VNC tab if we're in the tab system
    if (activeTabId) closeTab(activeTabId);
  };

  return (
    <div className="flex h-full flex-col bg-black text-white">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2 shrink-0 bg-black/80 border-b border-white/10">
        <Button variant="ghost" size="sm" onClick={handleBack} className="text-white/70 hover:text-white">
          <ArrowLeft className="size-4" /> 返回
        </Button>
        <div className="flex items-center gap-2 text-sm font-medium text-white/80">
          <Monitor className="size-4 text-white/50" />
          远程桌面 — {processName}
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          {connStatus === 'connected' && (
            <span className="flex items-center gap-1 text-xs text-success">
              <Wifi className="size-3" /> 已连接
            </span>
          )}
          {connStatus === 'connecting' && (
            <span className="flex items-center gap-1 text-xs text-white/50">
              <Loader2 className="size-3 animate-spin" /> 连接中
            </span>
          )}
          {connStatus === 'disconnected' && (
            <span className="flex items-center gap-1 text-xs text-white/50">
              <WifiOff className="size-3" /> 已断开
            </span>
          )}
          {connStatus === 'error' && (
            <span className="flex items-center gap-1 text-xs text-destructive">
              <AlertCircle className="size-3" /> 连接失败
            </span>
          )}
        </div>
      </div>

      {/* VNC viewer — fills remaining space */}
      <div className="relative flex-1 min-h-0 flex items-center justify-center bg-black">
        <div className="w-full h-full max-w-full max-h-full flex items-center justify-center">
          <VncViewer
            ref={viewerRef}
            onConnected={() => setConnStatus('connected')}
            onDisconnected={(clean) => {
              setConnStatus(clean ? 'disconnected' : 'error');
              setPendingPassword(false);
              setPasswordDialogOpen(false);
            }}
            onCredentialsRequired={() => {
              setPendingPassword(true);
              setPasswordDialogOpen(true);
            }}
            onError={(msg) => {
              setConnStatus('error');
              setErrorMessage(msg);
              setPendingPassword(false);
              setPasswordDialogOpen(false);
            }}
          />
        </div>
        {connStatus === 'error' && errorMessage && (
          <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-destructive/90 px-3 py-1.5 text-xs text-destructive-foreground">
            <AlertCircle className="size-3 shrink-0" />
            {errorMessage}
          </div>
        )}
        {pendingPassword && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/70 text-sm text-white/70 z-10">
            请输入密码
          </div>
        )}
      </div>

      <VncPasswordDialog
        open={passwordDialogOpen}
        onOpenChange={(o) => {
          setPasswordDialogOpen(o);
          if (!o) {
            setPendingPassword(false);
            viewerRef.current?.disconnect();
            setConnStatus('disconnected');
          }
        }}
        onConfirm={(password) => {
          viewerRef.current?.sendCredentials({ password });
          setPasswordDialogOpen(false);
          setPendingPassword(false);
          setConnStatus('connecting');
        }}
      />
    </div>
  );
}
