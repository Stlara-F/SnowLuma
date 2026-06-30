import { useRef, useState } from 'react';
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { AlertCircle, ArrowLeft, Loader2, Monitor, Wifi, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { VncViewer, type VncViewerHandle } from '@/components/vnc-viewer';
import { VncPasswordDialog } from '@/components/vnc-password-dialog';

const routeApi = getRouteApi('/app-layout/processes/vnc/$pid');

type ConnStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export function VncViewPage() {
  const navigate = useNavigate();
  const { pid } = routeApi.useParams();
  const { processName: rawName } = routeApi.useSearch();

  const viewerRef = useRef<VncViewerHandle>(null);
  const [connStatus, setConnStatus] = useState<ConnStatus>('connecting');
  const [errorMessage, setErrorMessage] = useState('');
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [pendingPassword, setPendingPassword] = useState(false);

  const processName = rawName ?? `PID ${pid}`;

  return (
    <div
      className="flex flex-col"
      style={{ margin: '-1.25rem -1rem', width: 'calc(100% + 2rem)', height: 'calc(100dvh - 48px)' }}
    >
      <div className="flex items-center gap-3 px-4 pb-3 shrink-0">
        <Button variant="ghost" size="sm" onClick={() => navigate({ to: '/processes' })}>
          <ArrowLeft className="size-4" /> 返回
        </Button>
        <div className="flex items-center gap-2 text-sm font-medium">
          <Monitor className="size-4 text-muted-foreground" />
          远程桌面 — {processName}
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          {connStatus === 'connected' && (
            <span className="flex items-center gap-1 text-xs text-success">
              <Wifi className="size-3" /> 已连接
            </span>
          )}
          {connStatus === 'connecting' && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" /> 连接中
            </span>
          )}
          {connStatus === 'disconnected' && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
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

      <div className="relative flex-1 min-h-0 mx-4 mb-4 rounded-lg overflow-hidden bg-black">
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
        {connStatus === 'error' && errorMessage && (
          <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-destructive/90 px-3 py-1.5 text-xs text-destructive-foreground">
            <AlertCircle className="size-3 shrink-0" />
            {errorMessage}
          </div>
        )}
        {pendingPassword && (
          <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/70 text-muted-foreground text-sm z-10">
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
